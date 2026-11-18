# Rollback scripts for the production release

One `.rollback.sql` per pending migration. They are NOT migrations: the Supabase tools never run this folder, and nothing here runs unless a person runs it on purpose. They exist so that if a production release step fails or misbehaves, it can be undone safely.

Read `docs/PRODUCTION-RELEASE-PLAN.md` first. Nothing has been run on production.

## Order
Always undo in the reverse order of the release. Undo only as far back as needed.

| # | Undo this | Script | What it does to data |
|---|---|---|---|
| 1 | `20261118140000` signed-in functions closed | `20261118140000_restrict_signed_in_functions.rollback.sql` | None. |
| 2 | `20261118130000` duplicate saved-venue rule | `20261118130000_saved_venue_duplicate_rule.rollback.sql` | Drops only the `legacy_duplicate` flag column; no venue is deleted. |
| 3 | `20261118120000` sales/billing helpers closed | `20261118120000_close_sales_billing_helpers.rollback.sql` | None. **Reopens the sales and billing exposure to signed-out users.** |
| 4 | `20261117130000` AI Save attempt counter | `20261117130000_ai_save_attempt_allowance.rollback.sql` | Drops the short-lived attempt counters. |
| 5 | `20261114120100` private collection notes | `20261114120100_keep_shared_collection_notes_private.rollback.sql` | None. **Reopens the leak of private notes in shared collections.** |
| 6 | `20261114120000` plan ownership protection | `20261114120000_preserve_claimed_plan_ownership.rollback.sql` | None. |
| 7 | `20261112110000` invite ownership rule | `20261112110000_require_plan_invite_ownership.rollback.sql` | None. |
| 8 | `20261112100000` standalone recommendations | `20261112100000_standalone_venue_recommendations.rollback.sql` | **Refuses to run** if any standalone recommendation exists. |
| 9 | `20261108120000` AI Save | `20261108120000_ai_save_quick_share.rollback.sql` | **Refuses to run** if any venue recommendation exists. |
| 10 | `20261028120000` optional event end | `20261028120000_optional_event_end.rollback.sql` | **Refuses to run** if any plan has an end time or date. |
| 11 | `20261027190000` six-stop limit | `20261027190000_six_stop_planner.rollback.sql` | None. Puts back the earlier limit (2 free, 5 paid or unlocked). |

## Rules
- A script that would destroy data created after the release stops with a clear message. Export the data first; only then remove the guard on purpose.
- Every script is safe to run twice.
- After any undo, check the result: run `scripts/schema-fingerprint.sql` and compare with the plan, and re-run the checks in the plan.
- A rollback restores definitions and access exactly as they were before. It cannot bring back data that a migration never had (for example, end times people entered after the release).

## How it was tested
`scripts/release-rehearsal/` builds a throwaway database equal to production's schema, adds made-up rows, applies the release, runs these rollbacks, and compares structure, access, settings and a data hash before and after. Result on 2026-11-19: full release then full rollback returns the database exactly to the start (and a second run is harmless); the quick security fix and its undo return exactly to the start; undoing only the last three migrations returns exactly to the state after the first eight; the guarded rollbacks refuse when data exists.
