# Production release plan (DRAFT: nothing here has been run on production)

Written 2026-11-19 for the founder. Production project: `wfrlkifdlgmlbffumglt`. Everything below was found with read-only checks (selects, the migration list, the function list and the security advisors). No write, migration or deployment has touched production. Each step needs the founder's explicit approval before it is run.

## 1. Where production stands

| Question | Answer | How it was checked |
|---|---|---|
| Is production's real database the same as our migrations up to 15 October (45 migrations)? | **Yes, exactly.** All 31 tables have identical columns, indexes, policies, triggers and row security. 61 of 62 functions are byte-identical; the 62nd (`update_friendship_timestamp`) differs only by two spaces of indentation. The one view is identical. | `scripts/schema-fingerprint.sql` was run on a throwaway Postgres built from the migrations and on production, and the hashes were compared. Constraints match once Postgres 18's extra not-null entries are ignored (production runs Postgres 17.6). |
| Does production's migration history say so? | **No.** It records only 33 migrations, stopping at `20260923160000`. Eleven migrations between 25 September and 15 October are in the database but not in the history (list below). | Production migration list. |
| What is missing from production? | Eleven migrations from `20261027190000` on: six-stop planner, optional event end, AI Save, plan-invite ownership, private collection notes, and all Stage 1 fixes. | Those objects are absent. |
| Is the sales/billing hole open on production? | **Yes.** Signed-out users can read `partner_billing()` and `sales_summary_for(any user id)`. The same 51 signed-out-callable functions, the security-definer rating view and 3 loose search paths that staging had are there. | Function privileges and production security advisors. |
| Data size and quirks | 520 saved venues (7 groups of duplicates), 175 plans (142 have no owner id yet), 31 tables all with row security. Settings: `premium_unlocked` = true, `visit_rate_cents` = 10. Production stop limit is 2 (free) or 5 (paid or unlocked), so with `premium_unlocked` on, everyone gets 5 today. | Counts and settings only; no personal data read. |
| Production Edge Functions | Older than the branch: ai-proxy v22, resolve-place v17, extract-venue-meta v29, geocode v15, travel-times v30, address-suggest v8, send-push-notification v24, review-reminders v6, stripe-* functions. `venue-photo` does not exist there. | Function list (metadata only; source not yet compared). |

### Eleven migrations already in production but not in its history (record only, do not run)
`20260925120000_stripe_billing`, `20260927090000_public_profile_lookup`, `20260927120000_search_profiles`, `20260927140000_premium_unlock_switch`, `20261002120000_host_rsvp`, `20261005120000_admin_roles_and_partners`, `20261009120000_sales_team`, `20261010120000_workers_reviews_credits`, `20261012120000_admin_approval_and_one_rate`, `20261014120000_review_reminders`, `20261015120000_venue_photos`.

Running these again would fail ("already exists") or, worse, half-apply. Their history must be fixed by recording them as applied.

### Eleven migrations missing from production (to apply, in this order)
| Migration | What it does | Risk and behaviour change |
|---|---|---|
| `20261027190000_six_stop_planner` | Stop limit becomes 6 for every account; sets flag `planner_six_stops`. | **Decided by the founder, 2026-11-19:** 6 stops for everyone. Subscription locks are not part of this release (pricing is still being worked out); `premium_unlocked` stays on and no subscription rule is changed. |
| `20261028120000_optional_event_end` | Adds optional `end_time`/`end_date` to plans with a check that both are set together; sets flag `planner_event_timing`. | Additive. Existing 175 plans pass the check (both empty). Short table lock. |
| `20261108120000_ai_save_quick_share` | `save_shared_venue` function and `venue_recommendations` table (row security, no direct access). | Additive. |
| `20261112100000_standalone_venue_recommendations` | Lets a recommendation exist without a saved venue; `publish_standalone_venue_recommendation`. | Additive (relaxes one column on a table created just before, no data). |
| `20261112110000_require_plan_invite_ownership` | Only the plan owner can invite. | Behaviour change: test that invites still work for hosts. |
| `20261114120000_preserve_claimed_plan_ownership` | Owner cannot change once set. | Safe: the 142 unclaimed plans are unaffected (only changes of a set owner are blocked). |
| `20261114120100_keep_shared_collection_notes_private` | Shared collection members no longer see other people's notes or ratings. | Same response shape, with blanks; fixes a privacy leak that is expected on production. |
| `20261117130000_ai_save_attempt_allowance` | AI Save attempt counter (service role only). | Additive. Used only when open mode is on; harmless otherwise. |
| `20261118120000_close_sales_billing_helpers` | Closes `sales_summary_for` and `partner_billing` to the API. | Fixes the open hole. No effect on the sales screens (checked). |
| `20261118130000_saved_venue_duplicate_rule` | One saved venue per name and address; the 7 existing duplicate groups are flagged, not deleted. | Index build on 520 rows is instant. The current app shows a raw error if someone saves a duplicate; the new app handles it. |
| `20261118140000_restrict_signed_in_functions` | Closes 23 signed-in-only functions to signed-out callers; rating view runs with caller rights; fixes 3 search paths. | Behaviour-neutral for the app (rehearsed and tested). |

## 2. Recommended order of work

### Step A: fix the open hole now (small, reversible, rehearsed). DONE on production, 2026-11-19 Sydney time

**Applied on production with the founder's approval** (Sydney 00:41 to 00:42 on 19 Nov; migrations recorded as `20261118134143 close_sales_billing_helpers` and `20261118134208 restrict_signed_in_functions`). The Supabase free plan has no automatic backups, so no backup could be taken; this step changes only access settings and one view option and no data, so a before-snapshot plus the tested rollback were the safety net.
- **Before (read-only snapshot):** 520 saved venues, 175 plans, 142 unowned plans, 31 tables, 45 signed-out-callable functions, view option none, settings `premium_unlocked=true`, `visit_rate_cents=10`, and the access list of all 28 functions touched (every one had explicit `anon` and `authenticated` access; the three loose-path functions had no fixed path).
- **After (checked):** counts identical (520, 175, 142, 31); settings identical; signed-out-callable functions 45 to 20; the 25 functions closed to signed-out callers; the 23 signed-in functions still open to signed-in users; the guest RSVP, share-link and device-plan functions still open; the rating view runs with the caller's rights; the 3 functions have a fixed search path. Nothing else depended on the two sales/billing helpers (only the three protected functions, which run with the owner's rights).
- **Behaviour check on production (inside a transaction that rolled back, nothing kept):** signed-out `sales_summary_for`, `partner_billing`, `admin_team` and `my_sales_summary` refused at the door; signed-out `get_shared_plan` and the guest RSVP function still reachable; signed-in `sales_summary_for` refused; signed-in non-staff `my_sales_summary` and non-manager `admin_team` reach their own guards ("Staff only", "Managers only"); both roles can read the rating summary (production has no ratings yet, so it is empty).
- **Security advisors afterwards:** the security-definer view ERROR and the 3 search-path warnings are gone; signed-out-callable security-definer functions 51 to 26. The remaining warnings are the intentionally public functions, functions that return nothing to signed-out callers, trigger functions, `pg_net` in the public schema, and leaked-password protection (an Auth dashboard setting, still off).
- **Logs afterwards:** no failed (4xx/5xx) requests and no database errors since the change.
- **Checked by a person (founder, www.theunsaved.app, 2026-11-19):** Admin and Sales screens and an event invite link with a guest RSVP: "everything looks good". Production logs for that time agree: `admin_team` and `admin_partner_overview` succeeded, 26 `get_shared_plan` calls and 1 `submit_plan_rsvp` succeeded, no failed database calls and no database errors apart from my own two deliberate test errors. One `travel-times` call returned 400 (a request the function rejected; the next four succeeded); it is an Edge Function call that does not use any function changed here, so it is not related to this change.
- **Undo, if anything looks wrong:** run `supabase/rollback/20261118140000_restrict_signed_in_functions.rollback.sql` and `20261118120000_close_sales_billing_helpers.rollback.sql` (the second reopens the exposure).

**Plan as written before it was applied:**
Apply only `20261118120000` and `20261118140000` to production. This works on its own because production's schema equals the first 45 migrations.
- **Rehearsal (done, 2026-11-19):** on a throwaway Postgres built to be production-equivalent, before the fix `sales_summary_for` was open to signed-out callers; after it, none of the 25 functions is, all 23 signed-in functions still work for signed-in users, guest RSVP and share-link functions stay open, the view and the 3 search paths are fixed, applying them twice is harmless, and the admin, sales, credits, groups, guest-RSVP, identity and correctness test files all pass.
- **Approval needed:** yes, to apply to production.
- **How:** run each as its own migration; they only remove access and set options.
- **Check afterwards:** security advisors (the ERROR and 3 search-path warnings gone); `has_function_privilege('anon', ...)` false for the 25 functions; a manager can still open the Admin and Sales screens; guest RSVP still works.
- **Undo:** `supabase/rollback/20261118120000_close_sales_billing_helpers.rollback.sql` and `20261118140000_restrict_signed_in_functions.rollback.sql` (tested; see Backup and rollback below).
- **Note:** run this way the two migrations get new version numbers in production's history. Re-running them later in Step D is harmless.

### Step B: fix production's migration history (no schema change)
Record the 11 unrecorded migrations as applied (names above) in `supabase_migrations.schema_migrations` (or `supabase migration repair --status applied`).
- **Why it is safe:** the fingerprint comparison proves the database already equals them.
- **Approval needed:** yes.
- **Undo:** delete those 11 history rows (a `DELETE` on `supabase_migrations.schema_migrations` for the 11 versions listed above); no schema is touched.
- **After it:** the history should list everything up to `20261015120000`.

### Step C: rehearse the remaining nine migrations on a copy
Build a throwaway database to the production-equivalent schema, load synthetic rows that mimic production quirks (duplicate saved venues, plans with no owner, shared collections with notes, plans with 5 and 6 stops), apply the nine migrations in order, and run the full test suite. Optionally also a Supabase preview branch of production (founder approves any cost). No production data is copied.
- **Approval needed:** none for the scratch copy (read-only on production); the preview branch needs approval for cost.

### Step D: apply the remaining migrations to production in one planned release
- **When:** a quiet window the founder chooses; announce if needed.
- **First:** confirm a recent backup or point-in-time recovery in the Supabase dashboard (not verifiable from here), and take a fresh manual backup.
- **How:** apply in the order of the table above, one migration at a time, checking after each; stop at the first surprise.
- **Founder decisions (made 2026-11-19):** the six-stop limit applies to everyone; subscription locks are left alone for now (`premium_unlocked` stays on, pricing still in brainstorming). The two migrations switch on the flags `planner_six_stops` and `planner_event_timing` themselves, so the new planner is on at release. Still open: the backup confirmation and the release window.
- **Check afterwards:** counts unchanged (saved venues 520, plans 175); 7 duplicate groups flagged (not deleted); advisors clean; run `scripts/schema-fingerprint.sql` on production against a build of all 56 migrations and confirm it matches (apart from the one indentation difference).
- **Undo:** one tested rollback script per migration in `supabase/rollback/`, run in reverse order (see Backup and rollback below). No migration deletes saved venues or plans.

### Step E: release functions and the app (after the database)
- **Compare first (read-only):** production's deployed Edge Functions against the branch, as was done for staging (S1-02). The branch code is a pass-through on production (the staging controls switch on only for the staging project), but this has not been proven against production's current versions.
- **Functions to deploy:** `ai-proxy`, `extract-venue-meta`, `resolve-place`, `venue-photo` (new), and any others that differ. Secrets for OpenRouter and Google must exist on production (not visible from here; founder confirms).
- **Google photos:** the founder decided to keep them; they run outside the AI Save allowance, so watch Google quota and billing alerts at release.
- **App:** merge PR #3 only after Steps A to D are done and the founder approves; the web app (Vercel) must use production's URL and key, and the Android staging build must never be pointed at production.
- **Order matters:** database first (it is compatible with the app now in production), then functions, then app.

### Backup and rollback (added 2026-11-19)

**Backup.** I cannot create a database backup from here (no access to the dashboard's backup tools, and I will not copy private data into files). So the backup step is an explicit part of the release checklist:
1. **Founder confirmed on 2026-11-19 that the Supabase free plan has no backups.** Step A went ahead without one because it changes no data (see Step A). **Before Step B and Step D, a backup is still needed** because Step D adds a column and flags rows. Options: upgrade the project to a plan with daily backups for the release window, or take a manual database dump under the founder's own login with the Supabase CLI (`supabase db dump`, schema and data; never paste keys into chat) and store it safely, since it holds private data. No production step that touches data runs until one of these is done.
2. **Before each step I record the "before" numbers** (saved venues 520, plans 175, 142 unowned plans, 31 tables, settings `premium_unlocked` and `visit_rate_cents`) and run `scripts/schema-fingerprint.sql`, so any change can be seen.
3. The migrations never delete rows. The only data they write is a flag on the 7 duplicate saved-venue groups and two settings rows, all covered by the rollbacks.

**Rollback kit (built and tested).** `supabase/rollback/` holds one rollback script per pending migration (list and order in its README). Each restores the exact earlier definitions and access, is safe to run twice, and refuses to run if it would destroy data created after the release (it says to export first).
- **Tested** on a production-equivalent throwaway database with made-up rows (`scripts/release-rehearsal/`):
  - Releasing all 11 migrations and rolling all 11 back returns the database exactly to the start (structure, function and table access, settings, and a hash of the data). A second run is harmless.
  - The quick security fix and its undo return exactly to the start.
  - Undoing only the last three returns exactly to the state after the first eight.
  - The guarded rollbacks refuse when AI Save recommendations or event end times exist.
  - The rehearsal caught three mistakes in my first draft (a missing access grant on one rollback, access-list ordering in the comparison, and safety checks that failed on a second run). That is why it was worth doing.
- **Each migration runs as one transaction,** so a failure inside one leaves nothing half-applied. If migration N fails, stop: nothing after it runs, and the ones before it are kept or rolled back in reverse order, as the founder decides.

**When to roll back.** Roll back the last step if, after it: the advisors or the fingerprint show something unexpected, a manager cannot open the Admin or Sales screens, a guest cannot RSVP, someone cannot create or edit an event, saving a venue fails, or new errors appear in the logs.

**What a rollback does not undo.** Data created after the release in the new places (AI Save recommendations, event end times): the scripts refuse and tell you to export it first. Two rollbacks deliberately reopen old problems (the sales and billing exposure, and private notes in shared collections), so they are for emergencies only. The migration-history rows from Step B are removed separately.

**Fixing forward is also allowed.** A small, clear bug can be fixed with a new migration instead of a rollback. Either way the founder approves.

## 3. What could go wrong, and the answer

| Risk | Plan |
|---|---|
| Re-running already-present migrations breaks production | Step B records them; never run `supabase db push` before it. |
| The hole stays open while the big release is prepared | Step A closes it first and separately. |
| A migration surprises on real data | Step C rehearses with synthetic rows; apply one at a time; stop on the first surprise. |
| No backup | Founder confirms backups or point-in-time recovery before Step A and Step D; take a manual backup if there is none. A tested rollback kit covers the schema, access and settings (it cannot replace a data backup). |
| Behaviour change for users (six stops, invite rules) | Founder confirms each; tests listed above. |
| The reminders job runs twice or points at the wrong place | `20261014120000` is already in production (its hourly job exists); Step B records it, nothing re-runs it. |
| App and database out of step | Database first, then functions, then app; old app stays compatible. |

## 4. Not verified (cannot be checked from here)
- Backups and point-in-time recovery on production.
- Production secrets (OpenRouter, Google, Stripe live or test, VAPID) and Auth settings (redirect URLs, leaked-password protection is off).
- The source of production's deployed Edge Functions (only their versions were read).
- Vercel production environment variables.
- Whether anyone changed production by hand after 15 October, beyond what the fingerprint covers (public schema only; auth, storage, cron and extensions were not compared).

## 5. Decisions needed from the founder
1. Approve Step A (the quick fix) and when to run it. (Decided: six stops for everyone; subscription locks untouched while pricing is worked out; planner flags switch on with the migrations.)
2. Approve Step B (record history).
3. Backups confirmed in the dashboard (before Step A and Step D), and a release window for Step D.
4. Who tests after release, and who confirms the secrets exist on production.
