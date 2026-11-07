#!/usr/bin/env bash
# Brings a Supabase project up to this repo's state: migrations, edge
# functions, secrets. Idempotent — safe to re-run.
#
#   SUPABASE_PROJECT_REF=wfrlkifdlgmlbffumglt \
#   OPENROUTER_API_KEY=... \
#   GOOGLE_MAPS_API_KEY=... \
#   VAPID_PRIVATE_KEY=... \
#   ALLOWED_ORIGINS=https://app.example.com \
#   ./supabase/deploy.sh
#
# Needs a CLI login with access to the project (`supabase login`). With
# SUPABASE_DB_PASSWORD set, migrations go through `db push`; without it they
# go through the Management API (see migrate-via-api.mjs) — same result. Run `./supabase/tests/run.sh` first: it
# applies the same migration chain to a throwaway Postgres and asserts the
# security properties, so a bad migration fails there instead of in production.
#
# ORDER MATTERS. The client code calls RPCs (get_shared_plan, submit_plan_rsvp,
# claim_device_rows, reorder_plan_stops, ...) that only exist after the
# migrations, and the edge functions require secrets that only exist after
# this sets them. Pointing .env at a project before this has run against it
# breaks share links, guest RSVP and every paid API call.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}"
SB="${SUPABASE_CLI:-supabase}"

echo "→ project: $SUPABASE_PROJECT_REF"

# ── 1. migrations ─────────────────────────────────────────────
# `db push` needs the database password. Without one (org member with only an
# access token), migrate-via-api.mjs does the same job through the Management
# API and keeps the migration history consistent for a later `db push`.
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "→ pending migrations:"
  $SB db push --dry-run --project-ref "$SUPABASE_PROJECT_REF" 2>&1 | grep -E '•|up to date' || true
  $SB db push --project-ref "$SUPABASE_PROJECT_REF"
else
  echo "→ no SUPABASE_DB_PASSWORD; applying migrations through the Management API"
  node supabase/migrate-via-api.mjs "$SUPABASE_PROJECT_REF" --apply
fi

# ── 2. edge functions ─────────────────────────────────────────
# verify_jwt settings come from supabase/config.toml.
for fn in ai-proxy geocode travel-times resolve-place extract-venue-meta send-push-notification; do
  echo "→ deploying $fn"
  $SB functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF"
done

# ── 3. edge function secrets ──────────────────────────────────
# Only set what was provided, so a partial run never blanks a value.
secrets=()
[ -n "${OPENROUTER_API_KEY:-}" ] && secrets+=("OPENROUTER_API_KEY=$OPENROUTER_API_KEY")
[ -n "${VAPID_PRIVATE_KEY:-}" ]  && secrets+=("VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY")
[ -n "${ALLOWED_ORIGINS:-}" ]    && secrets+=("ALLOWED_ORIGINS=$ALLOWED_ORIGINS")
if [ ${#secrets[@]} -gt 0 ]; then
  echo "→ setting ${#secrets[@]} function secret(s)"
  $SB secrets set "${secrets[@]}" --project-ref "$SUPABASE_PROJECT_REF"
else
  echo "→ no function secrets provided (skipping)"
fi

# ── 4. Google Maps key → app_secrets ──────────────────────────
# The Maps key is read from a table, not from an env var (see the
# create_app_secrets_table migration). The edge functions look it up with the
# service role at request time.
if [ -n "${GOOGLE_MAPS_API_KEY:-}" ]; then
  echo "→ storing GOOGLE_MAPS_API_KEY in app_secrets"
  node supabase/migrate-via-api.mjs "$SUPABASE_PROJECT_REF" --sql \
    "INSERT INTO app_secrets (key, value) VALUES ('GOOGLE_MAPS_API_KEY', '$GOOGLE_MAPS_API_KEY')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;" > /dev/null
else
  echo "→ no GOOGLE_MAPS_API_KEY provided (skipping)"
fi

echo
echo "→ done. Now point .env at the project:"
echo "     VITE_SUPABASE_URL=https://$SUPABASE_PROJECT_REF.supabase.co"
echo "     VITE_SUPABASE_ANON_KEY=<anon key from Project Settings → API>"
echo "     VITE_VAPID_PUBLIC_KEY=<public half of the VAPID pair>"
