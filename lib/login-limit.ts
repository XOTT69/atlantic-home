import { createHmac } from "node:crypto";
import { consumeLoginAttempt } from "@/lib/energy-store";
const attempts = new Map<string, { count: number; until: number }>();

export async function allowLogin(request: Request, scope: string) {
  const address =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    "local";
  const key = createHmac(
    "sha256",
    process.env.SESSION_PASSWORD ?? "unconfigured",
  )
    .update(scope + ":" + address.split(",")[0].trim())
    .digest("hex");
  const persistent = await consumeLoginAttempt(key);
  if (persistent !== null) return persistent;
  const now = Date.now();
  for (const [id, entry] of attempts)
    if (entry.until < now) attempts.delete(id);
  if (!attempts.has(key) && attempts.size > 2000) return false;
  const entry = attempts.get(key) ?? { count: 0, until: now + 600_000 };
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count <= 12;
}
