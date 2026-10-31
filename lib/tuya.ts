import { createHash, createHmac, randomUUID } from "node:crypto";

type TuyaEnvelope<T> = { success?: boolean; result?: T; code?: number | string; msg?: string };
type TuyaFunction = { code: string; type?: string; values?: string; name?: string; desc?: string };
type TuyaStatus = { code: string; value: unknown };

const DATA_CENTERS: Record<string, string> = {
  eu: "https://openapi.tuyaeu.com",
  weu: "https://openapi-weaz.tuyaeu.com",
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function config() {
  const clientId = process.env.TUYA_ACCESS_ID?.trim();
  const secret = process.env.TUYA_ACCESS_SECRET?.trim();
  const deviceId = process.env.TUYA_DEVICE_ID?.trim();
  const region = (process.env.TUYA_REGION ?? "eu").trim().toLowerCase();
  const baseUrl = DATA_CENTERS[region];
  return clientId && secret && deviceId && baseUrl ? { clientId, secret, deviceId, baseUrl } : null;
}

function signature(secret: string, message: string) {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex").toUpperCase();
}

async function tuyaRequest<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown, token?: string): Promise<TuyaEnvelope<T>> {
  const settings = config();
  if (!settings) throw new Error("MYCOND_TUYA_NOT_CONFIGURED");
  const timestamp = Date.now().toString();
  const nonce = randomUUID().replaceAll("-", "");
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const stringToSign = `${method}\n${bodyHash}\n\n${path}`;
  const prefix = token
    ? `${settings.clientId}${token}${timestamp}${nonce}`
    : `${settings.clientId}${timestamp}${nonce}`;
  const sign = signature(settings.secret, prefix + stringToSign);
  const response = await fetch(`${settings.baseUrl}${path}`, {
    method,
    headers: {
      client_id: settings.clientId,
      t: timestamp,
      nonce,
      sign,
      sign_method: "HMAC-SHA256",
      ...(token ? { access_token: token } : {}),
      ...(bodyText ? { "Content-Type": "application/json" } : {}),
    },
    body: bodyText || undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => null) as TuyaEnvelope<T> | null;
  if (!response.ok || !result?.success) {
    const code = result?.code === undefined ? `HTTP_${response.status}` : String(result.code);
    throw new Error(`MYCOND_TUYA_API_${code}`);
  }
  return result;
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await tuyaRequest<{ access_token?: string; expire_time?: number }>("/v1.0/token?grant_type=1");
  const token = response.result?.access_token;
  if (!token) throw new Error("MYCOND_TUYA_TOKEN_MISSING");
  cachedToken = { value: token, expiresAt: Date.now() + Math.max(60, response.result?.expire_time ?? 7200) * 1000 };
  return token;
}

export function isTuyaConfigured() {
  return config() !== null;
}

export async function getMycondSnapshot() {
  const settings = config();
  if (!settings) return { configured: false as const, online: null, statuses: [], functions: [], deviceName: null };
  const token = await getToken();
  const devicePath = encodeURIComponent(settings.deviceId);
  const [statusResponse, specResponse, infoResponse] = await Promise.all([
    tuyaRequest<TuyaStatus[]>(`/v1.0/iot-03/devices/${devicePath}/status`, "GET", undefined, token),
    tuyaRequest<{ category?: string; functions?: TuyaFunction[]; status?: TuyaFunction[] }>(`/v1.1/iot-03/devices/${devicePath}/specification`, "GET", undefined, token),
    tuyaRequest<{ name?: string; online?: boolean; is_online?: boolean }>(`/v1.1/iot-03/devices/${devicePath}`, "GET", undefined, token).catch(() => null),
  ]);
  const statuses = Array.isArray(statusResponse.result) ? statusResponse.result : [];
  const spec = specResponse.result;
  const functions = Array.isArray(spec?.functions) ? spec.functions : [];
  return {
    configured: true as const,
    online: typeof infoResponse?.result?.online === "boolean"
      ? infoResponse.result.online
      : typeof infoResponse?.result?.is_online === "boolean" ? infoResponse.result.is_online : null,
    deviceName: typeof infoResponse?.result?.name === "string" ? infoResponse.result.name : null,
    statuses,
    functions,
  };
}

function parseValues(fn: TuyaFunction): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fn.values ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function sendMycondCommand(code: string, value: unknown) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(code)) throw new Error("MYCOND_INVALID_COMMAND");
  const snapshot = await getMycondSnapshot();
  if (!snapshot.configured) throw new Error("MYCOND_TUYA_NOT_CONFIGURED");
  const fn = snapshot.functions.find(item => item.code === code);
  if (!fn) throw new Error("MYCOND_UNSUPPORTED_COMMAND");
  const values = parseValues(fn);
  const type = (fn.type ?? "").toLowerCase();
  let safeValue: unknown;
  if (type === "boolean") {
    if (typeof value !== "boolean") throw new Error("MYCOND_INVALID_COMMAND_VALUE");
    safeValue = value;
  } else if (type === "enum") {
    const range = Array.isArray(values.range) ? values.range : [];
    if (typeof value !== "string" || !range.includes(value)) throw new Error("MYCOND_INVALID_COMMAND_VALUE");
    safeValue = value;
  } else if (type === "integer" || type === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    const min = Number(values.min);
    const max = Number(values.max);
    const step = Number(values.step ?? 1);
    if (!Number.isFinite(numberValue) || !Number.isFinite(min) || !Number.isFinite(max) || numberValue < min || numberValue > max || !Number.isFinite(step) || step <= 0 || Math.abs((numberValue - min) / step - Math.round((numberValue - min) / step)) > 1e-6) {
      throw new Error("MYCOND_INVALID_COMMAND_VALUE");
    }
    safeValue = numberValue;
  } else {
    throw new Error("MYCOND_UNSUPPORTED_COMMAND_TYPE");
  }
  const settings = config();
  if (!settings) throw new Error("MYCOND_TUYA_NOT_CONFIGURED");
  const token = await getToken();
  return tuyaRequest<boolean>(`/v1.0/iot-03/devices/${encodeURIComponent(settings.deviceId)}/commands`, "POST", { commands: [{ code, value: safeValue }] }, token);
}
