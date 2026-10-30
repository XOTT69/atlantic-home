import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  }
  try {
    const session = await getCozytouchSession();
    session.destroy();
    return NextResponse.json({ connected: false });
  } catch {
    return NextResponse.json({ error: "Не вдалося завершити сесію." }, { status: 500 });
  }
}
