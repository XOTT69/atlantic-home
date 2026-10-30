import { NextResponse } from "next/server";
import { withOverkiz, findAtlanticHeater, executeHeaterCommand } from "@/lib/overkiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedModes = new Set(["normal", "eco", "antifreeze", "frostprotection", "auto", "manual", "prog", "boost", "away", "off", "on"]);
const allowedLevels = new Set(["comfort", "eco", "frostprotection", "boost", "comfort-1", "comfort-2", "off", "secured"]);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  }
  try {
    const body = await request.json() as { action?: unknown; value?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    let command = "";
    let parameters: unknown[] = [];

    if (action === "power") {
      if (body.value === true) command = "on";
      else if (body.value === false) command = "off";
      else return NextResponse.json({ error: "Некоректний стан живлення." }, { status: 400 });
    } else if (action === "temperature") {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value < 7 || value > 30 || Math.round(value * 2) !== value * 2) {
        return NextResponse.json({ error: "Температура має бути від 7 до 30 °C з кроком 0,5 °C." }, { status: 400 });
      }
      command = "setTargetTemperature";
      parameters = [value];
    } else if (action === "mode") {
      if (typeof body.value !== "string" || !allowedModes.has(body.value)) {
        return NextResponse.json({ error: "Непідтримуваний режим роботи." }, { status: 400 });
      }
      command = "setOperatingMode";
      parameters = [body.value];
    } else if (action === "heatingLevel") {
      if (typeof body.value !== "string" || !allowedLevels.has(body.value)) {
        return NextResponse.json({ error: "Непідтримуваний рівень нагрівання." }, { status: 400 });
      }
      command = "setHeatingLevel";
      parameters = [body.value];
    } else {
      return NextResponse.json({ error: "Невідома команда." }, { status: 400 });
    }

    const result = await withOverkiz(async (cookie, setup) => {
      const gateways = Array.isArray(setup.gateways) ? setup.gateways as Record<string, unknown>[] : [];
      const gatewayOnline = gateways.some(gateway => gateway.alive === true && String((gateway.connectivity as Record<string, unknown> | undefined)?.status ?? "").toUpperCase() !== "DISCONNECTED");
      if (!gatewayOnline) throw new Error("GATEWAY_OFFLINE");
      const heater = findAtlanticHeater(setup);
      const exec = await executeHeaterCommand(cookie, heater, command, parameters);
      return { command, parameters, execution: exec };
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, string> = {
      COZYTOUCH_SESSION_EXPIRED: "Сесія Cozytouch завершилася. Підключи акаунт знову.",
      ATLANTIC_HEATER_NOT_FOUND: "Не знайдено контролер Atlantic у Cozytouch.",
      GATEWAY_OFFLINE: "Шлюз Cozytouch зараз не в мережі. Команду не надіслано.",
      COMMAND_NOT_SUPPORTED: "Ця команда не підтримується пристроєм.",
      INVALID_COMMAND_PARAMETERS: "Некоректні параметри команди.",
      OVERKIZ_COMMAND_FAILED: "Cozytouch не прийняв команду. Перевір стан шлюзу та спробуй ще раз."
    };
    return NextResponse.json({ error: messages[code] ?? "Не вдалося виконати команду Cozytouch.", code }, { status: code === "GATEWAY_OFFLINE" ? 409 : 502 });
  }
}
