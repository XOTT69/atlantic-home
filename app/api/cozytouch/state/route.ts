import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://apis.groupe-atlantic.com";

export async function GET() {
  try {
    const session = await getCozytouchSession();
    if (!session.accessToken || !session.expiresAt || Date.now() >= session.expiresAt) {
      session.destroy();
      return NextResponse.json({ connected: false, error: "Сесія Cozytouch завершилася. Підключи акаунт знову." }, { status: 401 });
    }

    const response = await fetch(API + "/magellan/cozytouch/setupviewv2", {
      headers: { Authorization: "Bearer " + session.accessToken, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });

    if (response.status === 401 || response.status === 403) {
      session.destroy();
      return NextResponse.json({ connected: false, error: "Cozytouch завершив сесію. Підключи акаунт знову." }, { status: 401 });
    }
    if (response.status === 429) {
      return NextResponse.json({ error: "Cozytouch тимчасово обмежив запити. Зачекай кілька хвилин." }, { status: 429 });
    }
    if (!response.ok) {
      return NextResponse.json({ error: "Cozytouch тимчасово недоступний." }, { status: 502 });
    }

    const setup = await response.json();
    const account = Array.isArray(setup) ? setup[0] : null;
    const devices = Array.isArray(account?.devices) ? account.devices : [];

    return NextResponse.json({
      connected: true,
      updatedAt: new Date().toISOString(),
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
              value: item.value == null ? null : String(item.value)
            })).filter((item: { id: number }) => Number.isFinite(item.id))
          : []
      }))
    });
  } catch {
    return NextResponse.json({ error: "Не вдалося отримати стан пристрою." }, { status: 500 });
  }
}
