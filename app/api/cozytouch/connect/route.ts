import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://apis.groupe-atlantic.com";
const CLIENT_ID = "Q3RfMUpWeVRtSUxYOEllZkE3YVVOQmpGblpVYToyRWNORHpfZHkzNDJVSnFvMlo3cFNKTnZVdjBh";

function browserResult(title: string, message: string, success = false) {
  const color = success ? "#087f5b" : "#b42318";
  const html = `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title} · Atlantic Home</title><body style="margin:0;background:#f4f9ff;color:#172b4d;font:16px -apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh;display:grid;place-items:center"><main style="box-sizing:border-box;width:min(92%,440px);padding:28px;border:1px solid #dce8f5;border-radius:24px;background:white;box-shadow:0 12px 40px #163b6412"><div style="font-size:13px;color:#66809e;letter-spacing:.12em;font-weight:700">ATLANTIC HOME</div><h1 style="font-size:24px;margin:18px 0 10px">${title}</h1><p style="line-height:1.55;color:${color}">${message}</p><a href="/" style="display:block;text-align:center;margin-top:24px;padding:14px;border-radius:14px;background:#1769aa;color:white;text-decoration:none;font-weight:600">Повернутися до застосунку</a></main></body></html>`;
  return new Response(html, { status: success ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let stage = "request";
  const wantsHtml = !(request.headers.get("content-type") ?? "").includes("application/json");
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    if (wantsHtml) return browserResult("Запит відхилено", "Онови сторінку застосунку та повтори підключення.");
    return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  }
  try {
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
    const form = new URLSearchParams({
      grant_type: "password",
      scope: "openid device_" + Math.floor(Date.now() / 1000),
      username: "GA-PRIVATEPERSON/" + email,
      password
    });

    const authResponse = await fetch(API + "/users/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + CLIENT_ID,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });

    const token = await authResponse.json().catch(() => null);
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
    await session.save();

    stage = "read_devices";
    const setupResponse = await fetch(API + "/magellan/cozytouch/setupviewv2", {
      headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });

    if (!setupResponse.ok) {
      session.destroy();
      console.error("[cozytouch] setup request failed", { status: setupResponse.status });
      const message = "Atlantic прийняв авторизацію, але не віддав список пристроїв.";
      if (wantsHtml) return browserResult("Акаунт авторизовано частково", message);
      return NextResponse.json({ error: message, stage: "read_devices", upstreamStatus: setupResponse.status }, { status: 502 });
    }

    const setup = await setupResponse.json();
    const setupAccounts = Array.isArray(setup) ? setup : setup && typeof setup === "object" ? [setup] : [];
    const accountDiagnostics = setupAccounts.map((item: unknown) => {
      const account = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        keys: Object.keys(account).slice(0, 30),
        devicesType: Array.isArray(account.devices) ? "array" : typeof account.devices,
        deviceCount: Array.isArray(account.devices) ? account.devices.length : null
      };
    });
    const devices = setupAccounts.flatMap((item: unknown) => {
      const account = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return Array.isArray(account.devices) ? account.devices : [];
    });
    const setupDiagnostics = {
      topLevelType: Array.isArray(setup) ? "array" : setup === null ? "null" : typeof setup,
      topLevelKeys: setup && typeof setup === "object" && !Array.isArray(setup) ? Object.keys(setup as Record<string, unknown>).slice(0, 30) : [],
      accountCount: setupAccounts.length,
      accounts: accountDiagnostics
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
    if (wantsHtml) {
      return browserResult("Cozytouch підключено", `Авторизація успішна. Знайдено пристроїв: ${devices.length}. Повернися до застосунку, щоб переглянути дані.`, true);
    }

    return NextResponse.json({
      connected: true,
      deviceCount: devices.length,
      devices: devices.map((device: Record<string, unknown>) => ({
        id: String(device.deviceId ?? ""),
        name: String(device.name ?? "Atlantic"),
        modelId: device.modelId ?? null,
        productId: device.productId ?? null,
        modelFamily: device.modelFamily ?? null,
        isAvailable: device.isAvailable ?? null,
        capabilities: Array.isArray(device.capabilities)
          ? device.capabilities.map((item: Record<string, unknown>) => ({
              id: Number(item.capabilityId),
              value: item.value == null ? null : String(item.value),
              updatedAt: item.modificationDate ?? null
            })).filter((item: { id: number }) => Number.isFinite(item.id))
          : []
      }))
    });
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
