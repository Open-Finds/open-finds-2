\set QUIET on
SET client_min_messages TO notice;

-- Alice owns a collection; Bob is her accepted friend; Mallory is nobody.
INSERT INTO auth.users (id,email) VALUES
 ('55555555-5555-5555-5555-555555555555','alice2@x.com'),
 ('66666666-6666-6666-6666-666666666666','bob@x.com'),
 ('77777777-7777-7777-7777-777777777777','mallory2@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES
 ('55555555-5555-5555-5555-555555555555','Alice'),
 ('66666666-6666-6666-6666-666666666666','Bob'),
 ('77777777-7777-7777-7777-777777777777','Mallory')
ON CONFLICT DO NOTHING;
INSERT INTO friendships (requester_id, addressee_id, status) VALUES
 ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','accepted');

INSERT INTO collections (id, name, user_id)
VALUES ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0','Melbourne Faves','55555555-5555-5555-5555-555555555555');

INSERT INTO saved_venues (id, name, address, type, user_id) VALUES
 ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0','Alice Cafe','1 St','food','55555555-5555-5555-5555-555555555555'),
 ('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0','Bob Bar','2 St','bar','66666666-6666-6666-6666-666666666666');
INSERT INTO collection_venues (collection_id, venue_id, added_by)
VALUES ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0','a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0','55555555-5555-5555-5555-555555555555');

-- Before sharing: Bob sees nothing.
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
  PERFORM rep('S1 unshared: friend cannot see it',
    (SELECT count(*) FROM collections WHERE id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0')=0);
END $$;

-- Mallory (not a friend) cannot be added; Bob can.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
  n := share_collection_with_users('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0',
        ARRAY['66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777']::uuid[]);
  PERFORM rep('S2 only the accepted friend is added', n=1);
  PERFORM rep('S3 non-friend not a member',
    (SELECT count(*) FROM collection_members
      WHERE collection_id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0'
        AND user_id='77777777-7777-7777-7777-777777777777')=0);
END $$;

-- Bob, now a member.
DO $$
DECLARE ok boolean; v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
  -- Notifications are owner-scoped, so this has to be checked as Bob.
  PERFORM rep('S4 member was notified',
    (SELECT count(*) FROM notifications
      WHERE user_id='66666666-6666-6666-6666-666666666666' AND type='collection_shared')=1);
  PERFORM rep('S5 member can see the collection',
    (SELECT count(*) FROM collections WHERE id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0')=1);

  -- Alice's venue is visible via the RPC but NOT in Bob's own venue list.
  v := get_collection_venues('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0');
  PERFORM rep('S6 member sees owner venue via RPC',
    jsonb_array_length(v)=1 AND v->0->>'name'='Alice Cafe');
  PERFORM rep('S7 owner venue stays out of My Venues',
    (SELECT count(*) FROM saved_venues WHERE id='a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0')=0);

  -- Bob adds his own venue.
  INSERT INTO collection_venues (collection_id, venue_id)
  VALUES ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0','b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0');
  PERFORM rep('S8 member can add own venue', true);
  PERFORM rep('S9 added_by stamped automatically',
    (SELECT added_by FROM collection_venues
      WHERE venue_id='b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0')='66666666-6666-6666-6666-666666666666');

  -- Bob cannot add Alice's venue on her behalf.
  BEGIN
    INSERT INTO collection_venues (collection_id, venue_id)
    VALUES ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0','a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('S10 cannot add someone else''s venue', ok);

  -- Bob cannot remove Alice's venue, but can remove his own.
  DELETE FROM collection_venues WHERE venue_id='a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';
  PERFORM rep('S11 member cannot remove owner venue',
    (SELECT count(*) FROM collection_venues
      WHERE venue_id='a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0')=1);

  -- Bob cannot rename or delete the collection.
  UPDATE collections SET name='Hijacked' WHERE id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';
  PERFORM rep('S12 member cannot rename',
    (SELECT name FROM collections WHERE id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0')='Melbourne Faves');

  -- Bob cannot share it onward.
  BEGIN
    PERFORM share_collection_with_users('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0',
      ARRAY['77777777-7777-7777-7777-777777777777']::uuid[]);
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('S13 member cannot share onward', ok);
END $$;

-- Owner sees both venues, including Bob's.
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
  v := get_collection_venues('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0');
  PERFORM rep('S14 owner sees member venue too', jsonb_array_length(v)=2);
  PERFORM rep('S15 member list shows Bob',
    get_collection_members('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0')->0->>'display_name'='Bob');
END $$;

-- Mallory can see none of it.
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',true);
  PERFORM rep('S16 outsider cannot see collection',
    (SELECT count(*) FROM collections WHERE id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0')=0);
  BEGIN
    PERFORM get_collection_venues('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('S17 outsider refused by RPC', ok);
END $$;

-- Bob leaves; access ends.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
  PERFORM remove_collection_member('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0','66666666-6666-6666-6666-666666666666');
  PERFORM rep('S18 member can leave',
    (SELECT count(*) FROM collections WHERE id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0')=0);
END $$;
RESET ROLE;
