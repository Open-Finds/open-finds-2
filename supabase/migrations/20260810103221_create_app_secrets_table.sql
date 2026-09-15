/*
# Create app_secrets table for server-side API keys

1. New Tables
- `app_secrets`
  - `key` (text, primary key) — the secret name, e.g. 'GOOGLE_MAPS_API_KEY'
  - `value` (text, not null) — the secret value
  - `created_at` (timestamptz, default now())
2. Security
- Enable RLS on `app_secrets`.
- NO policies are added — deny by default for anon and authenticated roles.
- The service role bypasses RLS, so edge functions (which have the service role key)
  can read secrets. The browser (anon key) and authenticated users cannot.
3. Data
- No secrets are seeded by this migration. Insert them out of band after
  applying; see the note below the table definition.
*/

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- Secrets are seeded OUT OF BAND, never committed here.
-- After applying migrations, set the key once via the SQL editor or psql:
--
--   INSERT INTO app_secrets (key, value) VALUES ('GOOGLE_MAPS_API_KEY', '<key>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- The previous hardcoded value was exposed in git history and must be
-- treated as compromised: rotate it in Google Cloud Console and restrict
-- the replacement by API and HTTP referrer.
