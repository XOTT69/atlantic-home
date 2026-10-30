import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://apis.groupe-atlantic.com";
const CLIENT_ID = "Q3RfMUpWeVRtSUxYOEllZkE3YVVOQmpGblpVYToyRWNORHpfZHkzNDJVSnFvMlo3cFNKTnZVdjBh";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password || email.length > 254 || password.length > 512) {
      return NextResponse.json({ error: "Вкажи email і пароль Cozytouch." }, { status: 400 });
    }

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
    if (!authResponse.ok || !token?.access_token) {
      const invalid = token?.error === "invalid_grant";
      return NextResponse.json(
        { error: invalid ? "Cozytouch не прийняв ці облікові дані." : "Не вдалося авторизуватися в Cozytouch. Спробуй пізніше." },
        { status: invalid ? 401 : 502 }
      );
    }

    const session = await getCozytouchSession();
    session.accessToken = token.access_token;
    session.expiresAt = Date.now() + (Number(token.expires_in) || 3600) * 1000 - 60000;
    session.connectedAt = Date.now();
    await session.save();

    const setupResponse = await fetch(API + "/magellan/cozytouch/setupviewv2", {
      headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });

    if (!setupResponse.ok) {
      session.destroy();
      return NextResponse.json({ error: "Авторизація пройшла, але Cozytouch не повернув список пристроїв." }, { status: 502 });
    }

    const setup = await setupResponse.json();
    const account = Array.isArray(setup) ? setup[0] : null;
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
        capabilityIds: Array.isArray(device.capabilities)
          ? device.capabilities.map((item: Record<string, unknown>) => Number(item.capabilityId)).filter(Number.isFinite)
          : []
      }))
    });
  } catch {
    return NextResponse.json({ error: "Сервер не зміг з'єднатися з Cozytouch. Перевір налаштування та спробуй ще раз." }, { status: 500 });
  }
}
