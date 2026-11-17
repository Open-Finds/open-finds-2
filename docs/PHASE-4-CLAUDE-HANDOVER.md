# The Unsaved: Phase 4 handover for a fresh Claude Code session

Written 2026-11-17. Read this first. The project is called **The Unsaved**. "Open Finds" is the old business name; it survives only in the repo name (`open-finds-2`), paths and the Android package id. Do not rename anything.

Mission: "Don't just save it. Live it." MVP priorities, in order: Save Venues, Quick Share, AI Find, Core Planning, AI Discover. AI Find and AI Discover are separate features and must not be merged. The roadmap (master.md) lives in the founder's Claude Project, not in this repo: do not search the filesystem for it, ask the founder to paste what you need.

## 1. Where the code is

- Repository: `Open-Finds/open-finds-2` on GitHub (the repo is **public**).
- Worktree: `C:\Users\Home\open-finds-2\.claude\worktrees\staging-reconciliation`
- Branch: `feature/staging-reconciliation`, pushed to origin. Run `git log --oneline -12` and use the tip you find; at the time of writing the chain is:
  `a7893c2` (APK baseline) -> `c6da7e3` reconciliation -> `fc8fb6f` Phase 1 -> `e658a38` Phase 2 -> `c63947d` Phase 3 -> `4ec098e` test fix -> `0c93e05` collection privacy -> `ab2f1b0` APK workflow branch allowance (+ this handover commit).
- `feature/ai-save-quick-share` (remote tip `a7893c2`) and `main` were NOT touched. A diverged local branch with the same name (`80c006c`) is not the baseline; ignore it.
- Production Supabase `wfrlkifdlgmlbffumglt` was never touched. Staging is `crpkzysdtnoomzimibhe`. Never point local work at production (the main checkout's `.env.local` does; do not change it without approval).

## 2. What Phases 1 to 3 did

- **Reconciliation:** two staging-only migrations recovered into git with exact bytes (`.gitattributes -text`), and the deployed `resolve-place` v20 kept as a labelled reference in `docs/staging-reference/`.
- **Phase 1 (client):** provider failures (503 and friends) are reported as service problems, never as "bad venue". Manual save and manual address edit are always available.
- **Phase 2 (source of truth):** the staging provider controls and the exact-place verification path that existed only on staging are now in git (`supabase/functions/_shared/stagingProviders.ts`, `resolve-place/index.ts`, `extract-venue-meta/index.ts`, `ai-proxy/index.ts`, `_shared/maps.ts`, `_shared/urlguard.ts`). Legacy behaviour was checked equal to the deployed code over 45 simulated requests.
- **Phase 3 (open testing mode):** an opt-in mode where any signed-in staging user may use AI Save, with 20 attempts per user per rolling 30 minutes. See `docs/STAGING-PROVIDER-CONTROLS.md` (the authoritative description) and `supabase/migrations/20261117130000_ai_save_attempt_allowance.sql`. It is OFF unless the secret `STAGING_PROVIDER_ACCESS=open` is set.

## 3. Deployment status (verified 2026-11-17)

Staging database migrations applied by me this session:
- `keep_shared_collection_notes_private` (version 20261117113221): other users no longer see personal notes or ratings in shared collections.
- `ai_save_attempt_allowance` (version 20261117113233): table `ai_save_attempts` plus function `claim_ai_save_attempt` (service role only, RLS on, empty).
- NOT applied: `20261114120000_preserve_claimed_plan_ownership` (exists on `origin/codex/phase-1-staging-db`; the founder approved only the notes migration).

Staging Edge Functions (deployed from the branch sources, open mode off):
- `ai-proxy` v25 (was v24), `resolve-place` v21 (was v20), `extract-venue-meta` v21 (was v20).
- Not changed: `geocode` v17, `discover-venues` v16, and everything else.

Android APK: GitHub Actions run `44076921672` ("Android staging APK") on branch `feature/staging-reconciliation`, commit `ab2f1b0`. Artifact `the-unsaved-staging-debug` (5.2 MB, expires 2026-12-01, needs a GitHub login): https://github.com/Open-Finds/open-finds-2/suites/119316166064/artifacts/14326225282 . Package `com.example.openfinds2.staging`, debug-signed, staging origin only, no production origin, no secret patterns (the workflow checks all of this). It is **not** distributed to testers.

## 4. Tests

Passed (real PostgreSQL 18.6 via a scratch install, outside the repo):
- Full migration chain (52 migrations) applies; 248 SQL assertions pass.
- 29 real multi-connection concurrency checks pass: 40 simultaneous new attempts admit exactly 20; 30 simultaneous requests of one attempt admit exactly 12; replays counted once; rolling expiry; expired ids refused; killed sessions fail closed. Removing the lock is caught.
- `npm run check`: typecheck, lint (0 errors), 338 app tests, 237 edge tests, build.
- The same allowance function ran on staging inside a rolled-back transaction: new, replay, request cap and limit behaved correctly; table empty afterwards.

Not run or blocked:
- Docker-based `npm run test:db` and `supabase/tests/ai_save_attempts_concurrency.sh` (no Docker on the founder's PC). CI would run the first on Postgres 17.
- **Every live staging smoke test is still outstanding** (see section 6). Nothing in the acceptance list that needs a real sign-in, real link or paid call has been verified.

Test-harness notes (scratch only, not in the repo): the real-Postgres harness must run statements one at a time like `psql -f`, because the tests use transaction-local settings.

## 5. Contracts you can rely on (read the source)

- `src/lib/aiSave.ts`: `identifySharedVenue` (extract, verify, candidates, issues), `saveSharedVenue`; shapes `SharedVenueProgress`, `SharedVenueIssue`, `SharedVenueResult`.
- `src/lib/openai.ts`: `callAI`, `fetchPageMeta`, `extractVenuesFromLink`. Strict mode turns provider failures into `ProviderUnavailableError`.
- `src/lib/apiKeys.ts`: `resolveGoogleMapsLink`, `verifyVenuePlace` (calls `resolve-place`).
- `src/lib/providerErrors.ts`: `ProviderUnavailableError` reasons `auth|busy|duplicate|limit|unavailable|testing_limit|attempt_expired|attempt_limit`, `waitText`.
- `src/lib/attemptId.ts`: one attempt id per AI Save dialog, kept under 25 minutes, sent as `attempt_id` in every request body.
- `src/components/AiSaveDialog.tsx`: the dialog; maps reasons to messages. It already has a "Places found" dropdown for AI-extracted candidates, and "Save without verification", "Verify details" and Edit.
- `resolve-place` verify contract: request `{verify:true, name, address, outdoor?, addressFromSource?}` or `{verify:true, url}`; the answer is `{verified:true, name, address, lat, lon, type}` only when exactly one Google place matches, otherwise the empty result `{name:null,...}`. Failures to run the check are non-200. It never guesses.
- Staging provider rules: only Places `searchText`, Geocoding and OpenRouter chat completions are approved endpoints. Anything else (Places autocomplete, details, photos) is refused by `providerFetch` (503 `provider_endpoint_not_approved`). Phase 4 needs `stagingProviders.ts` changed to add any new endpoint, with tests and approval.

## 6. Current blocker: AI Save says "temporarily unavailable" on the new APK

The founder shared a reel on the new APK on 2026-11-17 and got "AI Save is temporarily unavailable". Evidence from staging logs: `extract-venue-meta` answered **HTTP 503** to those calls. The founder's account (id starts `c58a9d0a`) is a listed test account (42 earlier ledger requests), so it passed the allow-list; a 503 after that point is one of `staging_providers_disabled` (the on/off switch is off), `staging_configuration_invalid` or `usage_control_unavailable`. The response body is not in the logs, so the exact code is unconfirmed. This is expected while open mode is off and is a configuration step, not a code bug. Open mode is switched on by the founder setting secrets (never set or read by Claude): `STAGING_PROVIDER_ACCESS=open`, the three function switches (`STAGING_ANDROID_PROVIDERS_ENABLED`, `STAGING_RESOLVE_PLACE_ENABLED`) set to `true`, `ALLOWED_ORIGINS` including `https://localhost` (already accepted), keep `STAGING_PROVIDER_ENABLED=false`, keep app setting `premium_unlocked` on. Also confirm `OPENROUTER_API_KEY` and `GOOGLE_MAPS_API_KEY` exist as staging secrets (Claude cannot read them; the smoke test will show).

Outstanding acceptance tests (need the founder's approval of a small paid-call budget and a staging test account, at most 3 retries per request): ordinary account can start AI Save; Instagram and TikTok extraction; correct Google venue and branch; review and save; venue persists after reopening the APK; duplicate retries cost no allowance; the 20 per 30 minutes limit (use a temporarily low `STAGING_TESTING_ATTEMPTS`); 503 vs unverified wording; another user cannot read my saved venues; existing flows do not regress.

## 7. Known risks and debt

- The functions' own hourly limits (extract 60, resolve 60, AI 40 per user) still apply and can bite before the 20-attempt allowance.
- Free metadata fetches are not allowance-limited (bounded by the burst guard of 30 a minute and the hourly limit).
- A failed attempt that reached a provider still counts; its retries are free.
- The five deployed staging functions were once from different revisions; four are now from git. `geocode` and `discover-venues` still run the old deployed code.
- The staging ledger tables (`staging_provider_*`) are recorded in `docs/staging-reference/` but are not migrations.
- The Phase 3 attempt table uses its own cleanup (rows older than twice the window) because pg_cron is absent.
- Real-Postgres tests ran on 18.6; staging and CI use 17.
- The pushed branch is public: it holds source, the staging project address and the public anon key, no secrets.

## 8. Rollback

- Open mode off: unset `STAGING_PROVIDER_ACCESS` (back to the listed-test-account rules and the ledger).
- One function off: set its enable flag to `false`.
- Functions: redeploy earlier source. `resolve-place` v20 is `docs/staging-reference/resolve-place.deployed-v20.js`; the others from commit `e658a38` with open mode absent (behaviourally the previous version).
- Migrations: both are additive. Drop `ai_save_attempts` and `claim_ai_save_attempt` for the first; restore the previous `get_collection_venues` body (returns all columns) only if you must, since that reopens the privacy leak.
- APK: stop sharing the artifact; it expires on 2026-12-01.

## 9. Phase 4 scope (not started)

Phase 4 must NOT begin until the founder confirms AI Save works for an ordinary account (section 6), and must not rebuild the extraction pipeline without separate approval.

Required behaviour:
- An in-app Google Places confirmation card: correct venue name, address, suburb and the specific branch, with an explicit Save action. Never auto-save an ambiguous location.
- "Change location" shows up to three plausible candidates; if none match, an in-app Google Places search. Outdoor places (beaches, parks, hikes) with no street number must work.
- Failures to verify and provider outages stay clearly different, with manual save and manual address change always available.
- No full-screen Google Maps. Reuse the existing dialog, `Button`, `Input`, `SegmentedControl`, `Sheet` and the design tokens in `src/index.css` and `tailwind.config.js` (semantic colours only; React 18 and Tailwind 3 stay).
- Google data rules (founder decision pending): store `place_id`, cache lat/lng no longer than 30 days, show attribution; no Google photos in this release (category icon instead). The Google Service Specific Terms page was unreadable earlier; confirm before storing anything else.
- Design questions to settle before building: where the candidates come from (a new `resolve-place` mode that returns up to three scored candidates is the likely answer; today it returns one or none), and the Google cost per search (Text Search with name, address or location is the Pro tier).
- Backend changes (new modes, endpoints in `stagingProviders.ts`, rate limits via `supabase/functions/_shared/ratelimit.ts`) need tests, `npm run test:security`, and approval before staging deployment.

## 10. Working rules (from the founder)

- Handle routine local work (inspection, fixes, tests, local commits) without asking. Stop for approval before: significant database changes, staging deployments, anything touching production, paid API calls, or major architecture decisions. Do not push without approval.
- Explain results in simple, non-technical language: what was wrong, what you fixed, does it work now, what is next. Keep replies short.
- Add a regression test for every bug fix. Run `npm run check` before reporting done; `npm run test:security` for edge-function changes; `npm run test:db` for database changes (needs Docker; a scratch real-Postgres run is acceptable and should be reported as such).
- Do not search for master.md. Ask before creating or renaming a branch.

## 11. First task for the next session

1. Read this file, `CLAUDE.md`, and `docs/STAGING-PROVIDER-CONTROLS.md`. Run `git status` and `git log --oneline -12`.
2. Ask the founder whether AI Save now works for an ordinary staging account (section 6). If not, fix that first (it is the unfinished end of Phase 3), not Phase 4.
3. Read-only audit of the existing deterministic, code-first extraction path (`extractVenuesFromLink` in `src/lib/openai.ts`, `identifySharedVenue` in `src/lib/aiSave.ts`, and `extract-venue-meta`): how a link becomes a candidate name and address, where it is code-driven and where it asks the AI, and what evidence reaches `resolve-place`. Report findings; do not change it.
4. Write a short Phase 4 plan (candidate source, UI states, tests, cost) and wait for the founder's approval before implementing.
