-- Stage 1 task S1-05: defence in depth for functions that only make sense signed in.
--
-- Supabase grants EXECUTE on every public function to anon and authenticated
-- directly, so `REVOKE ... FROM PUBLIC` in earlier migrations never closed them to
-- signed-out callers (this is how sales_summary_for leaked; see 20261118120000).
-- Every function below already refuses a signed-out caller (it raises, or its
-- guard fails), so removing anon EXECUTE changes no behaviour: a signed-out call
-- now stops at the door instead of inside the function. Signed-in use is untouched.
--
-- Deliberately NOT revoked (signed-out visitors use them, or the app relies on
-- their quiet empty answer): app_is_owner and app_request_device_id (row rules
-- for device-id plans), get_shared_plan, get_shared_trip, submit_plan_rsvp,
-- submit_stop_rsvp, set_rsvp_decline_reason, read_venue_recommendation,
-- reorder_plan_stops, stop_rsvp_identity, premium_unlocked, visit_rate_cents,
-- app_role, sponsored_venues, venue_reviews_for, my_credits, find_profile_by_username,
-- get_public_profiles, search_profiles, my_unclaimed_row_counts.
--
-- Rollback: GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[
        'admin_partner_overview', 'admin_record_payout', 'admin_set_commission',
        'admin_set_role', 'admin_set_visit_rate', 'admin_team', 'my_sales_summary',
        'claim_device_rows', 'record_venue_events', 'get_venue_event_stats',
        'get_collection_members', 'share_collection_with_users', 'share_collection_with_group',
        'remove_collection_member',
        'can_access_collection', 'owns_collection', 'owns_friend_group', 'is_friend_group_member',
        'is_admin', 'is_manager', 'is_staff', 'venue_accepts_events', 'venue_open_for_reviews'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f.sig);
  END LOOP;
END $$;

-- The rating summary view ran with its owner's rights. Its table already allows
-- everyone to read, so running it with the caller's rights returns the same
-- numbers and clears the "security definer view" warning.
ALTER VIEW public.venue_rating_summary SET (security_invoker = true);

-- Three functions had no fixed search path. None looks anything up by name
-- (auth.uid() is schema-qualified; the rest is built in), so an empty path is safe.
ALTER FUNCTION public.update_friendship_timestamp() SET search_path = '';
ALTER FUNCTION public.stamp_collection_venue_added_by() SET search_path = '';
ALTER FUNCTION public.stop_rsvp_identity(uuid, text, text) SET search_path = '';
