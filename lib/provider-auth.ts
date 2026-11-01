import { randomUUID } from "node:crypto";
import { ATLANTIC_API, ATLANTIC_CLIENT_ID } from "@/lib/atlantic-auth";
import {
  acquireJob,
  finishJob,
  getBackgroundCredentials,
  saveRefreshedCredentials,
} from "@/lib/energy-store";
import type { CozytouchSession } from "@/lib/session";

/** One private home. The connectedAt binding prevents an old browser session
 * from silently acquiring access to a subsequently connected account. */
export async function getProviderToken(
  session?: CozytouchSession,
): Promise<string> {
  let credentials = await getBackgroundCredentials();
  if (session && !session.connectedAt)
    throw new Error("COZYTOUCH_SESSION_EXPIRED");
  if (
    session &&
    credentials &&
    credentials.connectedAt !== session.connectedAt
  ) {
    throw new Error("COZYTOUCH_SESSION_EXPIRED");
  }
  if (!credentials) {
    if (
      session?.accessToken &&
      session.expiresAt &&
      session.expiresAt > Date.now()
    )
      return session.accessToken;
    throw new Error("COZYTOUCH_SESSION_EXPIRED");
  }
  if (
    typeof credentials.accessToken === "string" &&
    Number(credentials.expiresAt) > Date.now() + 30_000
  )
    return credentials.accessToken;
  if (typeof credentials.refreshToken !== "string" || !credentials.refreshToken)
    throw new Error("COZYTOUCH_SESSION_EXPIRED");
  const owner = randomUUID();
  if (!(await acquireJob("cozytouch-refresh", owner, 30))) {
    // Another instance owns the rotating refresh token. Never use it twice.
    throw new Error("COZYTOUCH_REFRESH_BUSY");
  }
  try {
    credentials = await getBackgroundCredentials();
    if (
      !credentials ||
      (session && credentials.connectedAt !== session.connectedAt)
    )
      throw new Error("COZYTOUCH_SESSION_EXPIRED");
    if (
      typeof credentials.accessToken === "string" &&
      Number(credentials.expiresAt) > Date.now() + 30_000
    )
      return credentials.accessToken;
    if (typeof credentials.refreshToken !== "string")
      throw new Error("COZYTOUCH_SESSION_EXPIRED");
    const response = await fetch(ATLANTIC_API + "/users/token", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: "Basic " + ATLANTIC_CLIENT_ID,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }),
    });
    const token = await response.json().catch(() => null);
    if (!response.ok || typeof token?.access_token !== "string") {
      throw new Error(
        token?.error === "invalid_grant"
          ? "COZYTOUCH_SESSION_EXPIRED"
          : "COZYTOUCH_REFRESH_FAILED",
      );
    }
    const saved = await saveRefreshedCredentials(credentials, {
      ...credentials,
      accessToken: token.access_token,
      refreshToken:
        typeof token.refresh_token === "string"
          ? token.refresh_token
          : credentials.refreshToken,
      expiresAt:
        Date.now() + (Number(token.expires_in) || 3600) * 1000 - 60_000,
    });
    if (!saved) throw new Error("COZYTOUCH_REFRESH_STORE_FAILED");
    return token.access_token;
  } finally {
    await finishJob("cozytouch-refresh", owner);
  }
}
