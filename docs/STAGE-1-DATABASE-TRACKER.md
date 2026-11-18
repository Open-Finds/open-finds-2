# Stage 1: database tracker

Branch: `feature/staging-reconciliation`. Staging project: `crpkzysdtnoomzimibhe`. Production (`wfrlkifdlgmlbffumglt`) was not touched or read.
Audit date: 2026-11-18. Status values: NOT STARTED, IN PROGRESS, BLOCKED, FAILED, APPROVED.

Rules for this stage: staging first; no production change, staging migration, deployment, push or paid call without the founder's approval; never weaken RLS; every bug fix gets a regression test.

## Where Stage 1 stands (2026-11-18)

| Task | Status | Applied to staging | Production |
|---|---|---|---|
| S1-01 Reconcile local changes into the branch | APPROVED | n/a | n/a |
| S1-02 Compare deployed staging functions with Git | APPROVED | read-only | not touched |
| S1-03 Record staging-only ledger in Git | APPROVED | no change needed | not applicable |
| S1-04 Close sales and billing helper functions | APPROVED | yes | not applied |
| S1-05 Close signed-in-only functions, view, search paths | APPROVED | yes | not applied |
| S1-06 One saved venue per name and address | APPROVED | yes | not applied |
| S1-07 Claimed plan and trip ownership protection | APPROVED | yes | not applied |
| S1-08 Database tests on Postgres 17 in GitHub CI | APPROVED (database job); app-test job red | n/a | n/a |
| S1-09 Live Save Venues check on staging | APPROVED (database integration) | n/a | n/a |
| S1-10 Final regression run and documentation | see its entry | n/a | n/a |

Open items for the founder (none block Stage 1 on staging):
1. PRODUCTION (read-only check done 2026-11-19, founder approved; nothing changed there): see "Production read-only findings" below. Production still has the sales/billing exposure and needs a reconciliation plan and separate approval before any change.
2. Google venue photos (`venue-photo`): DECIDED by the founder on 2026-11-18: keep the Google images (this replaces the earlier "no Google photos in this release" decision). Cost note: the function runs outside the AI Save allowance and the staging provider controls (limit 200 lookups per user per hour, one Places search plus one photo lookup per venue the first time it is shown). The founder's Google quota and budget alerts remain the hard stop. Before any wider release: read Google's terms for stored photo links and attribution, and consider adding the photo lookups to the provider controls.
3. App test `src/pages/UnifiedPlanner.test.tsx` ("renders all four sections in one document") failed every time in GitHub CI. Cause confirmed 2026-11-19: the floating "Go to Itinerary" shortcut hides while a text box has focus and re-shows only after a screen-check timer (about 16 ms); the test looked for the button instantly. Slowing the timer on purpose reproduced the exact CI error every time. Fix (one line, local, not yet committed or pushed): the test now waits for the button with `findByRole`. With the timer slowed to 150 ms all 27 planner tests pass; the file passed 3 of 3 runs; `npm run check` passes (350 app tests, 251 edge tests, build). Not a database defect and not an app bug.
4. Supabase Auth "leaked password protection" is off (dashboard setting, founder's decision).
5. The AI could not read a venue from one TikTok link (provider issue, separate from the database).
6. Draft PR #3 stays unmerged until the founder approves.

## Production: Step A applied (2026-11-19)

With the founder's approval the two security migrations were applied to production (`20261118134143 close_sales_billing_helpers`, `20261118134208 restrict_signed_in_functions`). The sales/billing exposure on production is closed. Verified: counts unchanged (520 saved venues, 175 plans, 142 unowned plans, 31 tables); signed-out-callable functions 45 to 20; the 25 functions closed to signed-out callers, the 23 signed-in ones still work; guest RSVP and share-link functions still open; rating view and search paths fixed; advisors' ERROR and 3 search-path warnings gone; a rolled-back behaviour check passed; no failed requests or database errors in the logs afterwards. No backup was possible (Supabase free plan has none); the step changed no data and has a tested rollback. Details: `docs/PRODUCTION-RELEASE-PLAN.md`, Step A. The founder checked the live website (Admin, Sales, an invite link and guest RSVP): all good, and the logs agree. Still open: Steps B to E.

## Production read-only findings (2026-11-19)

Founder approved a read-only check of production (`wfrlkifdlgmlbffumglt`). Only selects, the migration list, the function list and the security advisors were used. No write, no migration, no deployment.

| Finding | Evidence |
|---|---|
| Recorded migration history stops at `20260923160000` (33 entries), but the real schema contains objects from later migrations up to about `20261015`. Production is OUT OF SYNC with its own history. | Production has `stripe_events`, `venue_reviews`, `credit_ledger`, `commission_payouts`, `review_reminders` (with an hourly `review-reminders` cron job), `app_settings`, `profiles.role` and `commission_percent`, `saved_venues.photo_url`, and the functions `add_host_rsvp`, `admin_set_role`, `spend_credit`, `sales_summary_for`, `partner_billing`; none of this is in the recorded history. |
| Production is MISSING everything from `20261027` on: six-stop planner, optional event end (`plans.end_time`/`end_date` absent), AI Save (`save_shared_venue`, `venue_recommendations`, `ai_save_attempts`), plan-invite ownership, private collection notes, all Stage 1 migrations. | Those objects are absent. Production edge functions are older (ai-proxy v22, resolve-place v17; `venue-photo` and the AI Save controls are not deployed). |
| BROKEN on production: `sales_summary_for(uuid)` and `partner_billing()` are callable by signed-out users (same as staging before S1-04). | `has_function_privilege('anon', ...)` true; neither checks the caller. |
| Same advisor warnings as staging had: security-definer view `venue_rating_summary` (ERROR), 3 functions with no fixed search path, 51 signed-out-callable security-definer functions, plus `pg_net` installed in `public`; leaked password protection off. | Production security advisors. |
| Row security is on for all 31 public tables. | Catalog query. |
| 520 saved venues, 7 groups of duplicate saved venues (same person, name and address), 175 plans of which 142 are unclaimed (no owner id). | Counts only; no personal data read. The S1-06 migration flags duplicates and deletes nothing, so it is safe on this data. |

Consequences for any production release:
- A plain `supabase db push` would try to re-run migrations that production already contains (history gap) and fail or half-apply. The history must be reconciled first (decide which migrations are really applied, mark them as applied, or apply only what is missing) and verified against a staging-like copy.
- The full chain through `20261118140000` must reach production in one planned release so the sales/billing and function fixes are not left open while newer features arrive.
- `20261014120000_review_reminders.sql` schedules a job that already exists on production; do not duplicate it.
- The app and Edge Functions must be released in step with the schema (AI Save, six-stop planner and venue photos need their functions and secrets), including the staging-only controls staying off production.
- The same collection-notes privacy leak that existed on staging (`get_collection_venues`, signed-out callable) is expected on production until `20261114120100` is applied.

Nothing here is applied. The production release plan is now written: `docs/PRODUCTION-RELEASE-PLAN.md`. Further read-only work showed production's real schema equals the first 45 migrations exactly (compared with `scripts/schema-fingerprint.sql`), that 11 migrations are in the database but missing from its history, and that the two security migrations apply cleanly on their own (rehearsed on a production-equivalent throwaway database: all checks pass). Each production step in the plan still needs the founder's separate approval.

Founder decisions 2026-11-19: six stops for everyone; subscription locks are left alone while pricing is worked out (`premium_unlocked` stays on). Backup and rollback: a tested rollback kit was built, `supabase/rollback/` (one script per pending migration, guarded against destroying new data) with the rehearsal tool `scripts/release-rehearsal/`. On a production-equivalent throwaway database with made-up rows: the full release then full rollback returns the database exactly to the start (structure, access, settings, data hash), a second run is harmless, the quick security fix and its undo return exactly to the start, undoing only the last three returns to the state after the first eight, and the guarded rollbacks refuse when new data exists. A database backup cannot be made from here; the plan makes the founder's dashboard backup confirmation a required step before Step A and Step D.

## Audit summary (2026-11-18)

| Area | Class | Evidence |
|---|---|---|
| RLS on every public table (35 on staging) | COMPLETE | Live query: all 35 tables have RLS enabled. 9 have no policy on purpose (service-role or RPC access only). |
| 50 migrations applied on staging | COMPLETE | `list_migrations` on staging. |
| App checks on this branch | COMPLETE | typecheck pass, lint 0 errors, 40 app test files and 13 edge test files pass (run 2026-11-18). |
| `sales_summary_for(uuid)` and `partner_billing()` callable by signed-out users | BROKEN | Staging function ACL lists `anon=X`. Neither function checks the caller. The migrations only `REVOKE ... FROM PUBLIC`, which Supabase's default grants undo. |
| No unique rule on `saved_venues`; manual saves never de-duplicated | BROKEN | Only non-unique indexes. Staging has 1 duplicate group in 33 rows. |
| `save_shared_venue` loses a second venue from the same link | BROKEN (known) | Function body returns the first row for the same link. |
| Security advisors: unsafe view `venue_rating_summary`, 3 functions with no fixed search path, about 50 functions callable by anon | UNVERIFIED | Advisor output. Only 8 function bodies read so far. |
| Database test suite (`npm run test:db`) | UNVERIFIED | Needs Docker (not on this PC). Main CI has not run on this branch. Handover claims a scratch Postgres 18.6 run passed 248 checks; no evidence seen. |
| Live Save Venues on staging | UNVERIFIED | No real sign-in, link or Google test run since the latest deploys. |
| Staging `staging_provider_*` tables and the renamed reminders migration | OUT OF SYNC | Not in `supabase/migrations`. |
| `preserve_claimed_plan_ownership` | OUT OF SYNC | Only on `origin/codex/phase-1-staging-db`; not on staging. |
| Deployed staging functions vs Git | COMPLETE (see S1-02) | |
| Universal venue table (shared records, branches) | INCOMPLETE (product decision) | Design proposal only, `docs/UNIVERSAL-VENUES-DESIGN.md`. |

Outside Stage 1 (not database): Google Places matching and the confirm sheet, AI model and rate-limit tuning, Quick Share for unverified venues, and `venue-photo` (see S1-02 note).

## Tasks

### S1-01 Reconcile local changes into the staging branch. APPROVED
- Evidence: backup at `C:\Users\Home\open-finds-2-backup-2026-11-18\` (patch, archive, CLAUDE.md copy). Only the 68-line `CLAUDE.md` header was missing from the branch; committed as `60dea5a` (local, not pushed). Other local files are older copies of work already on the branch.
- Rollback: `git revert 60dea5a`.

### S1-02 Compare deployed staging functions with Git. APPROVED (read-only)
- Evidence (2026-11-18, staging): `extract-venue-meta` v24 matches Git byte for byte (all 6 files). `resolve-place` v26 matches Git except 5 import lines (`./_shared` vs `../_shared`, a bundling difference only). `ai-proxy` v28 and `venue-photo` v2: the shared files and `stagingProviders.ts` match; the main file was checked by markers only (the tool returned it inline), so not byte-verified.
- `geocode` v20 and `discover-venues` v19 were not compared (not part of AI Save).
- Finding for the founder (not a database issue): `venue-photo` is deployed and the app calls it (`src/lib/apiKeys.ts`). It uses plain `fetch` to Google Places, so it bypasses the staging provider controls and the AI Save allowance. Its only limit is 200 calls per user per hour. This conflicts with the decision "staging APK ships without a Google photo".

### S1-03 Record staging-only objects in Git. APPROVED (no change to staging or production)
- Decision: the ledger is a staging testing control, so it is NOT added to `supabase/migrations` (that chain goes to production). It is recorded as an idempotent script in `supabase/staging-only/staging_provider_ledger.sql`, with a README that also records the reminders hazard (the repo reminders migration schedules a job that calls the production URL; staging ran a no-schedule variant under the same version).
- Evidence 2026-11-18: live staging functions match the saved definitions by MD5 (781050db..., 052b1264...); live tables carry constraints and foreign keys the old reference file omitted, now captured. The script was validated on a throwaway real PostgreSQL 18.6 after the full migration chain: applies twice cleanly; function checksums equal staging's; anon and authenticated have no access, service_role can run the control function only; and 19 behaviour checks pass (admit, campaign busy, counted call, refused call kind, finish, duplicate refusal). Staging itself was only read.
- Not done: the reminders migration name difference is documented, not changed (history on production must not be rewritten).

### S1-04 Close anonymous access to sales and billing functions. APPROVED on staging (production not applied)
- Applied to staging 2026-11-18 with founder approval (version 20261118114331, name `close_sales_billing_helpers`). Staging check afterwards: `anon` and `authenticated` can no longer execute either function; `service_role` and the owner still can. The guarded callers (`admin_team`, `my_sales_summary`, `admin_partner_overview`) are still SECURITY DEFINER and callable by signed-in users, so they keep working. Rollback is in the migration comments.
- Not done: production (needs separate approval and a read-only check first).
- Done 2026-11-18: migration `20261118120000_close_sales_billing_helpers.sql`; new test `supabase/tests/17_sales_billing_access.sql` (9 checks); test setup `00_platform_stub.sql` now copies Supabase's default function grants, which is why the old tests never saw this hole.
- Evidence (real PostgreSQL 18.6, scratch install outside the repo, run by me 2026-11-18): before the fix the new test failed 7 of 9 (the 2 working-path checks passed); after the fix 9 of 9 pass; whole suite 257 assertions pass, 0 fail, plus the AI Save concurrency checks (all passed). Existing sales tests (12, 13, 14) still pass.
- Still to do: founder approval to apply to staging, then confirm the signed-out call is refused on staging. Production is a separate approval; production is expected to have the same gap but has not been checked.
- Problem: see audit table.
- Proposed change: new migration that revokes EXECUTE on `sales_summary_for(uuid)` and `partner_billing()` from `anon` and `authenticated`, grants only what the app needs, and keeps `admin_team()` and the sales screens working (they call these from inside guarded functions).
- Acceptance: signed-out call is refused; signed-in non-manager call is refused; manager screens still work; new SQL test added.
- Verification: SQL test on real Postgres; then staging check after approval.
- Risk: medium. Needs founder approval to apply to staging. Production is a separate approval.

### S1-05 Review the other callable functions and fix advisor warnings. APPROVED on staging (production not applied)
- Applied to staging 2026-11-18 with founder approval (migration `restrict_signed_in_functions`). Staging checks afterwards: 0 of the 23 listed functions open to signed-out callers, 0 blocked for signed-in users, none of the 9 intentionally public functions closed, view runs with `security_invoker=true`, 3 functions have a fixed search path. Security advisors re-run: the ERROR (security-definer view) and the 3 search-path warnings are gone; signed-out-callable security-definer functions fell from 51 to 26.
- Remaining advisor items (not defects, not changed): 9 "RLS enabled, no policy" (by design); remaining security-definer warnings are the intentionally public functions, functions that return nothing for signed-out callers, and trigger functions (they cannot be called as RPC; optional later tidy: revoke their EXECUTE from API roles); "leaked password protection disabled" is a Supabase Auth dashboard setting for the founder to decide, not changed.
- Not done: production.
- Earlier record of the local build follows.
- Review result (staging, 2026-11-18): 39 non-trigger functions were callable by signed-out users. No further data leak found beyond S1-04: every function that returns private data already checks `auth.uid()` (empty result or exception for a signed-out caller). Intentionally public and left open: guest RSVP (`submit_plan_rsvp`, `submit_stop_rsvp`, `set_rsvp_decline_reason`), share links (`get_shared_plan`, `get_shared_trip`, `read_venue_recommendation`), and the device-id plan helpers (`app_is_owner`, `app_request_device_id`: row rules for plans and trips apply to anon, so these must stay open). Design note for the founder, not a defect: anyone holding a plan or trip link can read its stops and guest RSVP names, and anyone holding an RSVP id can set a decline reason once; ids are random UUIDs.
- Change: migration `20261118140000_restrict_signed_in_functions.sql` removes anon EXECUTE from 23 functions that already refuse signed-out callers (behaviour-neutral); makes `venue_rating_summary` run with the caller's rights (its table is already publicly readable, so numbers are unchanged; clears the one ERROR advisor); fixes the search path of 3 functions. Functions whose quiet empty answer the app relies on were deliberately not touched.
- Tests: `supabase/tests/19_function_access.sql` (6 checks; 3 fail without the migration). Evidence (real PostgreSQL 18.6, scratch install, 2026-11-18): whole suite passes with the migration, including every earlier signed-out and device-id flow.
- Remaining advisor items, accepted by design: "RLS enabled, no policy" (9 tables, service-role or RPC access only); signed-in users can run security-definer RPCs (that is how the app works; each checks the caller inside).
- Remaining: founder approval to apply to staging, then re-run the security advisors on staging to confirm the ERROR and the 3 search-path warnings are gone.
- Risk: medium. Rollback is in the migration header.

### S1-06 Duplicate protection for saved venues. APPROVED on staging (production not applied)
- Applied to staging 2026-11-18 with founder approval (migration `saved_venue_duplicate_rule`). Staging checks afterwards: still 33 rows; exactly 1 flagged (the later row of the existing pair; the earlier row, with its notes and visited mark, is unflagged); the unique index and trigger exist; `anon` cannot call `save_shared_venue`, `authenticated` can; a repeat insert and an insert that tries to set the flag were both refused inside a rolled-back test (nothing kept, row count unchanged).
- Not done: production (needs a read-only duplicate count and its own approval). The record below describes the local build.
- Founder decision 2026-11-18: keep the existing duplicate rows (no deletion).
- Built: migration `20261118130000_saved_venue_duplicate_rule.sql` (one saved venue per person per name and address, capitals and edge spaces ignored; later rows of any existing duplicate group are flagged `legacy_duplicate` and exempt, so nothing is deleted and it cannot fail on unexpected production data; a trigger stops people setting or clearing the flag; `save_shared_venue` now matches on name and address instead of the link, so a second venue from one link is saved). App side: `insertSavedVenue` returns the existing venue on a repeat save, `updateSavedVenue` explains a clash in plain words.
- Tests: `supabase/tests/18_saved_venue_duplicates.sql` (13 checks) and `src/lib/savedVenues.test.ts` (5 tests).
- Evidence (real PostgreSQL 18.6, scratch install, run 2026-11-18): all 270 SQL assertions pass, 0 fail, and the new test fails without the migration. App tests for the new file pass (5 of 5). Full `npm run check` (2026-11-18): typecheck pass, lint 0 errors (3 warnings), 41 app test files and 13 edge test files pass, build succeeds.
- Known limits: (1) if a person renames a saved venue and then re-shares the original link, the server treats it as a new venue (the app normally catches this earlier by link). (2) The app's "already saved from this link" shortcut still only fires when exactly one venue has that link, so a second venue from a two-venue link can't be reached by re-sharing; that is app behaviour, not database. (3) Production duplicates have not been counted.
- Remaining: founder approval to apply to staging, then check the staging pair is flagged (earliest unflagged, later flagged) and that a repeat insert is refused.
- Risk: medium. Rollback is in the migration header.

### S1-07 Bring in `preserve_claimed_plan_ownership`. APPROVED on staging (production not applied)
- Applied to staging 2026-11-18 with founder approval (migration `preserve_claimed_plan_ownership`). Staging checks afterwards: both triggers exist (`plans`, `trips`); plan and trip counts unchanged (3 and 0); API roles cannot call the trigger function; inside a rolled-back test on a real claimed plan, clearing the owner and handing it to another user were both refused, and an ordinary update still worked. Nothing kept.
- Not done: production.
- Earlier record of the local build follows.
- Founder decision 2026-11-18: bring it in. Copied unchanged from `origin/codex/phase-1-staging-db`: migration `20261114120000_preserve_claimed_plan_ownership.sql` (a plan or trip owner cannot be changed once set; the normal sign-in claim, which fills an empty owner, is unaffected) and its test, renumbered to `supabase/tests/20_claimed_plan_ownership.sql` because 19 was taken.
- Evidence (real PostgreSQL 18.6, scratch install, 2026-11-18): without the migration the test fails ("Plan ownership must remain claimed"); with it the whole suite passes, 277 assertions, 0 fail.
- Remaining: founder approval to apply to staging, then confirm the trigger exists and a claim still works. Risk: low; rollback `DROP TRIGGER preserve_claimed_plan_ownership ON plans; DROP TRIGGER preserve_claimed_trip_ownership ON trips; DROP FUNCTION preserve_claimed_plan_ownership();`.

### S1-08 Run the full database tests on real Postgres 17 and CI. APPROVED for the database tests (one unrelated app-test flake open)
- Pushed `feature/staging-reconciliation` at `ac9e02c` and opened draft PR #3 into `main` (2026-11-18, founder approved) so GitHub's CI runs (CI does not run on a plain feature-branch push).
- Result (GitHub Actions run 44301145126): job "migrations · RLS assertions" (`supabase/tests/run.sh` on Postgres 17 in Docker) SUCCEEDED, which covers the full migration chain and every SQL test file including 17 to 20. Job "typecheck · lint · test · build": typecheck and lint passed; "Unit tests" FAILED on one test, `src/pages/UnifiedPlanner.test.tsx` "renders all four sections in one document" ("Unable to find ... button 'Go to Itinerary'"), so the build step was skipped.
- Re-run (founder approved, attempt 2 of the same run): the database job passed again; "Unit tests" failed again on the same test, so on GitHub it fails every time. Locally it passes alone and in 4 of 5 full runs (350 of 350) including with `TZ=UTC` and `CI=true`, and failed once, also on this same test, in the first full run under load. It is the first test in its file, so the likeliest cause is timing on a slower machine, not proven.
- Origin: the planner page and this test were last changed on this branch by `c026961` ("Prepare Quick Share and Android staging APK"), before Stage 1 work. None of the Stage 1 commits touch `src/pages/UnifiedPlanner*`. The test never ran in CI on this branch before PR #3. It is an app-test issue, outside the database scope, and blocks a green PR; proposed as a separate task.
- Result after the planner test fix (pushed 2026-11-19 at `5d9294b`, GitHub Actions run 44312494415): BOTH jobs passed, "typecheck · lint · test · build" and "migrations · RLS assertions" (Postgres 17). Draft PR #3 is green and mergeable; still unmerged.
- Original local evidence (real PostgreSQL 18.6, scratch install) remains in the entries above.

### S1-09 Live Save Venues test on staging. APPROVED for the database integration (some live cases not covered, listed below)
- Final live check (23:44 Sydney time, read-only): sharing the Chubby Cubby link again opened the saved venue ("Saved to My Venues") with no AI call: staging logs show only reads of `saved_venues` and the device-claim call that runs when the app loads, no extract-venue-meta, ai-proxy or resolve-place, and the AI attempt count stayed at 5, the table at 35 rows, 0 live duplicate groups. The app reloading its list from staging (device claim followed by a `saved_venues` read) shows saved venues persist across an app load; a deliberate full close and reopen was not separately confirmed.
- Not covered live (not database defects): a post with two venues in one link (covered by Part A at the database level), a second real account (covered by Part A), the 20-attempts-per-30-minutes limit, and the wording for provider outages versus unverified venues. Provider and Google issues found are listed in the Part B update below: TikTok link not readable by the AI, and the Google photo lookups outside the allowance.
- Earlier record follows.
- Part B update (founder's phone, new build with the Confirm-the-venue list; read-only check of staging at 23:42 Sydney time): the earlier "nothing saved" attempts (21:16, 21:20, 23:32) all stopped at the Google "could not match" screen and were not saved. Then two real saves went through `rpc/save_shared_venue` (HTTP 200): Chubby Cubby Cafe (picked from the Confirm list; link from an Instagram reel; coordinates -33.8718, 151.2054) at 23:38:17, and Powerhouse Parramatta (the AI could not identify a venue from the TikTok link, so the founder searched Google Places by hand and picked the result; coordinates -33.8121, 151.0061) at 23:41:13. Both rows persisted with name, address, type, coordinates and source link, saved for the founder's account, `legacy_duplicate` false. Table now 35 rows (33 + 2), 0 live duplicate groups. AI allowance used: 5 attempts in 3 hours (limit 20 per 30 minutes), 2 counted requests each, no testing-limit or 503 responses.
- Findings outside the database: (1) the AI could not read a venue from one TikTok link (manual Google search worked). (2) Google no-match then candidate list works as designed. (3) The app shows Google venue photos: `venue-photo` ran about 25 times in 5 minutes (each saved venue gets one Places search and one photo lookup the first time it is shown) and is not covered by the AI Save allowance or the staging provider controls; this conflicts with the earlier decision "no Google photos in this release" and costs Google quota. Founder decision needed; nothing changed.
- Still to verify live: share the first link again (should open the saved venue with no new AI call), fully close and reopen the app, optionally a two-venue link.
- Part B check (read-only, 2026-11-18, staging logs and tables): the founder's account ran 2 AI Save attempts, at 21:16 and 21:20 Sydney time. Each went extract-venue-meta 200, ai-proxy 200, resolve-place 200 (so the AI and Google steps worked, no 503), and the attempt table shows 2 attempts, 2 counted requests each, well inside the 20-per-30-minutes allowance. After that there is NO save call (no `save_shared_venue` RPC, no write to `saved_venues`) and no new saved venue from that account. The one new saved venue today belongs to another account, saved at 17:10 (unverified, no coordinates, has a photo). Also two `resolve-place` calls returned 401 (no valid sign-in) at 22:20 Sydney time, source unknown (not an AI Save attempt of this account).
- Conclusion: the live save path, persistence after reopening, the repeat-share check and the same-link two-venue case were NOT exercised live. Needs the founder's account of what the app showed and whether Save was tapped, then a repeat run. Acceptance for Part B remains open.
- Part A result (staging, 2026-11-18, run inside one transaction that was rolled back, acting as two signed-in users and a signed-out caller; no paid call): 17 of 17 checks PASS: save and return (A1); retry returns the same venue (A2); different capitals and spacing return the same venue (A3); a second venue from the same link is saved (A4, A5); repeat manual save refused (A6); same name at another address allowed (A7); setting the old-duplicate flag does not bypass the rule (A8, A9); owner can edit (A10); another user cannot see, edit or delete (B1 to B3); another user can save the same venue as their own (B4); signed-out cannot save and sees nothing (C1, C2); the pre-fix duplicate pair is intact (D1). Afterwards: 33 saved venues, 1 flagged, 0 leftover test rows. Limit: this exercises the database as PostgREST does (role and user id set), not the HTTP layer or the app screens.
- Plan (Part A and B) follows.
- Split into two parts so the database part never waits on paid providers:
  - Part A, database integration (free, no paid call, nothing kept): on staging, inside transactions that roll back, act as two signed-in users exactly as the API does (`SET ROLE authenticated` plus the user id) and check: `save_shared_venue` saves and returns the venue; a retry returns the same row; a second venue from the same link is saved; a repeat manual insert is refused; the other user cannot read, edit or delete the first user's saved venues; signed-out cannot call `save_shared_venue`; `legacy_duplicate` cannot be set; the earlier (pre-fix) duplicate pair is still intact. Acceptance: every check as expected; row counts unchanged afterwards. Risk: low.
  - Part B, live providers (paid, founder's device): founder shares 2 to 3 public Instagram or TikTok venue links on the staging app while signed in to a staging account; I give a short checklist and afterwards read staging read-only to confirm the saved rows, coordinates, no duplicates, and the attempt ledger (`ai_save_attempts`). Max 3 retries per request, at most about 9 AI and 9 to 18 Google Places calls in total (a rough cost under a few dollars at list prices; the founder's own OpenRouter and Google limits stay the hard stop; I will not change provider settings or secrets). Acceptance (from the Phase 4 handover): an ordinary account can start AI Save; a real link yields the right venue and branch or a clear "unverified" result; review and save works; the venue is still there after reopening the app; a retry costs no extra allowance; another user cannot see it. Risk: medium (paid calls, and provider switches I cannot read).
- Provider and Google matching problems found in Part B are recorded as separate issues, not database defects.

### S1-10 Final regression run and documentation. APPROVED (staging scope)
- Final run on the branch tip, 2026-11-18, local: real PostgreSQL 18.6 scratch install: full migration chain (56 migrations) applies and all 277 SQL assertions pass, 0 fail; staging ledger script check 19 of 19 pass; `npm run check`: typecheck pass, lint 0 errors (3 existing warnings), 41 app test files (350 tests) and 13 edge-function test files (251 tests) pass, build succeeds. GitHub CI (draft PR #3): the Postgres 17 database job passed on both attempts; the app-test job fails on one planner test (see S1-08 and open item 3).
- Documentation: this tracker (single Stage 1 tracker) and a "Database rules for saved venues" note plus corrected `insertSavedVenue` and `updateSavedVenue` rows in `DOCUMENTATION.md`. `supabase/staging-only/README.md` documents the staging-only script and the reminders hazard.
- Applied to staging only; production is not touched, so Stage 1 is complete for staging and open for production (open item 1).
- Human event-planning test (founder, staging app, 2026-11-18 evening): create an event with stops, reopen the app, edit and reorder, share the link, guest RSVP from another browser without signing in, and see the reply as host: steps 1 to 6 all passed. Read-only log check afterwards (staging, from 22:45 Sydney time on): 0 failed requests (no 4xx or 5xx on the app, API or functions) and 0 database errors; the planning calls (plans, stops, rsvps, `get_shared_plan` 15 calls, `submit_plan_rsvp` 1 call, `claim_device_rows` 4 calls) all succeeded. Not covered: a second signed-in account on the event (optional step 7).
