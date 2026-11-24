\set QUIET on
SET client_min_messages TO notice;

-- Universal venues, Phase 1 (20261123120000): shared venue records, the
-- personal link from saved_venues, and who may read or write them.

-- Shape and identity rules, run as the owner (trusted code).
BEGIN;
DO $$
DECLARE ok boolean;
BEGIN
  INSERT INTO venues (id, google_place_id, name, address, suburb, lat, lon, category, verification, verified_at) VALUES
    ('21000000-0000-0000-0000-0000000000c1', 'ChIJchatime_chatswood', 'Chatime', '1 Victoria Ave, Chatswood NSW 2067', 'Chatswood', -33.79, 151.18, 'cafe', 'google_verified', now()),
    ('21000000-0000-0000-0000-0000000000c2', 'ChIJchatime_burwood_1', 'Chatime', '2 Burwood Rd, Burwood NSW 2134', 'Burwood', -33.87, 151.10, 'cafe', 'google_verified', now());
  PERFORM rep('U1 two branches are separate venues', (SELECT count(*) FROM venues WHERE name = 'Chatime') = 2);

  BEGIN
    INSERT INTO venues (google_place_id, name, address, category) VALUES ('ChIJchatime_chatswood', 'Chatime copy', '1 Victoria Ave', 'cafe');
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  PERFORM rep('U2 a Google place is stored once', ok);

  -- Regression: the place id rule once used a regex repeat over 255, which made
  -- every insert with a place id fail.
  INSERT INTO venues (google_place_id, name, address, category)
    VALUES (repeat('A', 300), 'Long id', '1 Long St', 'food');
  PERFORM rep('U20 a 300-character place id is valid', true);

  BEGIN
    INSERT INTO venues (google_place_id, name, address, category) VALUES ('bad id with spaces', 'Bad', '1 St', 'food');
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  PERFORM rep('U21 malformed place ids are refused', ok);

  BEGIN
    INSERT INTO venues (name, address, category) VALUES ('Bad', '1 St', 'nature');
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  PERFORM rep('U3 only the seven categories', ok);

  BEGIN
    INSERT INTO venues (name, address, category, verification, verified_at) VALUES ('Bad', '1 St', 'food', 'google_verified', now());
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  PERFORM rep('U4 verified needs a Google place id', ok);

  BEGIN
    INSERT INTO venues (name, address, category, lat) VALUES ('Bad', '1 St', 'food', -33.8);
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  PERFORM rep('U5 coordinates come in pairs', ok);

  UPDATE venues SET updated_at = '2000-01-01' WHERE id = '21000000-0000-0000-0000-0000000000c1';
  PERFORM rep('U6 updated_at is maintained',
    (SELECT updated_at > '2001-01-01' FROM venues WHERE id = '21000000-0000-0000-0000-0000000000c1'));

  -- Many people can save one venue; one person cannot save it twice.
  INSERT INTO saved_venues (id, user_id, name, address, type, venue_id) VALUES
    ('21000000-0000-0000-0000-0000000000a1', '21000000-0000-4000-8000-0000000000a1', 'Chatime', '1 Victoria Ave, Chatswood', 'food', '21000000-0000-0000-0000-0000000000c1'),
    ('21000000-0000-0000-0000-0000000000b1', '21000000-0000-4000-8000-0000000000b1', 'Chatime Chatswood', '1 Victoria Avenue Chatswood', 'food', '21000000-0000-0000-0000-0000000000c1');
  PERFORM rep('U7 two people save the same venue',
    (SELECT count(*) FROM saved_venues WHERE venue_id = '21000000-0000-0000-0000-0000000000c1') = 2);

  BEGIN
    INSERT INTO saved_venues (user_id, name, address, type, venue_id) VALUES
      ('21000000-0000-4000-8000-0000000000a1', 'Chatime (again)', 'Victoria Ave', 'food', '21000000-0000-0000-0000-0000000000c1');
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  PERFORM rep('U8 one save per person per venue', ok);

  INSERT INTO saved_venues (user_id, name, address, type, venue_id) VALUES
    ('21000000-0000-4000-8000-0000000000a1', 'Chatime', '2 Burwood Rd, Burwood', 'food', '21000000-0000-0000-0000-0000000000c2');
  PERFORM rep('U9 same person, other branch allowed', true);

  INSERT INTO saved_venues (user_id, name, address, type) VALUES
    ('21000000-0000-4000-8000-0000000000a1', 'Unlinked Cafe', '9 Some St', 'food'),
    ('21000000-0000-4000-8000-0000000000a1', 'Unlinked Bar', '10 Some St', 'bar');
  PERFORM rep('U10 unlinked saves are unaffected', true);

  -- Removing a venue never removes anyone's save.
  DELETE FROM venues WHERE id = '21000000-0000-0000-0000-0000000000c2';
  PERFORM rep('U11 venue delete keeps the save',
    (SELECT venue_id IS NULL FROM saved_venues WHERE name = 'Chatime' AND address = '2 Burwood Rd, Burwood'));
END $$;

-- Signed in as person A: read venues, but never write them or link a save.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-0000000000a1', true);
DO $$
DECLARE ok boolean; new_id uuid;
BEGIN
  PERFORM rep('U12 signed-in users can read venues', (SELECT count(*) FROM venues) >= 1);

  BEGIN
    INSERT INTO venues (name, address, category) VALUES ('Mine', '1 St', 'food');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM rep('U13 users cannot create venues', ok);

  -- 01_write_policies grants every table to the API roles, so these check what
  -- actually happens (RLS has no write policy), not the migration's REVOKE.
  BEGIN
    UPDATE venues SET name = 'Hijacked' WHERE id = '21000000-0000-0000-0000-0000000000c1';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM rep('U14 users cannot edit venues',
    (SELECT name = 'Chatime' FROM venues WHERE id = '21000000-0000-0000-0000-0000000000c1'));

  BEGIN
    DELETE FROM venues WHERE id = '21000000-0000-0000-0000-0000000000c1';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM rep('U15 users cannot delete venues',
    EXISTS (SELECT 1 FROM venues WHERE id = '21000000-0000-0000-0000-0000000000c1'));

  INSERT INTO saved_venues (name, address, type, venue_id)
    VALUES ('Sneaky', '3 Sneaky St', 'food', '21000000-0000-0000-0000-0000000000c1') RETURNING id INTO new_id;
  PERFORM rep('U16 a new save cannot set its link',
    (SELECT venue_id IS NULL FROM saved_venues WHERE id = new_id));

  UPDATE saved_venues SET venue_id = NULL, personal_note = 'still mine'
    WHERE id = '21000000-0000-0000-0000-0000000000a1';
  PERFORM rep('U17 a save cannot change its link',
    (SELECT venue_id = '21000000-0000-0000-0000-0000000000c1' AND personal_note = 'still mine'
       FROM saved_venues WHERE id = '21000000-0000-0000-0000-0000000000a1'));

  PERFORM rep('U18 another person''s save stays hidden',
    NOT EXISTS (SELECT 1 FROM saved_venues WHERE id = '21000000-0000-0000-0000-0000000000b1'));
END $$;
RESET ROLE;

-- Signed out: no access at all.
SET LOCAL ROLE anon;
DO $$
DECLARE seen bigint := 0;
BEGIN
  BEGIN
    SELECT count(*) INTO seen FROM venues;
  EXCEPTION WHEN insufficient_privilege THEN seen := 0; END;
  PERFORM rep('U19 signed-out users cannot read', seen = 0);
END $$;
RESET ROLE;
ROLLBACK;
