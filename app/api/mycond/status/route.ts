import { NextResponse } from "next/server";
import { hasAppAccess } from "@/lib/access";
import { getMycondSnapshot } from "@/lib/tuya";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  try {
    const snapshot = await getMycondSnapshot();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^MYCOND_TUYA_[A-Z0-9_]+$/.test(error.message) ? error.message : "MYCOND_TUYA_API_UNAVAILABLE";
    return NextResponse.json({ configured: true, error: code }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
