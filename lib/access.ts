import { getCozytouchSession } from "@/lib/session";

export async function hasAppAccess() {
  if (!process.env.ATLANTIC_APP_PASSWORD || process.env.ATLANTIC_APP_PASSWORD.length < 4) return false;
  const session = await getCozytouchSession();
  return session.appUnlocked === true;
}
