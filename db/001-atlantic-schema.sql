-- Idempotent schema for existing and new Atlantic Home installations.
BEGIN;
CREATE TABLE IF NOT EXISTS atlantic_energy_samples (
        installation_id text NOT NULL,
        sample_bucket timestamptz NOT NULL,
        sampled_at timestamptz NOT NULL,
        cumulative_wh bigint NOT NULL CHECK (cumulative_wh >= 0),
        PRIMARY KEY (installation_id, sample_bucket)
      );

CREATE INDEX IF NOT EXISTS atlantic_energy_samples_time_idx
        ON atlantic_energy_samples (installation_id, sampled_at DESC);

CREATE TABLE IF NOT EXISTS atlantic_energy_tariff_settings (
        installation_id text PRIMARY KEY,
        settings jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );

CREATE TABLE IF NOT EXISTS atlantic_home_devices (
        installation_id text PRIMARY KEY,
        devices jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );

CREATE TABLE IF NOT EXISTS atlantic_login_attempts (
        attempt_key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
      );

CREATE TABLE IF NOT EXISTS atlantic_jobs (
        job_key text PRIMARY KEY, owner text, locked_until timestamptz,
        last_started_at timestamptz, last_success_at timestamptz, last_error text
      );

CREATE TABLE IF NOT EXISTS atlantic_background_credentials (
        credential_key text PRIMARY KEY,
        sealed_payload text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );
COMMIT;
