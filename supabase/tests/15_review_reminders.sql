\set QUIET on
SET client_min_messages TO notice;

-- Host Hal, guests Gia (in), Gus (declined), Guy (in, no account), and venue owner Ola.
INSERT INTO auth.users (id, email) VALUES
  ('15000000-0000-0000-0000-00000000000a', 'hal@x.com'),
  ('15000000-0000-0000-0000-00000000000b', 'gia@x.com'),
  ('15000000-0000-0000-0000-00000000000c', 'gus@x.com'),
  ('15000000-0000-0000-0000-00000000000d', 'ola@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES
  ('15000000-0000-0000-0000-00000000000a', 'Hal'), ('15000000-0000-0000-0000-00000000000b', 'Gia'),
  ('15000000-0000-0000-0000-00000000000c', 'Gus'), ('15000000-0000-0000-0000-00000000000d', 'Ola')
ON CONFLICT (id) DO NOTHING;

INSERT INTO venue_partners (id, owner_id, business_name, address, type, contact_name, contact_email, approved)
VALUES ('15000000-0000-0000-0000-0000000000f1', '15000000-0000-0000-0000-00000000000d', 'Sponsored Ramen', '1 St', 'food', 'O', 'o@x.com', true);

-- Yesterday, a night with the sponsored venue (matched by name) and another stop.
INSERT INTO plans (id, title, date, host_name, location, user_id, owner_id)
VALUES ('15000000-0000-0000-0000-0000000000e1', 'Ramen night', (now() AT TIME ZONE 'Australia/Sydney')::date - 1, 'Hal', 'Sydney', 'dev', '15000000-0000-0000-0000-00000000000a');
INSERT INTO stops (plan_id, name, address, time, sort_order, user_id) VALUES
  ('15000000-0000-0000-0000-0000000000e1', 'sponsored ramen ', '1 St', '18:00', 0, 'dev'),
  ('15000000-0000-0000-0000-0000000000e1', 'Some Bar', '2 St', '20:00', 1, 'dev');
INSERT INTO rsvps (plan_id, name, status, auth_uid) VALUES
  ('15000000-0000-0000-0000-0000000000e1', 'Gia', 'in', '15000000-0000-0000-0000-00000000000b'),
  ('15000000-0000-0000-0000-0000000000e1', 'Gus', 'declined', '15000000-0000-0000-0000-00000000000c'),
  ('15000000-0000-0000-0000-0000000000e1', 'Guy', 'in', NULL),
  ('15000000-0000-0000-0000-0000000000e1', 'Ola', 'in', '15000000-0000-0000-0000-00000000000d');

-- Yesterday too, but no sponsored venue on it.
INSERT INTO plans (id, title, date, host_name, location, user_id, owner_id)
VALUES ('15000000-0000-0000-0000-0000000000e2', 'Plain night', (now() AT TIME ZONE 'Australia/Sydney')::date - 1, 'Hal', 'Sydney', 'dev', '15000000-0000-0000-0000-00000000000a');
INSERT INTO stops (plan_id, name, address, time, sort_order, user_id) VALUES ('15000000-0000-0000-0000-0000000000e2', 'Some Cafe', '3 St', '12:00', 0, 'dev');

-- Tomorrow: not over yet.
INSERT INTO plans (id, title, date, host_name, location, user_id, owner_id)
VALUES ('15000000-0000-0000-0000-0000000000e3', 'Future night', (now() AT TIME ZONE 'Australia/Sydney')::date + 1, 'Hal', 'Sydney', 'dev', '15000000-0000-0000-0000-00000000000a');
INSERT INTO stops (plan_id, name, address, time, sort_order, user_id, venue_partner_id) VALUES ('15000000-0000-0000-0000-0000000000e3', 'Renamed stop', '1 St', '18:00', 0, 'dev', '15000000-0000-0000-0000-0000000000f1');

DO $$
DECLARE who text;
BEGIN
  SELECT string_agg(user_id::text, ',' ORDER BY user_id) INTO who FROM due_review_reminders(true) WHERE plan_id = '15000000-0000-0000-0000-0000000000e1';
  PERFORM rep('V1 the host and signed-in guests who went are reminded, not decliners or the venue owner',
    who = '15000000-0000-0000-0000-00000000000a,15000000-0000-0000-0000-00000000000b');
  PERFORM rep('V2 it names the sponsored venue to review',
    (SELECT venue_names FROM due_review_reminders(true) WHERE plan_id = '15000000-0000-0000-0000-0000000000e1' LIMIT 1) = ARRAY['Sponsored Ramen']);
  PERFORM rep('V3 no reminder for an event without a sponsored venue, or one not over yet',
    NOT EXISTS (SELECT 1 FROM due_review_reminders(true) WHERE plan_id IN ('15000000-0000-0000-0000-0000000000e2', '15000000-0000-0000-0000-0000000000e3')));

  INSERT INTO review_reminders (plan_id, user_id) VALUES ('15000000-0000-0000-0000-0000000000e1', '15000000-0000-0000-0000-00000000000a');
  PERFORM rep('V4 once per person per event',
    NOT EXISTS (SELECT 1 FROM due_review_reminders(true) WHERE user_id = '15000000-0000-0000-0000-00000000000a'));

  INSERT INTO venue_reviews (venue_id, user_id, rating, body) VALUES ('15000000-0000-0000-0000-0000000000f1', '15000000-0000-0000-0000-00000000000b', 5, 'Already reviewed it');
  PERFORM rep('V5 not someone who has already reviewed it',
    NOT EXISTS (SELECT 1 FROM due_review_reminders(true) WHERE user_id = '15000000-0000-0000-0000-00000000000b'));
END $$;

SET ROLE authenticated;
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-00000000000b', true);
  BEGIN PERFORM due_review_reminders(true); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('V6 the app can''t list who is due a reminder', ok AND NOT EXISTS (SELECT 1 FROM review_reminders));
END $$;
RESET ROLE;
