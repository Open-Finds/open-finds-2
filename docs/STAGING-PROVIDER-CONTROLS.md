# Staging provider controls

What the staging Supabase project (`crpkzysdtnoomzimibhe`) does today to limit who can
spend money on OpenRouter, Google Maps/Places and page fetches. This is a record of the
**current** behaviour, reconstructed from the functions deployed on staging. It is not a
recommendation: the policy it describes is the thing Phase 3 changes.

Source: `supabase/functions/_shared/stagingProviders.ts`. Database side (not in
migrations): `docs/staging-reference/staging_provider_control.reference.sql`.

## When it applies

Only a function that calls `configureStagingProviders(...)` is affected, and only when
staging is detected (the staging project URL, `STAGING_PROVIDER_CAMPAIGN` set, the
function's activation flag `true`, or `APP_ENV=staging`). On any other project with none
of those, the wrapper just runs the handler and `providerFetch` is plain `fetch`.

If staging is detected on any other project, the function **refuses to boot** (or answers
503 `staging_project_mismatch`). Setting staging variables on production fails closed.

Functions that opted in: `resolve-place`, `extract-venue-meta`, `ai-proxy`, `geocode`,
`discover-venues`. Everything else (`travel-times`, `address-suggest`, `venue-photo`,
Stripe, push, reminders) is untouched.

## What a staging request must pass, in order

1. The browser origin must be listed in `ALLOWED_ORIGINS` (never `*`, never empty): else 403 `origin_not_allowed`. Preflight (`OPTIONS`) is then passed to the function.
2. Method must be `POST`: else 405.
3. `travel-times` is closed: 503 `routing_budget_not_approved`.
4. A real signed-in user (not the anon key): else 401.
5. The user's id must be in `STAGING_PROVIDER_USERS` (a comma list of UUIDs): else **403 `synthetic_user_required`**. This is the test-account-only gate.
6. The function's enable flag must be `true`: else 503 `staging_providers_disabled`.
7. `STAGING_PROVIDER_CAMPAIGN` must be a valid name, and numeric settings in range: else 503 `staging_configuration_invalid`.
8. At most `STAGING_REQUESTS_PER_MINUTE` (default 6, max 6) requests a minute per user, checked fail-closed: 429 `user_rate_limit`, or 503 `usage_control_unavailable`.
9. The body must be a JSON object: else 400. (`ai-proxy`: `use_credit` is refused, and only `purpose: "extract"` is admitted.)
10. The request is reserved in the ledger (`start`). Then every provider call inside it is counted (`call`), and the reservation is released (`finish`).

## The ledger's limits (database function `staging_provider_control`)

- **Lifetime per campaign, not per day:** `extract-venue-meta` 12, `ai-proxy` 15, `resolve-place` 20, `geocode` 10, `discover-venues` 5 requests; and 15 AI, 20 Places, 10 geocode and 36 metadata calls in total. When spent, requests get 429 `budget_exhausted` until a new campaign name is used.
- **One request at a time per campaign:** another request while one is active gets 409 `campaign_busy`.
- **Stuck requests:** only the campaign named `android-ai-save-robert` releases a request after 3 minutes. For any other campaign a request that never finishes keeps the campaign busy.
- **Identical requests:** one row per campaign, user and request hash, forever. A repeat is 409 `duplicate_request` (only `resolve-place` and `geocode`: `extract-venue-meta` and `ai-proxy` mix a random value into the hash, so they never match).
- **Per user per day:** AI calls `STAGING_DAILY_AI_PER_USER` (default 10, hard max 15) and Google calls `STAGING_DAILY_GOOGLE_PER_USER` (default 20, hard max 30), counted in UTC.
- **Per request:** at most 8 provider calls, 90 seconds in total.

## Differences between the five deployed functions

Each was deployed from a different revision of the shared file, so they differ. The source
keeps each as a named preset in `stagingProviders.ts`.

| Function | Enable flag | Boot check | Duplicate protection | Other |
|---|---|---|---|---|
| `resolve-place` | `STAGING_RESOLVE_PLACE_ENABLED` | general flag must be `false` | identical requests refused | `verify: true` path (exact place match); reads the Google key from its environment |
| `extract-venue-meta` | `STAGING_ANDROID_PROVIDERS_ENABLED` | that flag must be `true` or `false` | none (random salt) | fetches once not 3-4 times; Instagram caption embed first |
| `ai-proxy` | `STAGING_ANDROID_PROVIDERS_ENABLED` | general flag must be `false` | none (random salt) | extraction only; every call rewritten to `gpt-5-nano` with a two-result web search |
| `geocode` | `STAGING_ANDROID_PROVIDERS_ENABLED` | general flag must be `false` | identical requests refused | |
| `discover-venues` | `STAGING_PROVIDER_ENABLED` | general flag must be `false` | identical requests refused | can never be enabled on staging: it needs the flag `true` and boots only if it is `false` |

Only endpoints on this list are approved: OpenRouter chat completions, Places `searchText`,
Geocoding. Any other Google or OpenRouter address is refused (503
`provider_endpoint_not_approved`), which is why Places autocomplete, details and photos
cannot be added without changing this file.

## Known deviations from what is deployed

These exist only because the source also has to be safe on production:

- Boot checks and the wrapper run only when staging is detected. The deployed copies check
  unconditionally, which is the same thing on staging.
- The Google key from the environment, and "never fall back to the shared table", applies
  only to a function that opted in, on staging.
- The wrapper's own error responses use their own CORS headers (as deployed). The shared
  `cors.ts` is unchanged, so a few deployed functions allow one extra CORS request header
  than they would from this source (`X-Staging-Conversation-Id`, unused while AI Discover is closed).

## Open mode: AI Save testing allowance

An optional second way in for human testers. **Off by default**: nothing changes unless
`STAGING_PROVIDER_ACCESS` is exactly `open`. It applies only to the three AI Save functions
(`resolve-place`, `extract-venue-meta`, `ai-proxy`, the last still extraction-only). `geocode`,
`discover-venues` and AI Discover are never opened by it.

**What it does.** Any signed-in user is admitted, with a testing allowance of **20 AI Save
attempts per user per rolling 30 minutes**. It does not use the ledger above, so none of its
lifetime budgets, single request slot, duplicate rule or per-user daily caps apply.

**What an attempt is.** One AI Save dialog session. The app creates an id and sends it as
`attempt_id` in the body of every request the attempt makes (extraction, AI, verification), so
the attempt is counted once however many functions it calls. The id is kept for retries and for
an accidental close and reopen of the same link (less than 25 minutes), and dropped when the
venue is saved, so the next intentional save is a new attempt.

**When it is counted.** At the first **paid** provider call of a request (AI, Places, Geocoding),
in the database function `claim_ai_save_attempt` (migration `20261117130000_ai_save_attempt_allowance.sql`):

- a new id uses one slot; refused when the user already has 20 in the last 30 minutes;
- an id seen before in the window is free (a retry never needs allowance), up to **12 requests per attempt**;
- an id older than the window is **refused, never renewed**;
- free page-metadata fetches are not counted, and neither is anything refused before a paid call
  (sign-in, origin, kill switch, a bad body, a missing attempt id, the duplicate or burst guard,
  a handler's own checks, an unapproved endpoint, the eight-call limit).

An attempt that reaches a provider and then fails still counts (the cost was incurred); its
retries are free.

**The wait.** At the limit the answer is HTTP 429, code `testing_limit`, `retry_after_seconds`
and a `Retry-After` header: when the oldest counted attempt ages out. The app shows "You've reached
the testing limit. Try again in 13 minutes." Other refusals: 410 `attempt_expired`, 429
`attempt_request_limit`.

**Other protections in open mode.** Sign-in (the anon key is refused), the origin list and each
function's on/off flag stay, so the flag is still the kill switch. Plus: a **required attempt id**
(400 `attempt_id_required` before any provider call, so an app that does not send ids cannot
use the allowance per request), a **5-second identical-request guard** (the same user, attempt
and content within 5 seconds gets 409 `request_in_progress`; a different request is not blocked
and the guard never uses allowance), and a **burst guard of 30 requests a minute per user**.
Unchanged: the eight-call and 90-second limit per request, the approved endpoints, and each
function's own hourly limits (extract 60, resolve 60, AI 40 per user per hour).

**Concurrency.** A claim takes a per-user database lock, so two simultaneous new attempts cannot
both take the last slot and two requests of one attempt cannot both take the last request. One
claim per request, however many paid calls it makes.

**If the database cannot answer.** It fails closed: a 503 `usage_control_unavailable` and no provider
call, for the allowance claim, the burst guard and the duplicate guard. A request that makes only
free metadata fetches does not need the claim. (If the whole database is down, sign-in checks fail first.)

| Setting | Default | Allowed |
|---|---|---|
| `STAGING_PROVIDER_ACCESS` | unset (off) | `open` turns it on |
| `STAGING_TESTING_ATTEMPTS` | 20 | 1 to 100 |
| `STAGING_TESTING_WINDOW_SECONDS` | 1800 | 60 to 86400 |
| `STAGING_ATTEMPT_MAX_REQUESTS` | 12 | 1 to 50 |
| `STAGING_OPEN_REQUESTS_PER_MINUTE` | 30 | 1 to 120 |

A value outside its range stops requests with 503 `staging_configuration_invalid` rather than
guessing. The 5-second duplicate window is fixed.

### Before turning it on, in this order
1. Run the database tests where Docker is available (`npm run test:db` runs
   `supabase/tests/10_ai_save_attempts.sql`), and once run `supabase/tests/ai_save_attempts_concurrency.sh`.
2. Apply the migration to staging (needs approval).
3. Deploy the three functions from this branch (needs approval).
4. **Rebuild and distribute the APK with attempt ids** and confirm testers have it. Open mode
   refuses requests without an id, so enabling it first breaks AI Save for any older app.
5. Then, and only then, the project owner sets the secrets: `STAGING_PROVIDER_ACCESS=open`, and
   `ALLOWED_ORIGINS` including `https://localhost` (the Android app) and the web preview address.
   Keep `premium_unlocked` on during testing, or the functions' own free tier (3 a day) applies.
6. Smoke test with a test account only.

**Switching it off:** unset `STAGING_PROVIDER_ACCESS` (back to the test-account list and the
ledger above, exactly as before), or set a function's flag to `false` to stop one function. The
migration is additive: the table and function can be dropped without affecting anything else.

## What was not carried over

- The database objects of the ledger (tables and functions) are only recorded, not in
  `supabase/migrations`. Deploying from Git does not create or change them. (The open-mode
  allowance table and function, by contrast, are an ordinary migration.)
- Nothing here was deployed or applied. Staging still runs the previous code and schema.
