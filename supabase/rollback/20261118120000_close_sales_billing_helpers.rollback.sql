-- ROLLBACK for supabase/migrations/20261118120000_close_sales_billing_helpers.sql
-- Undoes: closes sales_summary_for and partner_billing to the API
-- Data effect: none. WARNING: this REOPENS the sales and billing exposure to signed-out users
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

GRANT EXECUTE ON FUNCTION public.sales_summary_for(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_billing() TO anon, authenticated;
