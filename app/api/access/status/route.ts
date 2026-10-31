import { NextResponse } from "next/server";
import { getAppAccessDiagnostics } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const diagnostics = await getAppAccessDiagnostics();
  const rawCookieHeader = request.headers.get("cookie") ?? "";
  const response = NextResponse.json({
    ...diagnostics,
    rawCookieHeaderPresent: /(?:^|;\s*)atlantic_home_session=/.test(rawCookieHeader),
    requestHost: request.headers.get("host")
  }, {
    headers: { "Cache-Control": "no-store" }
  });
  return response;
}
