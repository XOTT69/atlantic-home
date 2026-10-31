import { getCozytouchSession, getSessionConfigurationError } from "@/lib/session";
import AccessGate from "./access-gate";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const configured = process.env.ATLANTIC_APP_PASSWORD;
  if (!configured || configured.length < 4) return <AccessGate configured={false} />;
  const sessionConfigurationError = getSessionConfigurationError();
  if (sessionConfigurationError) return <AccessGate configured={false} configurationError={sessionConfigurationError} />;
  let session;
  try {
    session = await getCozytouchSession();
  } catch (error) {
    console.error("[access] failed to read app session", error instanceof Error ? error.message : "UnknownError");
    return <AccessGate configured={false} configurationError="Не вдалося прочитати захищену сесію. Перевір конфігурацію сервера та перезавантаж сторінку." />;
  }
  if (!session.appUnlocked) return <AccessGate configured={true} />;
  return <Dashboard />;
}
