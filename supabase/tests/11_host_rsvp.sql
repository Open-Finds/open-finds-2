\set QUIET on
SET client_min_messages TO notice;

INSERT INTO auth.users (id, email) VALUES
  ('11111111-2222-3333-4444-555555555555', 'host@x.com')
ON CONFLICT DO NOTHING;
UPDATE profiles SET display_name = 'Robert' WHERE id = '11111111-2222-3333-4444-555555555555';

INSERT INTO trips (id, name, destination, start_date, num_days, host_name, user_id, owner_id)
VALUES ('11111111-0000-0000-0000-00000000aaaa', 'Trip', 'Sydney', CURRENT_DATE + 9, 2, 'Robert', 'host-device', '11111111-2222-3333-4444-555555555555');

-- A night, a trip day, and an anonymous (pre-account) plan.
INSERT INTO plans (id, title, date, host_name, location, type, status, user_id, owner_id, trip_id)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'Night', CURRENT_DATE + 7, 'You', 'Sydney', 'food', 'active', 'host-device', '11111111-2222-3333-4444-555555555555', NULL),
  ('11111111-0000-0000-0000-000000000002', 'Day 1', CURRENT_DATE + 9, 'Robert', 'Sydney', 'food', 'active', 'host-device', '11111111-2222-3333-4444-555555555555', '11111111-0000-0000-0000-00000000aaaa'),
  ('11111111-0000-0000-0000-000000000003', 'Anon', CURRENT_DATE + 8, 'Anon', 'Sydney', 'food', 'active', 'anon-device', NULL, NULL);

DO $$
DECLARE r rsvps%ROWTYPE; shared jsonb; ok boolean;
BEGIN
  SELECT * INTO r FROM rsvps WHERE plan_id = '11111111-0000-0000-0000-000000000001';
  PERFORM rep('H1 a new night lists its host as In', r.is_host AND r.status = 'in');
  PERFORM rep('H2 the host row uses the profile name, not "You"', r.name = 'Robert');
  PERFORM rep('H3 the host row is tied to the host account', r.auth_uid = '11111111-2222-3333-4444-555555555555');

  PERFORM rep('H4 trip days get no host row',
    NOT EXISTS (SELECT 1 FROM rsvps WHERE plan_id = '11111111-0000-0000-0000-000000000002'));
  PERFORM rep('H5 plans without an account get no host row',
    NOT EXISTS (SELECT 1 FROM rsvps WHERE plan_id = '11111111-0000-0000-0000-000000000003'));

  BEGIN
    INSERT INTO rsvps (plan_id, name, status, user_id, is_host)
    VALUES ('11111111-0000-0000-0000-000000000001', 'Other', 'in', 'host-device', true);
    ok := false;
  EXCEPTION WHEN unique_violation THEN
    ok := true;
  END;
  PERFORM rep('H6 a plan has at most one host row', ok);

  -- A guest answers; the shared view marks the host and lists them first.
  PERFORM submit_plan_rsvp('11111111-0000-0000-0000-000000000001', 'Guest', 'in', NULL);
  shared := get_shared_plan('11111111-0000-0000-0000-000000000001');
  PERFORM rep('H7 guests see which response is the host''s',
    (shared->'rsvps'->0->>'is_host')::boolean AND (shared->'rsvps'->0->>'name') = 'Robert'
    AND NOT (shared->'rsvps'->1->>'is_host')::boolean);
  PERFORM rep('H8 guest RSVPs are never marked host',
    NOT (SELECT is_host FROM rsvps WHERE plan_id = '11111111-0000-0000-0000-000000000001' AND name = 'Guest'));
END $$;
