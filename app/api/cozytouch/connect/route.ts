import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://apis.groupe-atlantic.com";
const CLIENT_ID = "Q3RfMUpWeVRtSUxYOEllZkE3YVVOQmpGblpVYToyRWNORHpfZHkzNDJVSnFvMlo3cFNKTnZVdjBh";

export async function POST(request: Request) {
  let stage = "request";
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  }
  try {
    stage = "session_config";
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password || email.length > 254 || password.length > 512) {
      return NextResponse.json({ error: "Вкажи email і пароль Cozytouch." }, { status: 400 });
    }

    stage = "atlantic_auth";
    const form = new URLSearchParams({
      grant_type: "password",
      scope: "openid",
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
      return NextResponse.json(
        { error: invalid ? "Cozytouch не прийняв ці облікові дані." : "Не вдалося авторизуватися в Cozytouch. Спробуй пізніше." },
        { status: invalid ? 401 : 502 }
      );
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
      return NextResponse.json({ error: "Atlantic прийняв авторизацію, але не віддав список пристроїв.", stage: "read_devices", upstreamStatus: setupResponse.status }, { status: 502 });
    }

    const setup = await setupResponse.json();
    const account = Array.isArray(setup) ? setup[0] : null;
    if (!account || !Array.isArray(account.devices)) {
      console.error("[cozytouch] unexpected setup response", { isArray: Array.isArray(setup), hasAccount: Boolean(account), devicesType: typeof account?.devices });
      return NextResponse.json({ error: "Atlantic повернув неочікувану структуру даних акаунта.", stage: "parse_devices" }, { status: 502 });
    }
    const devices = Array.isArray(account?.devices) ? account.devices : [];

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
    if (stage === "session_config" || stage === "save_session") {
      return NextResponse.json({ error: "Помилка налаштування сесії на сервері. Перевір SESSION_PASSWORD у Vercel: значення має бути не коротше 32 символів.", stage }, { status: 500 });
    }
    if (stage === "atlantic_auth") {
      return NextResponse.json({ error: "Не вдалося зв'язатися із сервером авторизації Atlantic. Перевір мережу та спробуй ще раз.", stage }, { status: 502 });
    }
    if (stage === "read_devices") {
      return NextResponse.json({ error: "Авторизація Cozytouch пройшла, але запит списку пристроїв завершився помилкою.", stage }, { status: 502 });
    }
    return NextResponse.json({ error: "Помилка сервера під час підключення Cozytouch.", stage }, { status: 500 });
  }
}
