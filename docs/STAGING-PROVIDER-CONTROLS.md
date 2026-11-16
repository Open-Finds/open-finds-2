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

## What was not carried over

- The database objects (ledger tables and functions) are only recorded, not in
  `supabase/migrations`. Deploying from Git does not create or change them.
- Nothing here was deployed. Staging still runs the previous code.
