-- ROLLBACK for supabase/migrations/20261118140000_restrict_signed_in_functions.sql
-- Undoes: closes 23 signed-in-only functions to signed-out callers; rating view caller rights; fixed search paths
-- Data effect: none (access and settings only)
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY['admin_partner_overview', 'admin_record_payout', 'admin_set_commission', 'admin_set_role', 'admin_set_visit_rate', 'admin_team', 'my_sales_summary', 'claim_device_rows', 'record_venue_events', 'get_venue_event_stats', 'get_collection_members', 'share_collection_with_users', 'share_collection_with_group', 'remove_collection_member', 'can_access_collection', 'owns_collection', 'owns_friend_group', 'is_friend_group_member', 'is_admin', 'is_manager', 'is_staff', 'venue_accepts_events', 'venue_open_for_reviews'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', f.sig);
  END LOOP;
END $$;
ALTER VIEW public.venue_rating_summary RESET (security_invoker);
ALTER FUNCTION public.update_friendship_timestamp() RESET search_path;
ALTER FUNCTION public.stamp_collection_venue_added_by() RESET search_path;
ALTER FUNCTION public.stop_rsvp_identity(uuid, text, text) RESET search_path;
