import { getCozytouchSession } from "@/lib/session";

const ATLANTIC_API = "https://apis.groupe-atlantic.com";
const OVERKIZ_API = "https://ha110-1.overkiz.com/enduser-mobile-web/enduserAPI";

export type CozyDevice = {
  deviceURL?: string;
  label?: string;
  controllableName?: string;
  available?: boolean;
  enabled?: boolean;
  definition?: {
    commands?: { commandName: string; nparams: number }[];
    states?: { qualifiedName: string; type?: string; values?: string[] }[];
  };
};

export async function withOverkiz<T>(
  callback: (cookie: string, setup: Record<string, unknown>) => Promise<T>
): Promise<T> {
  const session = await getCozytouchSession();
  if (!session.accessToken || !session.expiresAt || Date.now() >= session.expiresAt) {
    session.destroy();
    throw new Error("COZYTOUCH_SESSION_EXPIRED");
  }

  const jwtResponse = await fetch(ATLANTIC_API + "/magellan/accounts/jwt", {
    headers: { Authorization: "Bearer " + session.accessToken },
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  if (!jwtResponse.ok) throw new Error("COZYTOUCH_JWT_FAILED");
  const jwt = (await jwtResponse.text()).trim().replace(/^"|"$/g, "");
  if (jwt.length < 20) throw new Error("COZYTOUCH_JWT_INVALID");

  const loginResponse = await fetch(OVERKIZ_API + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ jwt }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  if (!loginResponse.ok) throw new Error("OVERKIZ_LOGIN_FAILED");
  const cookieParts = typeof loginResponse.headers.getSetCookie === "function"
    ? loginResponse.headers.getSetCookie()
    : [loginResponse.headers.get("set-cookie") ?? ""];
  const cookie = cookieParts.map(part => part.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("OVERKIZ_COOKIE_MISSING");

  const setupResponse = await fetch(OVERKIZ_API + "/setup", {
    headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!setupResponse.ok) throw new Error("OVERKIZ_SETUP_FAILED");
  const setup = await setupResponse.json() as Record<string, unknown>;
  return callback(cookie, setup);
}

export function findAtlanticHeater(setup: Record<string, unknown>): CozyDevice {
  const devices = Array.isArray(setup.devices) ? setup.devices as CozyDevice[] : [];
  const heater = devices.find(device =>
    String(device.controllableName ?? "").includes("AtlanticElectricalHeaterWithAdjustableTemperatureSetpoint")
  );
  if (!heater?.deviceURL) throw new Error("ATLANTIC_HEATER_NOT_FOUND");
  return heater;
}

export async function getDeviceStates(cookie: string, deviceURL: string) {
  const url = OVERKIZ_API + "/setup/devices/" + encodeURIComponent(deviceURL) + "/states";
  const response = await fetch(url, {
    headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("OVERKIZ_STATES_FAILED");
  const body = await response.json();
  return Array.isArray(body) ? body as Record<string, unknown>[] : [];
}

export function normalizeStates(states: Record<string, unknown>[]) {
  const result: Record<string, unknown> = {};
  for (const state of states) {
    const name = String(state.name ?? state.qualifiedName ?? "");
    const shortName = name.split(":").pop()?.replace(/State$/, "") ?? name;
    result[shortName] = state.value ?? state;
  }
  return result;
}

export async function executeHeaterCommand(
  cookie: string,
  heater: CozyDevice,
  commandName: string,
  parameters: unknown[] = []
) {
  const definition = heater.definition?.commands ?? [];
  const command = definition.find(item => item.commandName === commandName);
  if (!command) throw new Error("COMMAND_NOT_SUPPORTED");
  if (command.nparams !== parameters.length) throw new Error("INVALID_COMMAND_PARAMETERS");

  const response = await fetch(OVERKIZ_API + "/exec/apply", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "Atlantic Home",
      actions: [{
        deviceURL: heater.deviceURL,
        commands: [{ name: commandName, parameters }]
      }]
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("OVERKIZ_COMMAND_FAILED");
  return body as Record<string, unknown>;
}


type EnergyPeriod = { timestamp: number; quantityKwh: number; mode: number };

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function periodTimestamp(value: unknown): number | null {
  const numeric = numericValue(value);
  if (numeric !== null) {
    const seconds = numeric > 1e12 ? numeric / 1000 : numeric;
    return seconds > 0 ? Math.floor(seconds) : null;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
}

function parseEnergyPayload(payload: unknown) {
  const entries = Array.isArray(payload) ? payload : [];
  const withPeriods = entries.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).consumptionPeriods)
  );
  // Atlantic has returned different enum representations across API versions.
  // Prefer the known electricity/kWh series, but don't discard all data if enums changed.
  const preferred = withPeriods.filter(item => {
    const type = String(item.type ?? "").toLowerCase();
    const unit = String(item.unit ?? "").toLowerCase();
    return (type === "1" || type.includes("electric")) && (unit === "1" || unit.includes("kwh"));
  });
  const selected = preferred.length ? preferred : withPeriods;
  const periods: EnergyPeriod[] = [];
  for (const item of selected) {
    for (const raw of item.consumptionPeriods as Record<string, unknown>[]) {
      const timestamp = periodTimestamp(raw.date ?? raw.timestamp ?? raw.startDate ?? raw.periodStart);
      const quantity = numericValue(raw.consumedQuantity ?? raw.quantity ?? raw.consumption ?? raw.value);
      if (timestamp === null || quantity === null) continue;
      const modeRaw = raw.mode ?? raw.tariffMode ?? raw.tariff ?? raw.periodType;
      const modeText = String(modeRaw ?? "").toLowerCase();
      const mode = modeText === "1" || modeText.includes("peak") || modeText.includes("day") ? 1
        : modeText === "2" || modeText.includes("offpeak") || modeText.includes("night") ? 2
        : numericValue(modeRaw) ?? 0;
      periods.push({ timestamp, quantityKwh: quantity, mode });
    }
  }
  return {
    periods,
    diagnostics: {
      payloadIsArray: Array.isArray(payload),
      seriesCount: entries.length,
      seriesWithPeriods: withPeriods.length,
      selectedSeriesCount: selected.length,
      sampleSeriesKeys: withPeriods[0] ? Object.keys(withPeriods[0]).slice(0, 20) : [],
      samplePeriodKeys: withPeriods[0] && Array.isArray(withPeriods[0].consumptionPeriods) && withPeriods[0].consumptionPeriods[0]
        ? Object.keys(withPeriods[0].consumptionPeriods[0] as Record<string, unknown>).slice(0, 20) : [],
      parsedPeriods: periods.length
    }
  };
}

async function getSetupConsumption(periodicity: "daily" | "hourly") {
  const session = await getCozytouchSession();
  if (!session.accessToken || !session.expiresAt || Date.now() >= session.expiresAt) {
    throw new Error("COZYTOUCH_SESSION_EXPIRED");
  }
  const headers = { Authorization: "Bearer " + session.accessToken, "Content-Type": "application/json" };
  const setupResponse = await fetch(ATLANTIC_API + "/magellan/cozytouch/setupviewv2", {
    headers, cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!setupResponse.ok) throw new Error("ATLANTIC_SETUP_VIEW_FAILED_" + setupResponse.status);
  const setupBody = await setupResponse.json() as unknown;
  const setupCandidates = Array.isArray(setupBody) ? setupBody : [setupBody];
  const setup = setupCandidates.find(item => item && typeof item === "object" &&
    (item as Record<string, unknown>).id !== undefined) as Record<string, unknown> | undefined;
  const setupId = setup?.id;
  if (setupId === undefined || setupId === null) throw new Error("ATLANTIC_SETUP_ID_MISSING");

  const response = await fetch(ATLANTIC_API + "/magellan/setups/" + encodeURIComponent(String(setupId)) +
    "/consumptions?periodicity=" + periodicity, {
    headers, cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    // Preserve the provider's diagnostic response, but never include request headers or credentials.
    const responseBody = (await response.text().catch(() => "")).replace(/\\s+/g, " ").slice(0, 700);
    const detail = responseBody ? ":" + responseBody : "";
    throw new Error("ATLANTIC_" + periodicity.toUpperCase() + "_CONSUMPTION_FAILED_" + response.status + detail);
  }
  const payload = await response.json() as unknown;
  const parsed = parseEnergyPayload(payload);
  const periods = parsed.periods;
  if (!periods.length) {
    return periodicity === "daily"
      ? { available: false, totalKwh: null, peakKwh: null, offPeakKwh: null, date: null, source: "Atlantic daily consumption", diagnostics: parsed.diagnostics }
      : { available: false, periods: [], date: null, source: "Atlantic hourly consumption", diagnostics: parsed.diagnostics };
  }
  const latestDay = Math.max(...periods.map(period => Math.floor(period.timestamp / 86400)));
  const latest = periods.filter(period => Math.floor(period.timestamp / 86400) === latestDay).sort((a,b) => a.timestamp-b.timestamp);
  if (periodicity === "hourly") {
    return {
      available: true, periods: latest, date: new Date(latestDay * 86400 * 1000).toISOString(),
      source: "Atlantic hourly consumption", scope: "setup", diagnostics: parsed.diagnostics
    };
  }
  const sum = (mode?: number) => Number(latest.filter(period => mode === undefined || period.mode === mode)
    .reduce((total, period) => total + period.quantityKwh, 0).toFixed(3));
  const hasTariffs = latest.some(period => period.mode === 1) && latest.some(period => period.mode === 2);
  return {
    available: true, totalKwh: sum(), peakKwh: hasTariffs ? sum(1) : null,
    offPeakKwh: hasTariffs ? sum(2) : null, date: new Date(latestDay * 86400 * 1000).toISOString(),
    source: "Atlantic daily consumption", scope: "setup", diagnostics: parsed.diagnostics
  };
}

export async function getDailySetupConsumption() {
  return getSetupConsumption("daily");
}

export async function getHourlySetupConsumption() {
  return getSetupConsumption("hourly");
}

export function readInstantPowerW(rawStates: Record<string, unknown>[]) {
  for (const state of rawStates) {
    const name = String(state.name ?? state.qualifiedName ?? "");
    if (!/(ElectricPower|ActivePower|InstantaneousPower|CurrentPower)/i.test(name)) continue;
    const value = state.value;
    const unit = String(state.unit ?? state.unitSymbol ?? "").toLowerCase();
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(numeric)) continue;
    if (unit === "w" || unit === "watt" || unit === "watts") return Math.round(numeric);
    if (unit === "kw" || unit === "kilowatt" || unit === "kilowatts") return Math.round(numeric * 1000);
  }
  return null;
}
