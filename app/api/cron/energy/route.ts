import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectBackgroundEnergy } from "@/lib/background-energy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || expected.length < 32 || Buffer.byteLength(provided) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await collectBackgroundEnergy();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BACKGROUND_ENERGY_FAILED";
    console.warn("[energy collector] collection failed", code);
    return NextResponse.json({ sampled: false, code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
