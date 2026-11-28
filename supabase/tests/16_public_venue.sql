\set QUIET on
SET client_min_messages TO notice;

INSERT INTO auth.users (id, email) VALUES
  ('16161616-0000-0000-0000-000000000001', 'owner@x.com'),
  ('16161616-0000-0000-0000-000000000002', 'visitor@x.com')
ON CONFLICT DO NOTHING;

INSERT INTO saved_venues (id, name, address, type, link, user_id, tags, personal_note, rating, visited, photo_url) VALUES
  ('16161616-1111-0000-0000-000000000001', 'Hercules Cafe', '12 Liverpool Rd, Ashfield NSW 2131', 'food',
   'https://instagram.com/reel/x', '16161616-0000-0000-0000-000000000001',
   ARRAY['attribute:casual', 'Favourite', 'date with Sam'], 'secret note', 5, true, 'https://photo');

DO $$
DECLARE r record; n int;
BEGIN
  -- Signed out (anon).
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO r FROM get_public_venue('16161616-1111-0000-0000-000000000001');
  PERFORM rep('V1 signed-out visitor sees the venue', r.name = 'Hercules Cafe' AND r.photo_url = 'https://photo');
  PERFORM rep('V2 only structured tags are public', r.tags = ARRAY['attribute:casual']);
  PERFORM rep('V3 signed-out visitor is not the owner', r.is_mine = false);

  SELECT count(*) INTO n FROM get_public_venue('16161616-1111-0000-0000-000000000009');
  PERFORM rep('V4 unknown id returns nothing', n = 0);

  -- Another signed-in user.
  PERFORM set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SELECT * INTO r FROM get_public_venue('16161616-1111-0000-0000-000000000001');
  PERFORM rep('V5 another user sees it, not as theirs', r.name = 'Hercules Cafe' AND r.is_mine = false);

  -- The owner.
  PERFORM set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000001', true);
  SELECT * INTO r FROM get_public_venue('16161616-1111-0000-0000-000000000001');
  PERFORM rep('V6 the owner is told it is theirs', r.is_mine = true);
END $$;

-- Nothing personal is even in the result's shape.
SELECT rep('V7 no personal columns are returned', NOT EXISTS (
  SELECT 1 FROM information_schema.routines rt
  JOIN information_schema.parameters p ON p.specific_name = rt.specific_name
  WHERE rt.routine_name = 'get_public_venue' AND p.parameter_mode = 'OUT'
    AND p.parameter_name IN ('user_id', 'personal_note', 'rating', 'visited', 'collection')));

SELECT rep('V8 anon may call it', has_function_privilege('anon', 'get_public_venue(uuid)', 'EXECUTE'));
