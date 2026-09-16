-- Minimal stand-in for the Supabase platform objects the migrations rely on,
-- so the chain can be applied against plain Postgres for validation.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'anon') $$;

-- Assertion reporter shared by the test files.
CREATE OR REPLACE FUNCTION rep(l text, ok boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  RAISE NOTICE '%', rpad(l,36) || CASE WHEN ok THEN ': PASS' ELSE ': ** FAIL **' END; END $$;

-- Real Supabase grants these to the API roles; the stub must too, or any policy
-- calling auth.uid() fails with "permission denied for schema auth".
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO anon, authenticated, service_role;
