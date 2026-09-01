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
- Insert the Google Maps API key for geocoding and distance matrix calls.
*/

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO app_secrets (key, value) VALUES
  ('GOOGLE_MAPS_API_KEY', 'AIzaSyDEcuAGJtCqsVfpONFKgLMy1lbRsU3SCys')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
