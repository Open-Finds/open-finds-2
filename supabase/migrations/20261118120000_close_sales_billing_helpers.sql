-- Stage 1 task S1-04.
-- sales_summary_for(uuid) and partner_billing() are internal helpers. The
-- earlier migrations ran `REVOKE ALL ... FROM PUBLIC`, but Supabase also grants
-- EXECUTE on every new public function to anon and authenticated directly, so
-- those grants survived and anyone could call them through /rest/v1/rpc:
--   * partner_billing() returned billed visits and amounts for every venue partner;
--   * sales_summary_for(uuid) returned commission and billing totals for any user id.
-- The only legitimate callers are guarded SECURITY DEFINER functions
-- (admin_team, my_sales_summary, admin_partner_overview), which run as the
-- function owner and keep working. The app and Edge Functions never call these
-- two directly (checked 2026-11-18).
--
-- Rollback (only if something unexpectedly needed direct access):
--   GRANT EXECUTE ON FUNCTION public.sales_summary_for(uuid) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.partner_billing() TO authenticated;
REVOKE ALL ON FUNCTION public.sales_summary_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_billing() FROM PUBLIC, anon, authenticated;
