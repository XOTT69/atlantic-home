import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { sealData, unsealData } from "iron-session";

type EnergySample = { sampledAt: string | Date; cumulativeWh: string | number };
type EnergySql = NeonQueryFunction<false, false>;

let sqlClient: EnergySql | null = null;
let schemaReady: Promise<void> | null = null;
const credentialVersions = new WeakMap<Record<string, unknown>, string>();

function getSql() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) return null;
  if (!sqlClient) sqlClient = neon(connectionString);
  return sqlClient;
}

function installationKey(deviceUrl: string) {
  return createHash("sha256").update(deviceUrl).digest("hex").slice(0, 32);
}

async function ensureSchema(sql: EnergySql) {
  if (!schemaReady) {
    schemaReady = sql
      .transaction([
        sql`CREATE TABLE IF NOT EXISTS atlantic_energy_samples (
        installation_id text NOT NULL,
        sample_bucket timestamptz NOT NULL,
        sampled_at timestamptz NOT NULL,
        cumulative_wh bigint NOT NULL CHECK (cumulative_wh >= 0),
        PRIMARY KEY (installation_id, sample_bucket)
      )`,
        sql`CREATE INDEX IF NOT EXISTS atlantic_energy_samples_time_idx
        ON atlantic_energy_samples (installation_id, sampled_at DESC)`,
        sql`CREATE TABLE IF NOT EXISTS atlantic_energy_tariff_settings (
        installation_id text PRIMARY KEY,
        settings jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )`,
        sql`CREATE TABLE IF NOT EXISTS atlantic_home_devices (
        installation_id text PRIMARY KEY,
        devices jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )`,
        sql`CREATE TABLE IF NOT EXISTS atlantic_login_attempts (
        attempt_key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
      )`,
        sql`CREATE TABLE IF NOT EXISTS atlantic_jobs (
        job_key text PRIMARY KEY, owner text, locked_until timestamptz,
        last_started_at timestamptz, last_success_at timestamptz, last_error text
      )`,
        sql`CREATE TABLE IF NOT EXISTS atlantic_background_credentials (
        credential_key text PRIMARY KEY,
        sealed_payload text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )`,
      ])
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

function parseWh(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function saveEnergySample(
  deviceUrl: string | null | undefined,
  rawWh: unknown,
) {
  const sql = getSql();
  const cumulativeWh = parseWh(rawWh);
  if (!sql || !deviceUrl || cumulativeWh === null)
    return { configured: Boolean(sql), installationId: null as string | null };

  await ensureSchema(sql);
  const installationId = installationKey(deviceUrl);
  const now = new Date();
  const bucket = new Date(
    Math.floor(now.getTime() / (15 * 60_000)) * (15 * 60_000),
  );
  await sql`INSERT INTO atlantic_energy_samples (installation_id, sample_bucket, sampled_at, cumulative_wh)
    VALUES (${installationId}, ${bucket.toISOString()}, ${now.toISOString()}, ${cumulativeWh})
    ON CONFLICT (installation_id, sample_bucket) DO UPDATE SET
      sampled_at = EXCLUDED.sampled_at,
      cumulative_wh = EXCLUDED.cumulative_wh`;
  return { configured: true, installationId };
}

export async function getEnergySamples(installationId: string, days = 32) {
  const sql = getSql();
  if (!sql || !/^[a-f0-9]{32}$/.test(installationId)) return null;
  await ensureSchema(sql);
  const safeDays = Math.max(1, Math.min(32, Math.floor(days)));
  const rows =
    (await sql`SELECT sampled_at AS "sampledAt", cumulative_wh AS "cumulativeWh"
    FROM atlantic_energy_samples
    WHERE installation_id = ${installationId}
      AND sampled_at >= NOW() - (${safeDays}::text || ' days')::interval
    UNION ALL
    (SELECT sampled_at AS "sampledAt", cumulative_wh AS "cumulativeWh"
      FROM atlantic_energy_samples WHERE installation_id = ${installationId}
      AND sampled_at < NOW() - (${safeDays}::text || ' days')::interval
      ORDER BY sampled_at DESC LIMIT 1)
    ORDER BY "sampledAt" ASC`) as EnergySample[];
  return rows
    .map((row) => ({
      sampledAt: new Date(row.sampledAt).getTime(),
      cumulativeEnergyWh: Number(row.cumulativeWh),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.sampledAt) &&
        Number.isFinite(row.cumulativeEnergyWh),
    );
}

export async function getEnergyTariffSettings(installationId: string) {
  const sql = getSql();
  if (!sql || !/^[a-f0-9]{32}$/.test(installationId)) return null;
  await ensureSchema(sql);
  const rows =
    (await sql`SELECT settings FROM atlantic_energy_tariff_settings WHERE installation_id = ${installationId} LIMIT 1`) as {
      settings: unknown;
    }[];
  return rows[0]?.settings ?? null;
}

export async function saveEnergyTariffSettings(
  installationId: string,
  settings: Record<string, unknown>,
) {
  const sql = getSql();
  if (!sql || !/^[a-f0-9]{32}$/.test(installationId)) return false;
  await ensureSchema(sql);
  await sql`INSERT INTO atlantic_energy_tariff_settings (installation_id, settings, updated_at)
    VALUES (${installationId}, ${JSON.stringify(settings)}::jsonb, NOW())
    ON CONFLICT (installation_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`;
  return true;
}

export async function getHomeDevices(installationId: string) {
  const sql = getSql();
  if (!sql || !/^[a-f0-9]{32}$/.test(installationId)) return null;
  await ensureSchema(sql);
  const rows =
    (await sql`SELECT devices FROM atlantic_home_devices WHERE installation_id = ${installationId} LIMIT 1`) as {
      devices: unknown;
    }[];
  return rows[0]?.devices ?? null;
}

export async function saveHomeDevices(
  installationId: string,
  devices: unknown[],
) {
  const sql = getSql();
  if (!sql || !/^[a-f0-9]{32}$/.test(installationId)) return false;
  await ensureSchema(sql);
  await sql`INSERT INTO atlantic_home_devices (installation_id, devices, updated_at)
    VALUES (${installationId}, ${JSON.stringify(devices)}::jsonb, NOW())
    ON CONFLICT (installation_id) DO UPDATE SET devices = EXCLUDED.devices, updated_at = NOW()`;
  return true;
}

export async function saveBackgroundCredentials(
  payload: Record<string, unknown>,
) {
  const sql = getSql();
  const password = process.env.SESSION_PASSWORD;
  if (!sql || !password || password.length < 32) return false;
  await ensureSchema(sql);
  const sealedPayload = await sealData(payload, { password, ttl: 0 });
  await sql`INSERT INTO atlantic_background_credentials (credential_key, sealed_payload, updated_at)
    VALUES ('cozytouch', ${sealedPayload}, NOW())
    ON CONFLICT (credential_key) DO UPDATE SET sealed_payload = EXCLUDED.sealed_payload, updated_at = NOW()`;
  return true;
}

export async function getBackgroundCredentials() {
  const sql = getSql();
  const password = process.env.SESSION_PASSWORD;
  if (!sql || !password || password.length < 32) return null;
  await ensureSchema(sql);
  const rows =
    (await sql`SELECT sealed_payload FROM atlantic_background_credentials WHERE credential_key = 'cozytouch' LIMIT 1`) as {
      sealed_payload: string;
    }[];
  const sealedPayload = rows[0]?.sealed_payload;
  if (!sealedPayload) return null;
  const credentials = await unsealData<Record<string, unknown>>(sealedPayload, {
    password,
    ttl: 0,
  });
  if (typeof credentials.accessToken !== "string") return null;
  credentialVersions.set(credentials, sealedPayload);
  return credentials;
}

export async function clearBackgroundCredentials() {
  const sql = getSql();
  if (!sql) return;
  await ensureSchema(sql);
  await sql`DELETE FROM atlantic_background_credentials WHERE credential_key = 'cozytouch'`;
}

// Database leases coordinate serverless instances; an in-memory mutex alone cannot.
export async function acquireJob(key: string, owner: string, seconds = 60) {
  const sql = getSql();
  if (!sql) return null;
  await ensureSchema(sql);
  const rows =
    await sql`INSERT INTO atlantic_jobs (job_key, owner, locked_until, last_started_at)
    VALUES (${key}, ${owner}, NOW() + (${seconds}::text || ' seconds')::interval, NOW())
    ON CONFLICT (job_key) DO UPDATE SET owner = EXCLUDED.owner,
      locked_until = EXCLUDED.locked_until, last_started_at = NOW()
    WHERE atlantic_jobs.locked_until IS NULL OR atlantic_jobs.locked_until < NOW()
    RETURNING job_key`;
  return rows.length === 1;
}

export async function finishJob(
  key: string,
  owner: string,
  error: string | null = null,
) {
  const sql = getSql();
  if (!sql) return;
  await ensureSchema(sql);
  await sql`UPDATE atlantic_jobs SET locked_until = NULL, owner = NULL,
    last_success_at = CASE WHEN ${error}::text IS NULL THEN NOW() ELSE last_success_at END,
    last_error = ${error} WHERE job_key = ${key} AND owner = ${owner}`;
}

export async function getCollectionHealth() {
  const sql = getSql();
  if (!sql) return null;
  await ensureSchema(sql);
  const rows =
    await sql`SELECT last_started_at AS "lastStartedAt", last_success_at AS "lastSuccessAt",
    last_error AS "lastError", locked_until > NOW() AS running
    FROM atlantic_jobs WHERE job_key = 'energy-collector'`;
  return rows[0] ?? null;
}

export async function consumeLoginAttempt(key: string) {
  const sql = getSql();
  if (!sql) return null;
  await ensureSchema(sql);
  const rows =
    await sql`INSERT INTO atlantic_login_attempts (attempt_key, attempts, expires_at)
    VALUES (${key}, 1, NOW() + INTERVAL '10 minutes')
    ON CONFLICT (attempt_key) DO UPDATE SET
      attempts = CASE WHEN atlantic_login_attempts.expires_at < NOW() THEN 1 ELSE atlantic_login_attempts.attempts + 1 END,
      expires_at = CASE WHEN atlantic_login_attempts.expires_at < NOW() THEN NOW() + INTERVAL '10 minutes' ELSE atlantic_login_attempts.expires_at END
    RETURNING attempts`;
  return Number(rows[0].attempts) <= 12;
}

/** Compare and swap prevents a finishing refresh from overwriting a newer
 * explicit connection or resurrecting a disconnected account. */
export async function saveRefreshedCredentials(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  const sql = getSql();
  const password = process.env.SESSION_PASSWORD;
  const version = credentialVersions.get(previous);
  if (!sql || !password || !version) return false;
  const sealed = await sealData(next, { password, ttl: 0 });
  const rows =
    await sql`UPDATE atlantic_background_credentials SET sealed_payload = ${sealed}, updated_at = NOW()
    WHERE credential_key = 'cozytouch' AND sealed_payload = ${version} RETURNING credential_key`;
  return rows.length === 1;
}
