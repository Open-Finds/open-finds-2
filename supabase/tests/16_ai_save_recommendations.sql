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
  hidden boolean;
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
  -- The shared CI fixture grants table privileges to exercise RLS.
  -- Check the actual visibility of the known row even under those grants.
  BEGIN
    SELECT NOT EXISTS (SELECT 1 FROM public.venue_recommendations WHERE id = share_id) INTO hidden;
  EXCEPTION WHEN insufficient_privilege THEN
    hidden := true;
  END;
  PERFORM rep('AI6 anonymous direct row is hidden', hidden);
  PERFORM rep('AI7 anonymous save denied', NOT has_function_privilege('anon', 'public.save_shared_venue(jsonb)', 'execute'));
END $$;
ROLLBACK;
