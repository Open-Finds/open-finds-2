\set QUIET on
SET client_min_messages TO notice;

INSERT INTO auth.users (id, email) VALUES
  ('14141414-0000-0000-0000-000000000001', 'me@x.com'),
  ('14141414-0000-0000-0000-000000000002', 'friend@x.com'),
  ('14141414-0000-0000-0000-000000000003', 'stranger@x.com'),
  ('14141414-0000-0000-0000-000000000004', 'groupie@x.com')
ON CONFLICT DO NOTHING;

INSERT INTO profiles (id, display_name, username) VALUES
  ('14141414-0000-0000-0000-000000000001', 'Me', 'me_user'),
  ('14141414-0000-0000-0000-000000000002', 'Friend', 'FriendUser'),
  ('14141414-0000-0000-0000-000000000003', 'Stranger', 'stranger'),
  ('14141414-0000-0000-0000-000000000004', 'Groupie', 'groupie')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.username;

INSERT INTO friendships (requester_id, addressee_id, status) VALUES
  ('14141414-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000002', 'accepted');

INSERT INTO friend_groups (id, name, owner_id) VALUES
  ('14141414-1111-0000-0000-000000000001', 'Crew', '14141414-0000-0000-0000-000000000004');
INSERT INTO friend_group_members (group_id, user_id) VALUES
  ('14141414-1111-0000-0000-000000000001', '14141414-0000-0000-0000-000000000001');

DO $$
DECLARE n int; name text;
BEGIN
  -- Signed out: nothing.
  SELECT count(*) INTO n FROM find_profile_by_username('stranger');
  PERFORM rep('L1 signed-out search finds nobody', n = 0);

  PERFORM set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT display_name INTO name FROM find_profile_by_username('stranger');
  PERFORM rep('L2 search finds another user by username', name = 'Stranger');

  SELECT display_name INTO name FROM find_profile_by_username('  @frienduser ');
  PERFORM rep('L3 search ignores case, spaces and a leading @', name = 'Friend');

  SELECT count(*) INTO n FROM find_profile_by_username('stran');
  PERFORM rep('L4 search needs the whole username', n = 0);

  SELECT count(*) INTO n FROM find_profile_by_username('%');
  PERFORM rep('L5 wildcards do not list users', n = 0);

  SELECT count(*) INTO n FROM get_public_profiles(ARRAY[
    '14141414-0000-0000-0000-000000000002',
    '14141414-0000-0000-0000-000000000003',
    '14141414-0000-0000-0000-000000000004']::uuid[]) g
  WHERE g.id = '14141414-0000-0000-0000-000000000002';
  PERFORM rep('L6 friend''s name is visible', n = 1);

  SELECT count(*) INTO n FROM get_public_profiles(ARRAY['14141414-0000-0000-0000-000000000004']::uuid[]);
  PERFORM rep('L7 group owner''s name is visible to a member', n = 1);

  SELECT count(*) INTO n FROM get_public_profiles(ARRAY['14141414-0000-0000-0000-000000000003']::uuid[]);
  PERFORM rep('L8 stranger''s name stays hidden', n = 0);
END $$;

-- search_profiles: partial matches as you type.
INSERT INTO auth.users (id, email) VALUES
  ('14141414-0000-0000-0000-000000000005', 'frieda@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name, username) VALUES
  ('14141414-0000-0000-0000-000000000005', 'Old Friend', 'frieda')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.username;

DO $$
DECLARE n int; first text; names text;
BEGIN
  SELECT count(*) INTO n FROM search_profiles('fri');
  PERFORM rep('Q1 signed-out partial search finds nobody', n = 0);

  PERFORM set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT string_agg(username, ',') INTO names FROM search_profiles('FRI');
  PERFORM rep('Q2 prefix finds every match, any case', names LIKE '%FriendUser%' AND names LIKE '%frieda%');

  SELECT username INTO first FROM search_profiles('frieda') LIMIT 1;
  PERFORM rep('Q3 exact username ranks first', first = 'frieda');

  SELECT count(*) INTO n FROM search_profiles('ange') WHERE username = 'stranger';
  PERFORM rep('Q4 text inside a username matches', n = 1);

  SELECT count(*) INTO n FROM search_profiles('old fr') WHERE username = 'frieda';
  PERFORM rep('Q5 display name matches too', n = 1);

  SELECT count(*) INTO n FROM search_profiles('%');
  PERFORM rep('Q6 % is literal, not a wildcard', n = 0);

  SELECT count(*) INTO n FROM search_profiles('   ');
  PERFORM rep('Q7 blank search returns nothing', n = 0);
END $$;
