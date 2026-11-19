# Staging-only SQL

Not migrations. The supabase CLI and `supabase/tests/run.sh` never run this folder, and nothing here may be applied to production.

| File | What it is |
| --- | --- |
| `staging_provider_ledger.sql` | The spending ledger behind the listed-test-account staging controls (3 tables, 2 functions). Safe to re-run. Matches the live staging project (checked 2026-11-18). Open mode does not use it. |

## Rebuilding a staging project
1. Apply `supabase/migrations` in order.
2. Apply `staging_provider_ledger.sql` by hand, on staging only.
3. Do **not** let `20261014120000_review_reminders.sql` schedule its hourly job on staging: it calls the production function URL. The live staging project recorded that migration as `review_reminders__STAGING_NO_CRON` (same version, no schedule). Skip the schedule block when rebuilding.
