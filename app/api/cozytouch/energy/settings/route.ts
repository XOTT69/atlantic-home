import { NextResponse } from "next/server";
import { hasAppAccess } from "@/lib/access";
import { getEnergyTariffSettings, saveEnergyTariffSettings } from "@/lib/energy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validAmount(value: unknown, max: number) {
  if (typeof value !== "string") return false;
  if (!value.trim()) return true;
  const number = Number(value.trim().replace(",", "."));
  return Number.isFinite(number) && number >= 0 && number <= max;
}

export async function GET(request: Request) {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  const installationId = new URL(request.url).searchParams.get("installationId") ?? "";
  try {
    const settings = await getEnergyTariffSettings(installationId);
    return NextResponse.json({ configured: settings !== null, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося завантажити тарифи." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const installationId = typeof body.installationId === "string" ? body.installationId : "";
    const settings = body.settings as Record<string, unknown> | undefined;
    const rates = settings?.rates as Record<string, unknown> | undefined;
    const monthly = settings?.householdMonthlyKwh as Record<string, unknown> | undefined;
    const rateKeys = ["discountDay", "discountNight", "standardDay", "standardNight"];
    if (!/^[a-f0-9]{32}$/.test(installationId) || !settings || !rates || !monthly ||
      typeof settings.winterDiscountEnabled !== "boolean" ||
      !rateKeys.every(key => validAmount(rates[key], 100)) ||
      Object.entries(monthly).length > 32 ||
      !Object.entries(monthly).every(([key, value]) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key) && validAmount(value, 200_000))) {
      return NextResponse.json({ error: "Некоректні налаштування тарифу." }, { status: 400 });
    }
    const normalized = {
      rates: Object.fromEntries(rateKeys.map(key => [key, rates[key]])),
      winterDiscountEnabled: settings.winterDiscountEnabled,
      householdMonthlyKwh: Object.fromEntries(Object.entries(monthly))
    };
    const saved = await saveEnergyTariffSettings(installationId, normalized);
    return NextResponse.json({ saved }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося зберегти тарифи." }, { status: 503 });
  }
}
