import { NextResponse } from "next/server";
import { hasAppAccess } from "@/lib/access";
import { getBackgroundCredentials } from "@/lib/energy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  try {
    const credentials = await getBackgroundCredentials();
    const configured = Boolean(credentials && typeof credentials.accessToken === "string");
    const refreshAvailable = typeof credentials?.refreshToken === "string" && credentials.refreshToken.length > 0;
    return NextResponse.json({ configured, refreshAvailable }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося перевірити фоновий доступ." }, { status: 503 });
  }
}
