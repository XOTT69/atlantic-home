import { cookies } from "next/headers";
import { getCozytouchSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function getAppAccessDiagnostics() {
  const appPasswordConfigured = Boolean(process.env.ATLANTIC_APP_PASSWORD && process.env.ATLANTIC_APP_PASSWORD.length >= 4);
  const cookieJar = await cookies();
  const sessionCookiePresent = Boolean(cookieJar.get(SESSION_COOKIE_NAME)?.value);
  try {
    const session = await getCozytouchSession();
    const appUnlocked = session.appUnlocked === true;
    return { appPasswordConfigured, sessionCookiePresent, sessionReadable: true, appUnlocked, authorized: appPasswordConfigured && appUnlocked };
  } catch {
    return { appPasswordConfigured, sessionCookiePresent, sessionReadable: false, appUnlocked: false, authorized: false };
  }
}

export async function hasAppAccess() {
  return (await getAppAccessDiagnostics()).authorized;
}
