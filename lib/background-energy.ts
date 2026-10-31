import { ATLANTIC_API, ATLANTIC_CLIENT_ID } from "@/lib/atlantic-auth";
import { getBackgroundCredentials, saveBackgroundCredentials, saveEnergySample } from "@/lib/energy-store";

const OVERKIZ_API = "https://ha110-1.overkiz.com/enduser-mobile-web/enduserAPI";

function providerError(code: string): never {
  throw new Error(code);
}

async function getFreshAccessToken() {
  let credentials = await getBackgroundCredentials();
  if (!credentials || typeof credentials.accessToken !== "string" || typeof credentials.expiresAt !== "number") {
    return providerError("BACKGROUND_COZYTOUCH_NOT_CONNECTED");
  }
  if (credentials.expiresAt > Date.now() + 2 * 60_000) return credentials.accessToken;
  if (typeof credentials.refreshToken !== "string" || !credentials.refreshToken) {
    return providerError("BACKGROUND_REFRESH_TOKEN_MISSING");
  }

  const response = await fetch(ATLANTIC_API + "/users/token", {
    method: "POST",
    headers: { Authorization: "Basic " + ATLANTIC_CLIENT_ID, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refreshToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const token = await response.json().catch(() => null);
  if (!response.ok || typeof token?.access_token !== "string") {
    return providerError(token?.error === "invalid_grant" ? "BACKGROUND_REFRESH_REVOKED" : "BACKGROUND_REFRESH_FAILED");
  }
  const nextCredentials = {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : credentials.refreshToken,
    expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000 - 60_000,
    connectedAt: credentials.connectedAt
  };
  const saved = await saveBackgroundCredentials(nextCredentials);
  if (!saved) return providerError("BACKGROUND_CREDENTIAL_STORE_FAILED");
  credentials = nextCredentials;
  return credentials.accessToken as string;
}

async function getOverkizSetup(accessToken: string) {
  const jwtResponse = await fetch(ATLANTIC_API + "/magellan/accounts/jwt", {
    headers: { Authorization: "Bearer " + accessToken }, cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!jwtResponse.ok) return providerError("BACKGROUND_ATLANTIC_JWT_FAILED");
  const jwt = (await jwtResponse.text()).trim().replace(/^"|"$/g, "");
  if (jwt.length < 20) return providerError("BACKGROUND_ATLANTIC_JWT_INVALID");
  const loginResponse = await fetch(OVERKIZ_API + "/login", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ jwt }), cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!loginResponse.ok) return providerError("BACKGROUND_OVERKIZ_LOGIN_FAILED");
  const cookieParts = typeof loginResponse.headers.getSetCookie === "function"
    ? loginResponse.headers.getSetCookie()
    : [loginResponse.headers.get("set-cookie") ?? ""];
  const cookie = cookieParts.map(part => part.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) return providerError("BACKGROUND_OVERKIZ_COOKIE_MISSING");
  const setupResponse = await fetch(OVERKIZ_API + "/setup", {
    headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!setupResponse.ok) return providerError("BACKGROUND_OVERKIZ_SETUP_FAILED");
  return { cookie, setup: await setupResponse.json() as Record<string, unknown> };
}

export async function collectBackgroundEnergy() {
  const accessToken = await getFreshAccessToken();
  const { cookie, setup } = await getOverkizSetup(accessToken);
  const devices = Array.isArray(setup.devices) ? setup.devices as Record<string, unknown>[] : [];
  const energyDevice = devices.find(device => /energy|consumption/i.test(String(device.controllableName ?? "")) ||
    (Array.isArray((device.definition as Record<string, unknown> | undefined)?.states) &&
      ((device.definition as { states: { qualifiedName?: string }[] }).states).some(state => /ElectricEnergyConsumption/i.test(String(state.qualifiedName ?? "")))));
  if (!energyDevice || typeof energyDevice.deviceURL !== "string") return providerError("BACKGROUND_ENERGY_SENSOR_NOT_FOUND");
  const response = await fetch(OVERKIZ_API + "/setup/devices/" + encodeURIComponent(energyDevice.deviceURL) + "/states", {
    headers: { Cookie: cookie, "Cache-Control": "no-cache" }, cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return providerError("BACKGROUND_ENERGY_STATE_FAILED");
  const states = await response.json() as Record<string, unknown>[];
  const energyState = Array.isArray(states) ? states.find(state => /ElectricEnergyConsumption/i.test(String(state.name ?? state.qualifiedName ?? ""))) : null;
  const rawWh = energyState?.value;
  const cumulativeWh = typeof rawWh === "number" ? rawWh : typeof rawWh === "string" ? Number(rawWh) : NaN;
  if (!Number.isSafeInteger(cumulativeWh) || cumulativeWh < 0) return providerError("BACKGROUND_ENERGY_VALUE_INVALID");
  const saved = await saveEnergySample(energyDevice.deviceURL, cumulativeWh);
  if (!saved.configured) return providerError("BACKGROUND_ENERGY_DATABASE_UNAVAILABLE");
  return { sampled: true, sampledAt: new Date().toISOString(), cumulativeEnergyWh: cumulativeWh, source: "Atlantic Cozytouch" };
}
