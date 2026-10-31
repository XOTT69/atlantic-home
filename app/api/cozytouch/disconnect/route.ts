import { hasAppAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { attachCozytouchSessionCookie, getCozytouchSession } from "@/lib/session";
import { clearBackgroundCredentials } from "@/lib/energy-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  }
  try {
    await clearBackgroundCredentials();
    const session = await getCozytouchSession();
    session.accessToken = undefined;
    session.expiresAt = undefined;
    session.connectedAt = undefined;
    return await attachCozytouchSessionCookie(NextResponse.json({ connected: false }), session);
  } catch {
    return NextResponse.json({ error: "Не вдалося завершити сесію." }, { status: 500 });
  }
}
