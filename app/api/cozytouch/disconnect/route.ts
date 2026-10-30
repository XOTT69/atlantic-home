import { NextResponse } from "next/server";
import { getCozytouchSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await getCozytouchSession();
    session.destroy();
    return NextResponse.json({ connected: false });
  } catch {
    return NextResponse.json({ error: "Не вдалося завершити сесію." }, { status: 500 });
  }
}
