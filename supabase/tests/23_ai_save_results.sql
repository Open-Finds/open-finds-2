\set QUIET on
SET client_min_messages TO notice;

-- AI Save results: one row per attempt, own rows only, admin can read all, no anon, limits hold.
INSERT INTO auth.users (id, email) VALUES
  ('23000000-0000-0000-0000-00000000000a', 'ada-results@x.com'),
  ('23000000-0000-0000-0000-00000000000b', 'uma-results@x.com'),
  ('23000000-0000-0000-0000-00000000000c', 'vic-results@x.com'),
  ('23000000-0000-0000-0000-00000000000d', 'cap-results@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES
  ('23000000-0000-0000-0000-00000000000a', 'Ada'),
  ('23000000-0000-0000-0000-00000000000b', 'Uma'),
  ('23000000-0000-0000-0000-00000000000c', 'Vic'),
  ('23000000-0000-0000-0000-00000000000d', 'Cap')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET role = 'admin' WHERE id = '23000000-0000-0000-0000-00000000000a';

SET ROLE authenticated;

DO $$
DECLARE
  ada uuid := '23000000-0000-0000-0000-00000000000a';
  uma uuid := '23000000-0000-0000-0000-00000000000b';
  vic uuid := '23000000-0000-0000-0000-00000000000c';
  a1 uuid := 'a1000000-0000-0000-0000-000000000001';
  a2 uuid := 'a1000000-0000-0000-0000-000000000002';
  n int; ok boolean; r record;
BEGIN
  -- Uma saves a result, then rates it by writing the same attempt again.
  PERFORM set_config('request.jwt.claim.sub', uma::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO ai_save_results (user_id, attempt_id, platform, post_kind, link, outcome, found_by, venue_name, edited)
    VALUES (uma, a1, 'tiktok', 'video', 'https://vt.tiktok.com/ZSx/', 'confirmed', 'shared_text', 'Ocean Royale', false);
  INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome, rating)
    VALUES (uma, a1, 'tiktok', 'confirmed', 'like')
    ON CONFLICT (user_id, attempt_id) DO UPDATE SET rating = EXCLUDED.rating;
  SELECT count(*) INTO n FROM ai_save_results WHERE user_id = uma;
  SELECT * INTO r FROM ai_save_results WHERE attempt_id = a1;
  PERFORM rep('R1 a result is written once and rated by writing the same attempt again',
    n = 1 AND r.rating = 'like' AND r.venue_name = 'Ocean Royale' AND r.found_by = 'shared_text');

  -- A 👎 can carry a reason and a note; the rating can be changed.
  UPDATE ai_save_results SET rating = 'dislike', reason = 'wrong_venue', note = 'It saved Oyama Ramen' WHERE attempt_id = a1;
  SELECT * INTO r FROM ai_save_results WHERE attempt_id = a1;
  PERFORM rep('R2 a thumbs down takes a reason and a note, and replaces the thumbs up',
    r.rating = 'dislike' AND r.reason = 'wrong_venue' AND r.note = 'It saved Oyama Ramen');

  -- Cannot write a row for someone else.
  ok := false;
  BEGIN
    INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome) VALUES (vic, a2, 'tiktok', 'confirmed');
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R3 a person cannot write a result for another person', ok);

  -- The reason needs a thumbs down; the note is capped; the platform and outcome are fixed lists.
  ok := false;
  BEGIN
    INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome, rating, reason) VALUES (uma, a2, 'tiktok', 'confirmed', 'like', 'wrong_venue');
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R4 a reason is refused without a thumbs down', ok);
  ok := false;
  BEGIN
    INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome, rating, note) VALUES (uma, a2, 'tiktok', 'confirmed', 'dislike', repeat('x', 201));
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R5 a note over 200 characters is refused', ok);
  ok := false;
  BEGIN
    INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome) VALUES (uma, a2, 'myspace', 'confirmed');
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R6 an unknown platform is refused', ok);
  ok := false;
  BEGIN
    INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome) VALUES (uma, a2, 'tiktok', 'magic');
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R7 an unknown outcome is refused', ok);

  -- Who and when cannot be changed by an update.
  UPDATE ai_save_results SET user_id = vic, created_at = '2000-01-01' WHERE attempt_id = a1;
  SELECT * INTO r FROM ai_save_results WHERE attempt_id = a1;
  PERFORM rep('R8 an update cannot change the owner or the created time', r.user_id = uma AND r.created_at > '2020-01-01');

  -- Vic sees none of Uma's rows and cannot change them.
  PERFORM set_config('request.jwt.claim.sub', vic::text, true);
  SELECT count(*) INTO n FROM ai_save_results;
  PERFORM rep('R9 another person sees none of those rows', n = 0);
  UPDATE ai_save_results SET rating = 'like' WHERE attempt_id = a1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('R10 another person cannot update those rows', n = 0);
  DELETE FROM ai_save_results WHERE attempt_id = a1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('R11 nobody can delete a result from the app', n = 0);

  -- The admin reads every row.
  PERFORM set_config('request.jwt.claim.sub', ada::text, true);
  SELECT count(*) INTO n FROM ai_save_results;
  PERFORM rep('R12 an admin can read every result', n = 1);
END $$;

-- The daily cap: 300 new rows per person, then refused.
DO $$
DECLARE cap uuid := '23000000-0000-0000-0000-00000000000d'; ok boolean := false; n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', cap::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome)
    SELECT cap, gen_random_uuid(), 'tiktok', 'confirmed' FROM generate_series(1, 300);
  BEGIN
    INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome) VALUES (cap, gen_random_uuid(), 'tiktok', 'confirmed');
  EXCEPTION WHEN others THEN ok := true; END;
  SELECT count(*) INTO n FROM ai_save_results WHERE user_id = cap;
  PERFORM rep('R13 the 301st result in a day is refused', ok AND n = 300);
END $$;

RESET ROLE;

-- Signed out: nothing at all.
SET ROLE anon;
DO $$
DECLARE ok boolean := false;
BEGIN
  DECLARE seen int := 0;
  BEGIN
    -- Either refused outright (no grant) or empty (the shared CI grants plus row security): nothing is visible.
    BEGIN
      SELECT count(*) INTO seen FROM ai_save_results;
    EXCEPTION WHEN others THEN seen := 0; END;
    ok := seen = 0;
  END;
  PERFORM rep('R14 a signed-out visitor cannot see results', ok);
  ok := false;
  BEGIN
    INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome)
      VALUES ('23000000-0000-0000-0000-00000000000b', gen_random_uuid(), 'tiktok', 'confirmed');
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R15 a signed-out visitor cannot write results', ok);
END $$;
RESET ROLE;

-- The result outlives the saved venue it points to, and goes with the account.
DO $$
DECLARE v uuid := gen_random_uuid(); u uuid := '23000000-0000-0000-0000-00000000000c'; n int;
BEGIN
  INSERT INTO saved_venues (id, user_id, name, address, type) VALUES (v, u::text, 'Temp Cafe', '1 Test St', 'food');
  INSERT INTO ai_save_results (user_id, attempt_id, platform, outcome, saved_venue_id) VALUES (u, gen_random_uuid(), 'website', 'manual', v);
  DELETE FROM saved_venues WHERE id = v;
  SELECT count(*) INTO n FROM ai_save_results WHERE user_id = u AND saved_venue_id IS NULL;
  PERFORM rep('R16 deleting the saved venue keeps the result', n = 1);
  DELETE FROM auth.users WHERE id = u;
  SELECT count(*) INTO n FROM ai_save_results WHERE user_id = u;
  PERFORM rep('R17 deleting the account removes its results', n = 0);
END $$;

-- Table rights (signed-in users get only read, add and update; no delete or truncate) are set by
-- 20261125120100_ai_save_results_grants.sql. They cannot be asserted here: 01_write_policies grants every table
-- to anon and authenticated for the shared CI suites, so they were checked on the staging project instead.
