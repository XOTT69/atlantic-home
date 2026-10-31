import { NextResponse } from "next/server";
import { getAppAccessDiagnostics } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostics = await getAppAccessDiagnostics();
  return NextResponse.json(diagnostics, {
    headers: { "Cache-Control": "no-store" }
  });
}
