import { NextResponse } from "next/server";
import { hasAppAccess } from "@/lib/access";
import { getEnergySamples } from "@/lib/energy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  }

  const url = new URL(request.url);
  const installationId = url.searchParams.get("installationId") ?? "";
  const daysParam = Number(url.searchParams.get("days") ?? 32);
  const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(32, Math.floor(daysParam))) : 32;

  try {
    const samples = await getEnergySamples(installationId, days);
    if (!samples) {
      return NextResponse.json({ configured: false, samples: [] }, {
        headers: { "Cache-Control": "no-store" }
      });
    }
    return NextResponse.json({ configured: true, samples }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return NextResponse.json({ configured: true, error: "Не вдалося завантажити історію енергії." }, { status: 503 });
  }
}
