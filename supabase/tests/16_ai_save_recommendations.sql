\set QUIET on
SET client_min_messages TO notice;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000016', true);
DO $$
DECLARE
  payload jsonb := '{"name":"Test Cafe","address":"1 Test St","type":"food","link":"https://www.instagram.com/reel/test/"}';
  private_id uuid;
  share_id uuid;
  denied boolean := false;
  snapshot jsonb;
BEGIN
  private_id := (save_shared_venue(payload)).id;
  PERFORM rep('AI1 retry returns same venue', (save_shared_venue(payload)).id = private_id);
  UPDATE saved_venues SET personal_note = 'Private test note' WHERE id = private_id;
  share_id := publish_venue_recommendation(private_id);
  PERFORM rep('AI2 re-publish keeps same URL', publish_venue_recommendation(private_id) = share_id);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000017', true);
  BEGIN
    PERFORM publish_venue_recommendation(private_id);
  EXCEPTION WHEN raise_exception THEN
    denied := true;
  END;
  PERFORM rep('AI3 non-owner cannot publish', denied);
  SET LOCAL ROLE anon;
  snapshot := read_venue_recommendation(share_id);
  PERFORM rep('AI4 anonymous snapshot exact fields', snapshot = payload);
  PERFORM rep('AI5 private ID is not a share ID', read_venue_recommendation(private_id) IS NULL);
  PERFORM rep('AI6 anonymous table access denied', NOT has_table_privilege('anon', 'public.venue_recommendations', 'select'));
  PERFORM rep('AI7 anonymous save denied', NOT has_function_privilege('anon', 'public.save_shared_venue(jsonb)', 'execute'));
END $$;
ROLLBACK;
