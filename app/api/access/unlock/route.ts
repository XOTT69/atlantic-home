import { allowLogin } from "@/lib/login-limit";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { attachCozytouchSessionCookie, getCozytouchSession, getSessionConfigurationError } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  }
  const configured = process.env.ATLANTIC_APP_PASSWORD;
  if (!configured || configured.length < 4) {
    return NextResponse.json({ error: "Власник застосунку ще не налаштував ATLANTIC_APP_PASSWORD у Vercel." }, { status: 503 });
  }
  const sessionConfigurationError = getSessionConfigurationError();
  if (sessionConfigurationError) {
    return NextResponse.json({ error: `Захищений вхід не налаштований: ${sessionConfigurationError} Перевір змінні середовища у Vercel і зроби Redeploy.` }, { status: 503 });
  }
  try {
    if (!await allowLogin(request, "app-unlock")) return NextResponse.json({ error: "Забагато спроб. Повтори вхід через 10 хвилин." }, { status: 429, headers: { "Retry-After": "600" } });
    const body = await request.json() as { password?: unknown };
    const supplied = typeof body.password === "string" ? body.password : "";
    const a = Buffer.from(supplied);
    const b = Buffer.from(configured);
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (!valid) return NextResponse.json({ error: "Неправильний пароль доступу." }, { status: 401 });
    const session = await getCozytouchSession();
    session.appUnlocked = true;
    return await attachCozytouchSessionCookie(NextResponse.json({ unlocked: true }), session);
  } catch {
    return NextResponse.json({ error: "Не вдалося відкрити захищену сесію." }, { status: 500 });
  }
}
