import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type EnergySample = { sampledAt: string | Date; cumulativeWh: string | number };
type EnergySql = NeonQueryFunction<false, false>;

let sqlClient: EnergySql | null = null;
let schemaReady: Promise<void> | null = null;

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
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS atlantic_energy_samples (
        installation_id text NOT NULL,
        sample_bucket timestamptz NOT NULL,
        sampled_at timestamptz NOT NULL,
        cumulative_wh bigint NOT NULL CHECK (cumulative_wh >= 0),
        PRIMARY KEY (installation_id, sample_bucket)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS atlantic_energy_samples_time_idx
        ON atlantic_energy_samples (installation_id, sampled_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS atlantic_energy_tariff_settings (
        installation_id text PRIMARY KEY,
        settings jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )`;
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function parseWh(value: unknown) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function saveEnergySample(deviceUrl: string | null | undefined, rawWh: unknown) {
  const sql = getSql();
  const cumulativeWh = parseWh(rawWh);
  if (!sql || !deviceUrl || cumulativeWh === null) return { configured: Boolean(sql), installationId: null as string | null };

  await ensureSchema(sql);
  const installationId = installationKey(deviceUrl);
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / (15 * 60_000)) * (15 * 60_000));
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
  const rows = await sql`SELECT sampled_at AS "sampledAt", cumulative_wh AS "cumulativeWh"
    FROM atlantic_energy_samples
    WHERE installation_id = ${installationId}
      AND sampled_at >= NOW() - (${safeDays}::text || ' days')::interval
    ORDER BY sampled_at ASC` as EnergySample[];
  return rows.map(row => ({
    sampledAt: new Date(row.sampledAt).getTime(),
    cumulativeEnergyWh: Number(row.cumulativeWh)
  })).filter(row => Number.isFinite(row.sampledAt) && Number.isFinite(row.cumulativeEnergyWh));
}

export async function getEnergyTariffSettings(installationId: string) {
  const sql = getSql();
  if (!sql || !/^[a-f0-9]{32}$/.test(installationId)) return null;
  await ensureSchema(sql);
  const rows = await sql`SELECT settings FROM atlantic_energy_tariff_settings WHERE installation_id = ${installationId} LIMIT 1` as { settings: unknown }[];
  return rows[0]?.settings ?? null;
}

export async function saveEnergyTariffSettings(installationId: string, settings: Record<string, unknown>) {
  const sql = getSql();
  if (!sql || !/^[a-f0-9]{32}$/.test(installationId)) return false;
  await ensureSchema(sql);
  await sql`INSERT INTO atlantic_energy_tariff_settings (installation_id, settings, updated_at)
    VALUES (${installationId}, ${JSON.stringify(settings)}::jsonb, NOW())
    ON CONFLICT (installation_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`;
  return true;
}
