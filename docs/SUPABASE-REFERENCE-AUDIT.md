# Supabase reference reconciliation

Reviewed 27 October 2026. Canonical production: `https://wfrlkifdlgmlbffumglt.supabase.co`.
Production website: `https://www.theunsaved.app/`. Web work stays on `codex/rebuild`.

## Repository inventory

The scan included hidden/ignored source files, scripts, configuration, the combined SQL export and all historical migrations, excluding `.git`, installed dependencies and generated `dist`. No local credential files or Supabase link-cache directory were present. Secret values were not retrieved from hosted services.

| Reference | Finding and action |
|---|---|
| `supabase/config.toml` | Contained old `gsoshbdfjozomsxtbize`; aligned the local identifier to `wfrlkifdlgmlbffumglt`. No CLI link/config push/deploy executed. |
| `supabase/migrations/20261014120000_review_reminders.sql:128` | Already contains canonical reminder function URL; unchanged. This historical migration would also call production if blindly replayed in staging with cron extensions available. |
| `combined_migrations.sql` and other historical migrations | No other project hostname/ID found. All historical SQL remains byte-for-byte unchanged. |
| `supabase/deploy.sh` | Example project ref is canonical; execution target is mandatory `SUPABASE_PROJECT_REF`. It runs migrations, deploys functions and sets secrets. Not a local-dev command; not executed. Its function list omits address-suggest, venue-photo, review-reminders and Stripe functions; do not use it as a complete release procedure. |
| `supabase/migrate-via-api.mjs` | Uses an explicit positional ref in the Management API URL; no hardcoded old target. Reads access tokens and can apply SQL. Not executed. |
| `scripts/backup-data.py` | Reads URL/service-role key from `.env` / `.env.client.local`; no hardcoded project. Exports private production data if pointed there. Not executed. |
| `src/lib/supabase.ts` | Client and notification/billing function URLs use `VITE_SUPABASE_URL`; anon header uses `VITE_SUPABASE_ANON_KEY`. No baked-in project ID. |
| `src/lib/apiKeys.ts`, `openai.ts`, `edgeAuth.ts`, `src/main.tsx` | Maps/AI requests, auth headers and preconnect derive from the same Vite environment. No old project literal. |
| Edge Functions | `_shared/auth.ts` derives both session and service clients from runtime `SUPABASE_URL`/keys. `_shared/webpush.ts` uses that client. ai-proxy's OpenRouter referer uses `SUPABASE_URL`. No old hardcoded target in function source. |
| `.github/workflows/ci.yml` | `https://ci-placeholder.supabase.co` and fake key are intentional build placeholders, not old/canonical credentials. |
| `src/test/setup.ts` | `https://test.supabase.co` and fake key are test placeholders. Security tests prohibit unmocked fetches. |
| New `.env.example`, `scripts/local-web.mjs` | Disconnected/local `127.0.0.1:54321`, fake key. The example mentions canonical ref only as a comment. No production connection by default. |

The old ref now occurs only in this historical finding description. Never bulk-replace identifiers in migration history, backups or cached credentials.

### Important distinction from the original audit

Top-level `project_id` in config.toml identifies local CLI stacks; it does **not** prove remote deployment targeting. Remote link state or explicit `--project-ref` must be checked separately. See the [official CLI configuration reference](https://supabase.com/docs/guides/local-development/cli/config) and [local workflow reference](https://supabase.com/docs/guides/local-development/cli-workflows). Renaming the local identifier may change which local container stack the CLI selects; no stack was started/stopped here.

## Environment and OAuth boundaries

There is no repository OAuth client ID/secret, provider dashboard export, `[auth]` site URL or redirect allowlist. Email reset and Google/Facebook sign-in use `${window.location.origin}/` as the post-auth return URL in `src/lib/supabase.ts`. Provider availability is read from the configured project's `/auth/v1/settings`.

The production Google sign-in page observed during the preceding audit showed the canonical callback host. That is an observation of one flow, not verification of the complete hosted configuration. No production auth or provider settings were changed or fetched with management credentials in this work.

Before a future approved release, inspect (without exposing keys):

- Vercel production `VITE_SUPABASE_URL` equals the canonical URL and its public anon key belongs to that same project. Preview environments must use an isolated backend, not inherit production values.
- Supabase Auth site URL is `https://www.theunsaved.app/`; redirect allowlist contains intended website/non-production origins without unnecessary wildcard hosts.
- Google/Facebook providers use canonical `https://wfrlkifdlgmlbffumglt.supabase.co/auth/v1/callback` in their own consoles, with matching provider credentials. Do not remove legacy callbacks until existing clients are accounted for.
- Edge runtime URL/service key belong to the canonical project; Stripe webhook, APP_URL, ALLOWED_ORIGINS, VAPID pair and protected Maps key match their intended environment.
- Actual CLI link state is inspected before any remotely targeted command. No existing link is inferred from config.toml.

Hosted values remain **unverified** because no read-only configuration export or corresponding connected management session was supplied.

## Production actions requiring separate approval

Nothing below has been executed or inserted into migration history.

1. **Rate limiter privilege preflight.** New AI/push checks fail closed if `consume_rate_limit` is unavailable. Historical SQL revokes PUBLIC/anon/authenticated execution but does not explicitly grant service_role; hosted default privileges may already provide access. Confirm first:

   ```sql
   SELECT has_function_privilege(
     'service_role', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE'
   );
   ```

   If absent, the proposed least-privilege change is:

   ```sql
   GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text,integer,integer) TO service_role;
   ```

   Prepare an additive migration only after approval; do not edit the historical limiter migration. Verify table/function existence and privileges in staging first. Do not deploy fail-closed handlers before this prerequisite is satisfied.

2. **Reminder gateway policy.** review-reminders authenticates a custom cron secret, but its existing schedule sends no bearer JWT and config.toml has no explicit entry. Inspect deployed policy. If the gateway blocks it, propose `verify_jwt = false` for this function only, relying on its existing secret check; request approval before applying. No gateway policy was changed locally or remotely.
3. **Environment-safe cron scheduling.** Replace any incorrect scheduled destination via a new, reviewed forward migration. Historical migration stays intact. A disposable local migration suite lacks cron extensions; a full staging clone needs its cron disabled or environment-local before replaying history.
4. **Production environment/OAuth reconciliation.** Change only confirmed mismatches from the checklist, after exact values/destinations are reviewed. No keys need rotation merely because the old local ID existed.
5. **Release the prepared functions/service worker only after staging acceptance and approval.** Local source changes do not remediate deployed production endpoints. Do not run deploy.sh as an all-purpose release shortcut.

## Remaining security limits

- DNS answers and redirect hops are checked, but fetch resolves DNS again. This is defense in depth, not complete DNS-rebinding protection. Platform egress restrictions or a connection-pinned fetch/proxy are needed for a complete boundary.
- Notification replay suppression uses the existing atomic rate-limit RPC with a seven-day window; it is not a durable outbox. Claims precede insertion/delivery, so failures can suppress retries and a batch can partially deliver. Permanent event deduplication and transactional/outbox delivery would require an approved schema change.
- Guests still rely on the existing plan-link/name RSVP capability. They cannot forge recipients/content, but name-based identity is not proof of a person.
- Existing map functions retain the previous fail-open rate-limit policy. AI and notification checks opt into fail-closed behavior. Unpinned edge import ranges remain a future reproducibility task.
- Production RLS, provider settings, Stripe and push delivery have not been certified by mocked tests. No production probes or data-changing tests were performed.
