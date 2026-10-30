import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Недозволене джерело запиту." }, { status: 403 });
  try {
    const session = await getCozytouchSession();
    session.appUnlocked = false;
    await session.save();
    return NextResponse.json({ locked: true });
  } catch {
    return NextResponse.json({ error: "Не вдалося заблокувати застосунок." }, { status: 500 });
  }
}
