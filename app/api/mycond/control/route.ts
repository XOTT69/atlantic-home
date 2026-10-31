import { NextResponse } from "next/server";
import { hasAppAccess } from "@/lib/access";
import { sendMycondCommand } from "@/lib/tuya";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  try {
    const body = await request.json() as { code?: unknown; value?: unknown };
    if (typeof body.code !== "string" || body.code.length > 64) return NextResponse.json({ error: "Некоректна команда." }, { status: 400 });
    await sendMycondCommand(body.code, body.value);
    return NextResponse.json({ sent: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^MYCOND_[A-Z0-9_]+$/.test(error.message) ? error.message : "MYCOND_COMMAND_FAILED";
    const status = code === "MYCOND_INVALID_COMMAND" || code === "MYCOND_UNSUPPORTED_COMMAND" || code === "MYCOND_INVALID_COMMAND_VALUE" || code === "MYCOND_UNSUPPORTED_COMMAND_TYPE" ? 400 : 502;
    return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
