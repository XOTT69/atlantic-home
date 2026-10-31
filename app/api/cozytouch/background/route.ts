import { NextResponse } from "next/server";
import { hasAppAccess } from "@/lib/access";
import { getBackgroundCredentials } from "@/lib/energy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasAppAccess())) return NextResponse.json({ error: "Потрібен пароль доступу до Atlantic Home." }, { status: 401 });
  try {
    const databaseConfigured = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    const sessionPasswordConfigured = Boolean(process.env.SESSION_PASSWORD && process.env.SESSION_PASSWORD.length >= 32);
    const cronSecretConfigured = Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32);
    const credentials = databaseConfigured && sessionPasswordConfigured ? await getBackgroundCredentials() : null;
    const accessTokenAvailable = typeof credentials?.accessToken === "string" && credentials.accessToken.length > 0;
    const refreshAvailable = typeof credentials?.refreshToken === "string" && credentials.refreshToken.length > 0;
    const reason = !databaseConfigured ? "neon_missing"
      : !sessionPasswordConfigured ? "session_password_missing"
      : !accessTokenAvailable ? "credentials_missing"
      : !refreshAvailable ? "refresh_token_missing"
      : !cronSecretConfigured ? "cron_secret_missing"
      : "ready";
    return NextResponse.json({
      configured: accessTokenAvailable,
      refreshAvailable,
      databaseConfigured,
      sessionPasswordConfigured,
      cronSecretConfigured,
      reason
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося перевірити фоновий доступ." }, { status: 503 });
  }
}
