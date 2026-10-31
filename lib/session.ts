import { getIronSession, sealData, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export interface CozytouchSession {
  accessToken?: string;
  expiresAt?: number;
  connectedAt?: number;
  appUnlocked?: boolean;
}

export const SESSION_COOKIE_NAME = "atlantic_home_session";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7
};

export function getSessionConfigurationError() {
  const password = process.env.SESSION_PASSWORD;
  if (!password) return "На сервері не задано SESSION_PASSWORD.";
  if (password.length < 32) return "SESSION_PASSWORD має містити щонайменше 32 символи.";
  return null;
}

export async function getCozytouchSession() {
  const password = process.env.SESSION_PASSWORD;
  const configurationError = getSessionConfigurationError();
  if (configurationError || !password) throw new Error(configurationError ?? "SESSION_PASSWORD is missing");

  const options: SessionOptions = {
    cookieName: SESSION_COOKIE_NAME,
    password,
    cookieOptions: SESSION_COOKIE_OPTIONS
  };

  return getIronSession<CozytouchSession>(await cookies(), options);
}

/** Seal through iron-session, then attach the cookie directly to this response. */
export async function attachCozytouchSessionCookie(response: NextResponse, session: CozytouchSession) {
  const password = process.env.SESSION_PASSWORD;
  const configurationError = getSessionConfigurationError();
  if (configurationError || !password) throw new Error(configurationError ?? "SESSION_PASSWORD is missing");

  const sealed = await sealData(session, { password });
  response.cookies.set(SESSION_COOKIE_NAME, sealed, SESSION_COOKIE_OPTIONS);
  return response;
}
