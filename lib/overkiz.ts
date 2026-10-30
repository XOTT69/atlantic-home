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


export async function getDailySetupConsumption() {
  const session = await getCozytouchSession();
  if (!session.accessToken || !session.expiresAt || Date.now() >= session.expiresAt) {
    throw new Error("COZYTOUCH_SESSION_EXPIRED");
  }
  const headers = { Authorization: "Bearer " + session.accessToken, "Content-Type": "application/json" };
  const setupResponse = await fetch(ATLANTIC_API + "/magellan/cozytouch/setupviewv2", {
    headers, cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!setupResponse.ok) throw new Error("ATLANTIC_SETUP_VIEW_FAILED");
  const setupBody = await setupResponse.json() as unknown;
  const setup = Array.isArray(setupBody) ? setupBody[0] as Record<string, unknown> | undefined : setupBody as Record<string, unknown>;
  const setupId = setup?.id;
  if (setupId === undefined || setupId === null) throw new Error("ATLANTIC_SETUP_ID_MISSING");

  const response = await fetch(ATLANTIC_API + "/magellan/setups/" + encodeURIComponent(String(setupId)) + "/consumptions?periodicity=daily", {
    headers, cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("ATLANTIC_CONSUMPTION_FAILED");
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error("ATLANTIC_CONSUMPTION_INVALID");

  const series = payload.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === "object" && item.type === 1 && item.unit === 1 && Array.isArray(item.consumptionPeriods)
  );
  const periods = series.flatMap(item => (item.consumptionPeriods as Record<string, unknown>[]).filter(period => Number.isInteger(period.date)));
  if (!periods.length) return { available: false, totalKwh: null, peakKwh: null, offPeakKwh: null, date: null, source: "Atlantic daily consumption" };
  const latestDate = Math.max(...periods.map(period => Number(period.date)));
  const today = periods.filter(period => Number(period.date) === latestDate);
  const sum = (mode?: number) => Number(today.filter(period => mode === undefined || Number(period.mode ?? 0) === mode)
    .reduce((total, period) => total + (typeof period.consumedQuantity === "number" ? period.consumedQuantity : 0), 0).toFixed(3));
  const hasTariffs = today.some(period => Number(period.mode ?? 0) === 1) && today.some(period => Number(period.mode ?? 0) === 2);
  return {
    available: true, totalKwh: sum(), peakKwh: hasTariffs ? sum(1) : null,
    offPeakKwh: hasTariffs ? sum(2) : null, date: new Date(latestDate * 1000).toISOString(),
    source: "Atlantic daily consumption", scope: "setup"
  };
}
