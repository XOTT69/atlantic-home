import { allowLogin } from "@/lib/login-limit";
import { hasAppAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { attachCozytouchSessionCookie, getCozytouchSession } from "@/lib/session";
import { saveBackgroundCredentials } from "@/lib/energy-store";
import { ATLANTIC_API as API, ATLANTIC_CLIENT_ID as CLIENT_ID } from "@/lib/atlantic-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function browserResult(title: string, message: string, success = false) {
  const color = success ? "#087f5b" : "#b42318";
  const html = `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title} · Atlantic Home</title><body style="margin:0;background:#f4f9ff;color:#172b4d;font:16px -apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh;display:grid;place-items:center"><main style="box-sizing:border-box;width:min(92%,440px);padding:28px;border:1px solid #dce8f5;border-radius:24px;background:white;box-shadow:0 12px 40px #163b6412"><div style="font-size:13px;color:#66809e;letter-spacing:.12em;font-weight:700">ATLANTIC HOME</div><h1 style="font-size:24px;margin:18px 0 10px">${title}</h1><p style="line-height:1.55;color:${color}">${message}</p><a href="/" style="display:block;text-align:center;margin-top:24px;padding:14px;border-radius:14px;background:#1769aa;color:white;text-decoration:none;font-weight:600">Повернутися до застосунку</a></main></body></html>`;
  return new NextResponse(html, { status: success ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  let stage = "request";
  const wantsHtml = !(request.headers.get("content-type") ?? "").includes("application/json");
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    if (wantsHtml) return browserResult("Запит відхилено", "Онови сторінку застосунку та повтори підключення.");
    return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  }
  try {
    if (!await allowLogin(request, "cozytouch-connect")) return NextResponse.json({ error: "Забагато спроб підключення. Повтори через 10 хвилин." }, { status: 429, headers: { "Retry-After": "600" } });
    stage = "session_config";
    const contentType = request.headers.get("content-type") ?? "";
    let body: { email?: unknown; password?: unknown };
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      body = { email: formData.get("email"), password: formData.get("password") };
    }
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password || email.length > 254 || password.length > 512) {
      if (wantsHtml) return browserResult("Не вдалося підключитися", "Перевір email і пароль та спробуй ще раз.");
      return NextResponse.json({ error: "Вкажи email і пароль Cozytouch." }, { status: 400 });
    }

    stage = "atlantic_auth";
    const makeAuthForm = (requestOfflineAccess: boolean) => new URLSearchParams({
      grant_type: "password",
      scope: `openid ${requestOfflineAccess ? "offline_access " : ""}device_${Math.floor(Date.now() / 1000)}`,
      username: "GA-PRIVATEPERSON/" + email,
      password
    });
    const requestToken = (form: URLSearchParams) => fetch(API + "/users/token", {
      method: "POST",
      headers: { Authorization: "Basic " + CLIENT_ID, "Content-Type": "application/x-www-form-urlencoded" },
      body: form, cache: "no-store", signal: AbortSignal.timeout(20000)
    });
    let authResponse = await requestToken(makeAuthForm(true));
    let token = await authResponse.json().catch(() => null);
    if (!authResponse.ok && token?.error === "invalid_scope") {
      authResponse = await requestToken(makeAuthForm(false));
      token = await authResponse.json().catch(() => null);
    }
    if (!authResponse.ok || !token?.access_token || !token?.token_type) {
      console.error("[cozytouch] auth rejected", { status: authResponse.status, error: token?.error ?? null, hasToken: Boolean(token?.access_token), hasTokenType: Boolean(token?.token_type) });
      const invalid = token?.error === "invalid_grant";
      const message = invalid ? "Cozytouch не прийняв ці облікові дані." : "Не вдалося авторизуватися в Cozytouch. Спробуй пізніше.";
      if (wantsHtml) return browserResult("Авторизація не пройшла", message);
      return NextResponse.json({ error: message }, { status: invalid ? 401 : 502 });
    }

    stage = "save_session";
    const session = await getCozytouchSession();
    session.accessToken = token.access_token;
    session.expiresAt = Date.now() + (Number(token.expires_in) || 3600) * 1000 - 60000;
    session.connectedAt = Date.now();

    stage = "read_devices";
    const setupResponse = await fetch(API + "/magellan/cozytouch/setupviewv2", {
      headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });

    if (!setupResponse.ok) {
      console.error("[cozytouch] setup request failed", { status: setupResponse.status });
      const message = "Atlantic прийняв авторизацію, але не віддав список пристроїв.";
      if (wantsHtml) return browserResult("Акаунт авторизовано частково", message);
      return NextResponse.json({ error: message, stage: "read_devices", upstreamStatus: setupResponse.status }, { status: 502 });
    }

    const setup = await setupResponse.json();

    // Read-only cross-checks: setupviewv2 can be empty while other account
    // collections may reveal whether this API client can see the installation.
    const probePaths: string[] = [];
    const probeResults = await Promise.all(probePaths.map(async path => {
      try {
        const response = await fetch(API + path, {
          headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(12000)
        });
        const body = await response.json().catch(() => null);
        const sample = Array.isArray(body) ? body[0] : body;
        return {
          path,
          status: response.status,
          bodyType: Array.isArray(body) ? "array" : body === null ? "null" : typeof body,
          count: Array.isArray(body) ? body.length : null,
          keys: sample && typeof sample === "object" ? Object.keys(sample as Record<string, unknown>).slice(0, 25) : []
        };
      } catch (error) {
        return { path, status: 0, error: error instanceof Error ? error.name : "RequestError" };
      }
    }));
    // Legacy Cozytouch/Overkiz bridge: older Atlantic integrations expose the
    // installation through the JWT exchange + enduserAPI/setup flow.
    // This is read-only; never return or log the JWT, cookies, or raw setup data.
    let legacySetup: Record<string, unknown> | null = null;
    const legacyProbe: Record<string, unknown> = { jwtStatus: 0, loginStatus: 0, setupStatus: 0 };
    try {
      const jwtResponse = await fetch(API + "/magellan/accounts/jwt", {
        headers: { Authorization: "Bearer " + token.access_token },
        cache: "no-store",
        signal: AbortSignal.timeout(12000)
      });
      legacyProbe.jwtStatus = jwtResponse.status;
      const jwtValue = jwtResponse.ok ? await jwtResponse.text() : "";
      const jwt = jwtValue.trim().replace(/^"|"$/g, "");
      if (jwt && jwt.length > 20) {
        const loginResponse = await fetch("https://ha110-1.overkiz.com/enduser-mobile-web/enduserAPI/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ jwt }),
          cache: "no-store",
          signal: AbortSignal.timeout(12000)
        });
        legacyProbe.loginStatus = loginResponse.status;
        const cookieParts = typeof loginResponse.headers.getSetCookie === "function"
          ? loginResponse.headers.getSetCookie()
          : [loginResponse.headers.get("set-cookie") ?? ""];
        const cookie = cookieParts.map((part: string) => part.split(";")[0]).filter(Boolean).join("; ");
        if (loginResponse.ok && cookie) {
          const oldSetupResponse = await fetch("https://ha110-1.overkiz.com/enduser-mobile-web/enduserAPI/setup", {
            headers: { Cookie: cookie, "Cache-Control": "no-cache" },
            cache: "no-store",
            signal: AbortSignal.timeout(12000)
          });
          legacyProbe.setupStatus = oldSetupResponse.status;
          if (oldSetupResponse.ok) {
            const oldSetup = await oldSetupResponse.json().catch(() => null);
            legacySetup = oldSetup && typeof oldSetup === "object" && !Array.isArray(oldSetup)
              ? oldSetup as Record<string, unknown> : null;
            const oldDevices = legacySetup && Array.isArray(legacySetup.devices) ? legacySetup.devices as unknown[] : [];
            const oldGateways = legacySetup && Array.isArray(legacySetup.gateways) ? legacySetup.gateways as unknown[] : [];
            legacyProbe.setupType = Array.isArray(oldSetup) ? "array" : oldSetup === null ? "null" : typeof oldSetup;
            legacyProbe.setupKeys = oldSetup && typeof oldSetup === "object" && !Array.isArray(oldSetup)
              ? Object.keys(oldSetup as Record<string, unknown>).slice(0, 30) : [];
            legacyProbe.deviceCount = oldDevices.length;
            legacyProbe.gatewayCount = oldGateways.length;
            legacyProbe.firstDeviceKeys = oldDevices[0] && typeof oldDevices[0] === "object"
              ? Object.keys(oldDevices[0] as Record<string, unknown>).slice(0, 30) : [];
            legacyProbe.firstGatewayKeys = oldGateways[0] && typeof oldGateways[0] === "object"
              ? Object.keys(oldGateways[0] as Record<string, unknown>).slice(0, 30) : [];
          }
        }
      }
    } catch (error) {
      legacyProbe.error = error instanceof Error ? error.name : "RequestError";
    }
    console.info("[cozytouch] read-only endpoint probe", probeResults, legacyProbe);
    const setupAccounts = Array.isArray(setup) ? setup : setup && typeof setup === "object" ? [setup] : [];
    const accountDiagnostics = setupAccounts.map((item: unknown) => {
      const account = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        keys: Object.keys(account).slice(0, 30),
        devicesType: Array.isArray(account.devices) ? "array" : typeof account.devices,
        deviceCount: Array.isArray(account.devices) ? account.devices.length : null
      };
    });
    let devices = setupAccounts.flatMap((item: unknown) => {
      const account = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return Array.isArray(account.devices) ? account.devices : [];
    });
    const legacyDevices = legacySetup && Array.isArray(legacySetup.devices)
      ? legacySetup.devices.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
    const usingLegacyApi = devices.length === 0 && legacyDevices.length > 0;
    if (usingLegacyApi) devices = legacyDevices;
    const setupDiagnostics = {
      topLevelType: Array.isArray(setup) ? "array" : setup === null ? "null" : typeof setup,
      topLevelKeys: setup && typeof setup === "object" && !Array.isArray(setup) ? Object.keys(setup as Record<string, unknown>).slice(0, 30) : [],
      accountCount: setupAccounts.length,
      accounts: accountDiagnostics,
      endpointProbes: probeResults,
      legacyProbe: { ...legacyProbe, devices: legacyDevices.map(device => ({
        label: typeof device.label === "string" ? device.label : null,
        controllableName: typeof device.controllableName === "string" ? device.controllableName : null,
        deviceURL: typeof device.deviceURL === "string" ? device.deviceURL : null,
        oid: typeof device.oid === "string" ? device.oid : null,
        available: device.available ?? null,
        enabled: device.enabled ?? null
      })) },
      relatedCollections: setupAccounts.map((item: unknown) => {
        const account = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const describe = (value: unknown) => ({
          type: Array.isArray(value) ? "array" : typeof value,
          count: Array.isArray(value) ? value.length : null,
          firstItemKeys: Array.isArray(value) && value[0] && typeof value[0] === "object"
            ? Object.keys(value[0] as Record<string, unknown>).slice(0, 30)
            : []
        });
        return { gateways: describe(account.gateways), zones: describe(account.zones) };
      })
    };
    if (!devices.length) {
      console.error("[cozytouch] no devices in setup response", setupDiagnostics);
      const message = "Atlantic авторизував акаунт, але список пристроїв порожній. Технічні дані відповіді: " + JSON.stringify(setupDiagnostics);
      if (wantsHtml) return browserResult("Пристрої не знайдено", message);
      return NextResponse.json({ error: message, stage: "empty_devices", diagnostics: setupDiagnostics }, { status: 502 });
    }
    if (devices.some((device: unknown) => !device || typeof device !== "object")) {
      console.error("[cozytouch] invalid device entries", setupDiagnostics);
      const message = "Atlantic повернув некоректний список пристроїв.";
      if (wantsHtml) return browserResult("Не вдалося прочитати пристрої", message);
      return NextResponse.json({ error: message, stage: "parse_devices", diagnostics: setupDiagnostics }, { status: 502 });
    }
    let backgroundCredentialsSaved = false;
    try {
      backgroundCredentialsSaved = await saveBackgroundCredentials({
        accessToken: token.access_token,
        refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : null,
        expiresAt: session.expiresAt,
        connectedAt: session.connectedAt
      });
    } catch (error) {
      console.warn("[cozytouch] background credential storage unavailable", error instanceof Error ? error.name : "UnknownError");
    }
    if (wantsHtml) {
      return await attachCozytouchSessionCookie(
        browserResult("Cozytouch підключено", `Авторизація успішна. Знайдено пристроїв: ${devices.length}. Повернися до застосунку, щоб переглянути дані.`, true),
        session
      );
    }

    return await attachCozytouchSessionCookie(NextResponse.json({
      connected: true,
      deviceCount: devices.length,
      source: usingLegacyApi ? "cozytouch-legacy" : "magellan",
      backgroundCollectionReady: backgroundCredentialsSaved && typeof token.refresh_token === "string",
      devices: devices.map((device: Record<string, unknown>) => ({
        id: String(device.deviceId ?? device.deviceURL ?? device.oid ?? ""),
        name: String(device.name ?? device.label ?? "Atlantic"),
        modelId: device.modelId ?? device.controllableName ?? null,
        productId: device.productId ?? null,
        modelFamily: device.modelFamily ?? device.uiClass ?? null,
        isAvailable: device.isAvailable ?? device.available ?? null,
        enabled: device.enabled ?? null,
        deviceURL: device.deviceURL ?? null,
        oid: device.oid ?? null,
        type: device.type ?? null,
        capabilities: Array.isArray(device.capabilities)
          ? device.capabilities.map((item: Record<string, unknown>) => ({
              id: Number(item.capabilityId),
              value: item.value == null ? null : String(item.value),
              updatedAt: item.modificationDate ?? null
            })).filter((item: { id: number }) => Number.isFinite(item.id))
          : []
      }))
    }), session);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cozytouch] connection exception", { stage, name: error instanceof Error ? error.name : "UnknownError", message });
    let userMessage = "Помилка сервера під час підключення Cozytouch.";
    if (stage === "session_config" || stage === "save_session") {
      userMessage = "Помилка налаштування сесії на сервері. Перевір SESSION_PASSWORD у Vercel: значення має бути не коротше 32 символів.";
    } else if (stage === "atlantic_auth") {
      userMessage = "Не вдалося зв'язатися із сервером авторизації Atlantic. Перевір мережу та спробуй ще раз.";
    } else if (stage === "read_devices") {
      userMessage = "Авторизація Cozytouch пройшла, але запит списку пристроїв завершився помилкою.";
    }
    if (wantsHtml) return browserResult("Помилка підключення", userMessage);
    return NextResponse.json({ error: userMessage, stage }, { status: 500 });
  }
}
