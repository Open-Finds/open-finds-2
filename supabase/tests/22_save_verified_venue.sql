\set QUIET on
SET client_min_messages TO notice;

-- Universal venues, Phase 2 (20261124120000): the server-only save of a
-- Google-confirmed venue, and the address-edit rule on links.

BEGIN;
DO $$
DECLARE
  a uuid := '22000000-0000-4000-8000-0000000000a1';
  b uuid := '22000000-0000-4000-8000-0000000000b1';
  place jsonb := '{"google_place_id":"ChIJ22chatswood01","name":"Chatime","address":"1 Victoria Ave, Chatswood NSW 2067, Australia","suburb":"Chatswood","lat":-33.79,"lon":151.18,"category":"cafe"}';
  first_save public.saved_venues;
  again public.saved_venues;
  other public.saved_venues;
  old_id uuid;
  ok boolean;
BEGIN
  first_save := public.save_verified_venue(a, place, '{"type":"food","link":"https://www.instagram.com/reel/abc"}');
  PERFORM rep('W1 a verified save is linked', first_save.venue_id IS NOT NULL);
  PERFORM rep('W2 the shared venue is created once',
    (SELECT count(*) FROM venues WHERE google_place_id = 'ChIJ22chatswood01') = 1
    AND (SELECT verification = 'google_verified' AND suburb = 'Chatswood' AND category = 'cafe'
         FROM venues WHERE id = first_save.venue_id));
  PERFORM rep('W3 the save keeps the source link', first_save.link = 'https://www.instagram.com/reel/abc');

  again := public.save_verified_venue(a, place, '{"type":"food"}');
  PERFORM rep('W4 saving again returns the same save',
    again.id = first_save.id AND (SELECT count(*) FROM saved_venues WHERE user_id = a::text) = 1);

  other := public.save_verified_venue(b, place, '{"type":"food"}');
  PERFORM rep('W5 another person reuses the venue',
    other.id <> first_save.id AND other.venue_id = first_save.venue_id
    AND (SELECT count(*) FROM venues WHERE google_place_id = 'ChIJ22chatswood01') = 1);

  -- An older unlinked save of the same name and address is linked, not duplicated.
  INSERT INTO saved_venues (id, user_id, name, address, type, personal_note)
    VALUES ('22000000-0000-0000-0000-0000000000c1', '22000000-0000-4000-8000-0000000000c1',
            'chatime', '1 victoria ave, chatswood nsw 2067, australia', 'food', 'my note')
    RETURNING id INTO old_id;
  again := public.save_verified_venue('22000000-0000-4000-8000-0000000000c1', place, '{}');
  PERFORM rep('W6 an older matching save is linked',
    again.id = old_id AND again.venue_id = first_save.venue_id AND again.personal_note = 'my note');

  -- Google's latest details refresh the venue; the first category stays.
  again := public.save_verified_venue(b, place || '{"name":"Chatime Chatswood","category":"food","suburb":null}', '{}');
  PERFORM rep('W7 venue details follow Google',
    (SELECT name = 'Chatime Chatswood' AND category = 'cafe' AND suburb = 'Chatswood' FROM venues WHERE id = first_save.venue_id));
  PERFORM rep('W8 a renamed venue is still one save',
    again.id = other.id AND (SELECT count(*) FROM saved_venues WHERE user_id = b::text) = 1);

  -- A missing or bad type falls back from the category.
  again := public.save_verified_venue(a, place || '{"google_place_id":"ChIJ22nightclub01","name":"Club","address":"2 Club St, Sydney NSW 2000","category":"nightlife"}', '{"type":"nonsense","link":"http://insecure"}');
  PERFORM rep('W9 type and link are cleaned', again.type = 'bar' AND again.link IS NULL);

  -- The person's own save keeps the text they were shown; the shared venue keeps Google's.
  again := public.save_verified_venue('22000000-0000-4000-8000-0000000000d1',
    place || '{"google_place_id":"ChIJ22tokyo00001","name":"Cafe Tokyo","address":"１-２ Ginza, Tokyo"}',
    '{"name":"Cafe Tokyo","address":"1-2 Ginza, Tokyo"}');
  PERFORM rep('W17 save text is personal, venue is Google''s',
    again.address = '1-2 Ginza, Tokyo'
    AND (SELECT address = '１-２ Ginza, Tokyo' FROM venues WHERE id = again.venue_id));

  BEGIN
    PERFORM public.save_verified_venue(a, place || '{"category":"nature"}', '{}');
    ok := false;
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  PERFORM rep('W10 bad venue details are refused', ok);

  BEGIN
    PERFORM public.save_verified_venue(a, place - 'lat', '{}');
    ok := false;
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  PERFORM rep('W11 a venue needs coordinates', ok);
END $$;

-- The app cannot call it, signed in or not.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-0000000000a1', true);
DO $$
DECLARE ok boolean; mine uuid;
BEGIN
  BEGIN
    PERFORM public.save_verified_venue('22000000-0000-4000-8000-0000000000a1',
      '{"google_place_id":"ChIJ22forged0001","name":"Forged","address":"1 Fake St","lat":0,"lon":0,"category":"food"}', '{}');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM rep('W12 signed-in users cannot call it', ok);

  -- Renaming keeps the link; changing the address clears it.
  SELECT id INTO mine FROM saved_venues WHERE venue_id IS NOT NULL AND type = 'food' LIMIT 1;
  UPDATE saved_venues SET name = 'My Chatime' WHERE id = mine;
  PERFORM rep('W13 renaming a save keeps its link', (SELECT venue_id IS NOT NULL FROM saved_venues WHERE id = mine));
  UPDATE saved_venues SET address = '9 Somewhere Else St' WHERE id = mine;
  PERFORM rep('W14 a new address clears the link', (SELECT venue_id IS NULL FROM saved_venues WHERE id = mine));
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    PERFORM public.save_verified_venue('22000000-0000-4000-8000-0000000000a1',
      '{"google_place_id":"ChIJ22forged0001","name":"Forged","address":"1 Fake St","lat":0,"lon":0,"category":"food"}', '{}');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM rep('W15 signed-out users cannot call it', ok);
END $$;
RESET ROLE;

SELECT rep('W16 only the server role may run it',
  has_function_privilege('service_role', 'public.save_verified_venue(uuid, jsonb, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.save_verified_venue(uuid, jsonb, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.save_verified_venue(uuid, jsonb, jsonb)', 'EXECUTE'));
ROLLBACK;
