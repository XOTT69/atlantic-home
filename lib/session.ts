import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface CozytouchSession {
  accessToken?: string;
  expiresAt?: number;
  connectedAt?: number;
  appUnlocked?: boolean;
}

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
    cookieName: "atlantic_home_session",
    password,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7
    }
  };

  return getIronSession<CozytouchSession>(await cookies(), options);
}
