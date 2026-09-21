\set QUIET on
SET client_min_messages TO notice;

-- Two users; Carol owns a group, Dave is put in it. Both need profiles for
-- the trigger test, so create them through auth.users to exercise it.
INSERT INTO auth.users (id,email) VALUES
 ('88888888-8888-8888-8888-888888888888','carol@x.com'),
 ('99999999-9999-9999-9999-999999999999','dave@x.com')
ON CONFLICT DO NOTHING;

SET ROLE authenticated;
DO $$
DECLARE gid uuid; n int; ok boolean;
BEGIN
  -- ── the recursion bug: any read of these tables threw 42P17 ──
  PERFORM set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',true);
  PERFORM set_config('request.headers','{}',true);

  BEGIN
    PERFORM count(*) FROM friend_groups;
    PERFORM count(*) FROM friend_group_members;
    PERFORM count(*) FROM plan_invites;
    ok := true;
  EXCEPTION WHEN others THEN ok := false; RAISE NOTICE 'read failed: %', SQLERRM;
  END;
  PERFORM rep('G1 group tables readable (no recursion)', ok);

  INSERT INTO friend_groups (name, owner_id) VALUES ('Carol''s Crew', '88888888-8888-8888-8888-888888888888')
  RETURNING id INTO gid;
  PERFORM rep('G2 owner can create a group (RETURNING)', gid IS NOT NULL);

  INSERT INTO friend_group_members (group_id, user_id) VALUES (gid, '99999999-9999-9999-9999-999999999999');
  PERFORM rep('G3 owner can add a member',
    (SELECT count(*) FROM friend_group_members WHERE group_id = gid) = 1);

  -- Dave, as a member, can see the group and himself in it.
  PERFORM set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
  PERFORM rep('G4 member sees the group', (SELECT count(*) FROM friend_groups WHERE id = gid) = 1);
  PERFORM rep('G5 member sees own membership',
    (SELECT count(*) FROM friend_group_members WHERE group_id = gid) = 1);

  -- Dave cannot add people to Carol's group.
  BEGIN
    INSERT INTO friend_group_members (group_id, user_id) VALUES (gid, '88888888-8888-8888-8888-888888888888');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('G6 member cannot add others', ok);

  -- Dave can leave.
  DELETE FROM friend_group_members WHERE group_id = gid AND user_id = '99999999-9999-9999-9999-999999999999';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('G7 member can leave', n = 1);
  PERFORM rep('G8 after leaving, group is invisible',
    (SELECT count(*) FROM friend_groups WHERE id = gid) = 0);
END $$;
RESET ROLE;

-- ── profiles: every auth user has a row, including ones created out-of-band ──
DO $$
BEGIN
  PERFORM rep('P1 backfill gave existing users a profile',
    (SELECT count(*) FROM auth.users u LEFT JOIN profiles p ON p.id = u.id WHERE p.id IS NULL) = 0);
END $$;

INSERT INTO auth.users (id,email) VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','late@x.com');
DO $$
BEGIN
  PERFORM rep('P2 trigger creates a profile for a new auth user',
    (SELECT display_name FROM profiles WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') = 'late');
END $$;

SET ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',true);
  UPDATE profiles SET onboarding_completed = true WHERE id = auth.uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('P3 completeOnboarding-style UPDATE now hits a row', n = 1);
END $$;
RESET ROLE;
