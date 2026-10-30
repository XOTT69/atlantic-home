import { getCozytouchSession } from "@/lib/session";
import AccessGate from "./access-gate";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const configured = process.env.ATLANTIC_APP_PASSWORD;
  if (!configured || configured.length < 12) return <AccessGate configured={false} />;
  const session = await getCozytouchSession();
  if (!session.appUnlocked) return <AccessGate configured={true} />;
  return <Dashboard />;
}
