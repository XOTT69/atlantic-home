import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://apis.groupe-atlantic.com";
const OVERKIZ = "https://ha110-1.overkiz.com/enduser-mobile-web/enduserAPI";

export async function GET() {
  try {
    const session = await getCozytouchSession();
    if (!session.accessToken || !session.expiresAt || Date.now() >= session.expiresAt) {
      session.destroy();
      return NextResponse.json({ connected: false, error: "Сесія Cozytouch завершилася. Підключи акаунт знову." }, { status: 401 });
    }

    // This Atlantic account returns an empty Magellan device collection.
    // Use the legacy Cozytouch setup endpoint that was verified for this account.
    const jwtResponse = await fetch(API + "/magellan/accounts/jwt", {
      headers: { Authorization: "Bearer " + session.accessToken },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    });
    if (!jwtResponse.ok) {
      return NextResponse.json({ connected: true, error: "Atlantic не видав токен доступу до списку пристроїв." }, { status: 502 });
    }
    const jwtText = await jwtResponse.text();
    const jwt = jwtText.trim().replace(/^"|"$/g, "");
    if (!jwt || jwt.length < 20) {
      return NextResponse.json({ connected: true, error: "Atlantic повернув некоректний токен Cozytouch." }, { status: 502 });
    }

    const loginResponse = await fetch(OVERKIZ + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ jwt }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    });
    if (!loginResponse.ok) {
      return NextResponse.json({ connected: true, error: "Не вдалося відкрити сесію пристроїв Cozytouch." }, { status: 502 });
    }
    const cookieParts = typeof loginResponse.headers.getSetCookie === "function"
      ? loginResponse.headers.getSetCookie()
      : [loginResponse.headers.get("set-cookie") ?? ""];
    const cookie = cookieParts.map(part => part.split(";")[0]).filter(Boolean).join("; ");
    if (!cookie) {
      return NextResponse.json({ connected: true, error: "Cozytouch не повернув сесійну cookie." }, { status: 502 });
    }

    const setupResponse = await fetch(OVERKIZ + "/setup", {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    });
    if (!setupResponse.ok) {
      return NextResponse.json({ connected: true, error: "Не вдалося зчитати конфігурацію пристроїв Cozytouch." }, { status: 502 });
    }
    const setup = await setupResponse.json();
    const devices = setup && typeof setup === "object" && Array.isArray(setup.devices) ? setup.devices : [];

    return NextResponse.json({
      connected: true,
      source: "cozytouch-legacy",
      updatedAt: new Date().toISOString(),
      gatewayCount: Array.isArray(setup.gateways) ? setup.gateways.length : 0,
      devices: devices.map((device: Record<string, unknown>) => ({
        id: String(device.deviceURL ?? device.oid ?? ""),
        name: String(device.label ?? device.controllableName ?? "Atlantic"),
        modelId: device.controllableName ?? null,
        productId: null,
        modelFamily: device.uiClass ?? null,
        isAvailable: device.available ?? null,
        enabled: device.enabled ?? null,
        deviceURL: device.deviceURL ?? null,
        oid: device.oid ?? null,
        type: device.type ?? null,
        controllableName: device.controllableName ?? null,
        placeOID: device.placeOID ?? null,
        shortcut: device.shortcut ?? null,
        // Cozytouch definitions/widgets are descriptive metadata, not credentials.
        // Expose them read-only so we can identify the real thermostat endpoint
        // and its supported states/commands before implementing any controls.
        definition: device.definition ?? null,
        widget: device.widget ?? null,
        capabilities: []
      })),
      zones: Array.isArray(setup.zones) ? setup.zones.map((zone: Record<string, unknown>) => ({
        name: zone.name ?? zone.label ?? null,
        oid: zone.oid ?? null,
        placeOID: zone.placeOID ?? null,
        type: zone.type ?? null,
        keys: Object.keys(zone)
      })) : [],
      gateways: Array.isArray(setup.gateways) ? setup.gateways.map((gateway: Record<string, unknown>) => ({
        gatewayId: gateway.gatewayId ?? null,
        type: gateway.type ?? null,
        subType: gateway.subType ?? null,
        placeOID: gateway.placeOID ?? null,
        alive: gateway.alive ?? null,
        connectivity: gateway.connectivity ?? null,
        mode: gateway.mode ?? null,
        functions: gateway.functions ?? null
      })) : []
    });
  } catch {
    return NextResponse.json({ error: "Не вдалося отримати стан пристроїв Cozytouch." }, { status: 500 });
  }
}
