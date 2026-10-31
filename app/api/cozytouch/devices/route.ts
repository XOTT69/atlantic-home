import { NextResponse } from "next/server";
import { hasAppAccess } from "@/lib/access";
import { getHomeDevices, saveHomeDevices } from "@/lib/energy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVICE_TYPES = new Set(["atlantic-heater", "mycond-roomer-12", "custom"]);

export async function GET(request: Request) {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  const installationId = new URL(request.url).searchParams.get("installationId") ?? "";
  try {
    const devices = await getHomeDevices(installationId);
    return NextResponse.json({ configured: devices !== null, devices }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося завантажити пристрої." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  try {
    const body = await request.json() as { installationId?: unknown; devices?: unknown };
    const installationId = typeof body.installationId === "string" ? body.installationId : "";
    if (!/^[a-f0-9]{32}$/.test(installationId) || !Array.isArray(body.devices) || body.devices.length > 30) {
      return NextResponse.json({ error: "Некоректний список пристроїв." }, { status: 400 });
    }
    const devices = body.devices as Record<string, unknown>[];
    const ids = new Set<string>();
    const valid = devices.every(device => {
      if (!device || typeof device !== "object") return false;
      const id = typeof device.id === "string" ? device.id : "";
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) return false;
      ids.add(id);
      return typeof device.type === "string" && DEVICE_TYPES.has(device.type) &&
        typeof device.name === "string" && device.name.trim().length >= 1 && device.name.length <= 64 &&
        typeof device.room === "string" && device.room.length <= 50;
    });
    if (!valid) return NextResponse.json({ error: "Перевір назву, кімнату й тип пристрою." }, { status: 400 });
    const normalized = devices.map(device => ({
      id: String(device.id), type: String(device.type), name: String(device.name).trim(),
      room: String(device.room).trim()
    }));
    const saved = await saveHomeDevices(installationId, normalized);
    return NextResponse.json({ saved }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося зберегти список пристроїв." }, { status: 503 });
  }
}
