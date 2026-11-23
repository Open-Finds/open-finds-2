\set QUIET on
SET client_min_messages TO notice;

-- Stage 1 task S1-05: signed-in-only functions are closed to signed-out callers;
-- the ones signed-out visitors use stay open.

DO $$
DECLARE
  closed text[] := ARRAY[
    'admin_partner_overview', 'admin_record_payout', 'admin_set_commission', 'admin_set_role',
    'admin_set_visit_rate', 'admin_team', 'my_sales_summary', 'claim_device_rows',
    'record_venue_events', 'get_venue_event_stats', 'get_collection_members',
    'share_collection_with_users', 'share_collection_with_group', 'remove_collection_member',
    'can_access_collection', 'owns_collection', 'owns_friend_group', 'is_friend_group_member',
    'is_admin', 'is_manager', 'is_staff', 'venue_accepts_events', 'venue_open_for_reviews'];
  stays_open text[] := ARRAY[
    'app_is_owner', 'app_request_device_id', 'get_shared_plan', 'get_shared_trip',
    'submit_plan_rsvp', 'submit_stop_rsvp', 'set_rsvp_decline_reason',
    'read_venue_recommendation', 'reorder_plan_stops'];
  n text; leaked text := ''; blocked text := ''; missing text := '';
  found int;
BEGIN
  FOREACH n IN ARRAY closed LOOP
    SELECT count(*) INTO found FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = n;
    IF found = 0 THEN missing := missing || n || ' '; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = n
               AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN leaked := leaked || n || ' '; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = n
                   AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN blocked := blocked || n || ' '; END IF;
  END LOOP;
  IF leaked <> '' THEN RAISE NOTICE 'still open to anon: %', leaked; END IF;
  IF blocked <> '' THEN RAISE NOTICE 'closed to signed-in users: %', blocked; END IF;
  PERFORM rep('F1 every listed function exists', missing = '');
  PERFORM rep('F2 none of them is open to signed-out callers', leaked = '');
  PERFORM rep('F3 all of them stay open to signed-in users', blocked = '');

  leaked := '';
  FOREACH n IN ARRAY stays_open LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = n
                   AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN leaked := leaked || n || ' '; END IF;
  END LOOP;
  IF leaked <> '' THEN RAISE NOTICE 'wrongly closed to anon: %', leaked; END IF;
  PERFORM rep('F4 guest RSVP, share links and device-plan helpers stay open', leaked = '');
END $$;

SELECT rep('F5 the rating summary view runs with the caller''s rights',
  coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.venue_rating_summary'::regclass), false));

SELECT rep('F6 the three functions have a fixed search path',
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('update_friendship_timestamp', 'stamp_collection_venue_added_by', 'stop_rsvp_identity')
     AND EXISTS (SELECT 1 FROM unnest(coalesce(proconfig, '{}')) c WHERE c LIKE 'search_path=%')) = 3);
