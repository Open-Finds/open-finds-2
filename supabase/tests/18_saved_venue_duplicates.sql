\set QUIET on
SET client_min_messages TO notice;

-- Stage 1 task S1-06: one saved venue per person per name and address.

-- Existing duplicates are flagged, not deleted. The migration's own flagging
-- statement is run here against crafted rows (index dropped for the test, then
-- everything rolled back).
BEGIN;
DROP INDEX public.saved_venues_one_per_venue;
-- The migration flags rows before the protective trigger exists; mirror that.
ALTER TABLE public.saved_venues DISABLE TRIGGER saved_venues_lock_legacy_flag;
INSERT INTO saved_venues (id, user_id, name, address, type, created_at) VALUES
  ('18000000-0000-0000-0000-000000000001', '18000000-0000-4000-8000-0000000000a1', 'Old Cafe', '1 Old St', 'food', now() - interval '3 days'),
  ('18000000-0000-0000-0000-000000000002', '18000000-0000-4000-8000-0000000000a1', ' old cafe ', '1 OLD st', 'food', now() - interval '2 days'),
  ('18000000-0000-0000-0000-000000000003', '18000000-0000-4000-8000-0000000000a1', 'OLD CAFE', '1 Old St', 'food', now() - interval '1 day'),
  ('18000000-0000-0000-0000-000000000004', '18000000-0000-4000-8000-0000000000a1', 'Other Cafe', '2 Old St', 'food', now());
UPDATE public.saved_venues v SET legacy_duplicate = true
FROM (SELECT id, row_number() OVER (PARTITION BY user_id, lower(btrim(name)), lower(btrim(address)) ORDER BY created_at, id) AS n
      FROM public.saved_venues) d
WHERE v.id = d.id AND d.n > 1;
SELECT rep('V1 the earliest duplicate stays unflagged',
  (SELECT NOT legacy_duplicate FROM saved_venues WHERE id = '18000000-0000-0000-0000-000000000001'));
SELECT rep('V2 later duplicates are flagged, not deleted',
  (SELECT count(*) FROM saved_venues WHERE legacy_duplicate AND user_id = '18000000-0000-4000-8000-0000000000a1') = 2);
SELECT rep('V3 a different venue is not flagged',
  (SELECT NOT legacy_duplicate FROM saved_venues WHERE id = '18000000-0000-0000-0000-000000000004'));
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-0000000000b1', true);
DO $$
DECLARE
  ok boolean;
  first_id uuid;
  a_id uuid;
  b_id uuid;
  c_id uuid;
  n int;
BEGIN
  INSERT INTO saved_venues (name, address, type) VALUES ('Dup Cafe', '5 Dup St', 'food') RETURNING id INTO first_id;

  BEGIN
    INSERT INTO saved_venues (name, address, type) VALUES (' dup CAFE ', '5 DUP st', 'food');
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  PERFORM rep('V4 the same venue cannot be saved twice', ok);

  INSERT INTO saved_venues (name, address, type) VALUES ('Dup Cafe', '6 Other St', 'food');
  PERFORM rep('V5 same name, different address is allowed', true);

  -- The flag cannot be set by the person, on insert or on update.
  BEGIN
    INSERT INTO saved_venues (name, address, type, legacy_duplicate) VALUES ('Dup Cafe', '5 Dup St', 'food', true);
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  PERFORM rep('V6 setting the flag on insert does not bypass the rule', ok);

  UPDATE saved_venues SET legacy_duplicate = true WHERE id = first_id;
  PERFORM rep('V7 the flag cannot be changed by an update',
    (SELECT NOT legacy_duplicate FROM saved_venues WHERE id = first_id));

  -- Editing a venue into a clash is refused.
  BEGIN
    UPDATE saved_venues SET address = '5 Dup St' WHERE address = '6 Other St' AND name = 'Dup Cafe';
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  PERFORM rep('V8 editing into a duplicate is refused', ok);

  -- Shared saves: same venue is idempotent, a second venue from one link is kept.
  a_id := (save_shared_venue('{"name":"Link Bar","address":"9 Link St","type":"bar","link":"https://www.instagram.com/reel/abc/"}')).id;
  PERFORM rep('V9 saving the same shared venue twice returns one row',
    (save_shared_venue('{"name":"link bar","address":"9 LINK St","type":"bar","link":"https://www.instagram.com/reel/abc/"}')).id = a_id);
  b_id := (save_shared_venue('{"name":"Second Bar","address":"10 Link St","type":"bar","link":"https://www.instagram.com/reel/abc/"}')).id;
  PERFORM rep('V10 a second venue from the same link is saved', b_id <> a_id);
  SELECT count(*) INTO n FROM saved_venues WHERE link = 'https://www.instagram.com/reel/abc/';
  PERFORM rep('V11 both venues from the link exist', n = 2);

  -- A manually saved venue is reused when the same venue is shared.
  c_id := (save_shared_venue('{"name":"Dup Cafe","address":"5 Dup St","type":"food","link":"https://www.instagram.com/reel/xyz/"}')).id;
  PERFORM rep('V12 a shared save finds the manually saved venue', c_id = first_id);

  -- Another person can save the same venue.
  PERFORM set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-0000000000b2', true);
  INSERT INTO saved_venues (name, address, type) VALUES ('Dup Cafe', '5 Dup St', 'food');
  PERFORM rep('V13 another person can save the same venue', true);
END $$;
ROLLBACK;
