import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface CozytouchSession {
  accessToken?: string;
  expiresAt?: number;
  connectedAt?: number;
}

export async function getCozytouchSession() {
  const password = process.env.SESSION_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error("SESSION_PASSWORD must contain at least 32 characters");
  }

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
