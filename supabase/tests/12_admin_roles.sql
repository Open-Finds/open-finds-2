\set QUIET on
SET client_min_messages TO notice;

-- Admin Ada, staff Sam, plain user Uma, venue owner Olly.
INSERT INTO auth.users (id, email) VALUES
  ('12000000-0000-0000-0000-00000000000a', 'ada@x.com'),
  ('12000000-0000-0000-0000-00000000000b', 'sam@x.com'),
  ('12000000-0000-0000-0000-00000000000c', 'uma@x.com'),
  ('12000000-0000-0000-0000-00000000000d', 'olly@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES
  ('12000000-0000-0000-0000-00000000000a', 'Ada'),
  ('12000000-0000-0000-0000-00000000000b', 'Sam'),
  ('12000000-0000-0000-0000-00000000000c', 'Uma'),
  ('12000000-0000-0000-0000-00000000000d', 'Olly')
ON CONFLICT (id) DO NOTHING;

-- The first admin is set from the SQL Editor (no session).
UPDATE profiles SET role = 'admin' WHERE id = '12000000-0000-0000-0000-00000000000a';
UPDATE profiles SET role = 'staff' WHERE id = '12000000-0000-0000-0000-00000000000b';

-- Olly's own venue, registered through the portal.
INSERT INTO venue_partners (id, owner_id, business_name, address, type, contact_name, contact_email, monthly_budget_cents, visit_rate_cents, approved)
VALUES ('12000000-0000-0000-0000-0000000000f1', '12000000-0000-0000-0000-00000000000d', 'Olly''s', '1 Olly St', 'food', 'Olly', 'olly@x.com', 25, 10, true);
-- Four visits this month (40c, capped at the 25c budget) and two last month (20c).
INSERT INTO venue_events (venue_id, event_type, created_at) VALUES
  ('12000000-0000-0000-0000-0000000000f1', 'visited', now()),
  ('12000000-0000-0000-0000-0000000000f1', 'visited', now()),
  ('12000000-0000-0000-0000-0000000000f1', 'visited', now()),
  ('12000000-0000-0000-0000-0000000000f1', 'visited', now()),
  ('12000000-0000-0000-0000-0000000000f1', 'visited', date_trunc('month', now()) - interval '3 days'),
  ('12000000-0000-0000-0000-0000000000f1', 'visited', date_trunc('month', now()) - interval '3 days'),
  ('12000000-0000-0000-0000-0000000000f1', 'impression', now());

SET ROLE authenticated;

-- Uma: an ordinary account.
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-00000000000c', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  BEGIN
    UPDATE profiles SET role = 'admin' WHERE id = '12000000-0000-0000-0000-00000000000c';
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('role' in SQLERRM) > 0;
  END;
  PERFORM rep('A1 a user cannot make themselves admin', ok);

  PERFORM rep('A2 a user sees no one else''s venue',
    (SELECT count(*) FROM venue_partners) = 0);

  BEGIN
    PERFORM admin_partner_overview();
    ok := false;
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  PERFORM rep('A3 a user cannot open the admin numbers', ok);

  BEGIN
    PERFORM admin_set_role('uma@x.com', 'admin');
    ok := false;
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  PERFORM rep('A4 a user cannot hand out roles', ok);
END $$;

-- Sam: staff.
DO $$
DECLARE ok boolean; new_id uuid; v venue_partners%ROWTYPE; n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-00000000000b', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  PERFORM rep('A5 staff see every venue partner',
    (SELECT count(*) FROM venue_partners) >= 1);

  INSERT INTO venue_partners (business_name, address, type, contact_name, contact_email, monthly_budget_cents, approved, visit_rate_cents)
  VALUES ('Staff Added', '2 Main St', 'bar', 'Kim', 'kim@x.com', 5000, true, 1)
  RETURNING id INTO new_id;
  SELECT * INTO v FROM venue_partners WHERE id = new_id;
  PERFORM rep('A6 staff add a venue with no account',
    v.owner_id IS NULL AND v.business_name = 'Staff Added');
  PERFORM rep('A7 staff additions wait for approval',
    NOT v.approved AND v.visit_rate_cents = 10);

  BEGIN
    UPDATE venue_partners SET approved = true WHERE id = new_id;
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('approved' in SQLERRM) > 0;
  END;
  PERFORM rep('A8 staff cannot approve', ok);

  UPDATE venue_partners SET contact_name = 'Kimberly', active = false WHERE id = new_id;
  PERFORM rep('A9 staff edit details and pause',
    (SELECT contact_name = 'Kimberly' AND NOT active FROM venue_partners WHERE id = new_id));

  DELETE FROM venue_partners WHERE id = new_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('A10 staff cannot delete', n = 0);
END $$;

-- Ada: admin.
DO $$
DECLARE ok boolean; ov jsonb; olly jsonb; team jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-00000000000a', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  UPDATE venue_partners SET approved = true, visit_rate_cents = 15 WHERE business_name = 'Staff Added';
  PERFORM rep('A11 admins approve and set the rate',
    (SELECT approved AND visit_rate_cents = 15 FROM venue_partners WHERE business_name = 'Staff Added'));

  ov := admin_partner_overview();
  SELECT e INTO olly FROM jsonb_array_elements(ov) e WHERE e->>'business_name' = 'Olly''s';
  PERFORM rep('A12 overview counts visits and views',
    (olly->>'visits')::int = 6 AND (olly->>'month_visits')::int = 4 AND (olly->>'impressions')::int = 1);
  PERFORM rep('A13 a month is billed up to its budget',
    (olly->>'month_billed_cents')::int = 25);
  PERFORM rep('A14 total billed adds up the months',
    (olly->>'total_billed_cents')::int = 45 AND (olly->>'has_account')::boolean);

  PERFORM admin_set_role('UMA@x.com ', 'staff');
  team := admin_team();
  PERFORM rep('A15 admins give roles by email',
    EXISTS (SELECT 1 FROM jsonb_array_elements(team) e WHERE e->>'email' = 'uma@x.com' AND e->>'role' = 'staff'));
  PERFORM rep('A16 the team lists staff and admins',
    jsonb_array_length(team) = 3 AND team::text LIKE '%sam@x.com%');

  BEGIN
    PERFORM admin_set_role('ada@x.com', 'user');
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('at least one admin' in SQLERRM) > 0;
  END;
  PERFORM rep('A17 the last admin cannot step down', ok);

  BEGIN
    PERFORM admin_set_role('nobody@x.com', 'staff');
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('No account' in SQLERRM) > 0;
  END;
  PERFORM rep('A18 unknown emails are refused', ok);

  DELETE FROM venue_partners WHERE business_name = 'Staff Added';
  PERFORM rep('A19 admins delete partners',
    NOT EXISTS (SELECT 1 FROM venue_partners WHERE business_name = 'Staff Added'));
END $$;

-- Olly: the owner keeps the self-serve rules.
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-00000000000d', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    UPDATE venue_partners SET visit_rate_cents = 0 WHERE id = '12000000-0000-0000-0000-0000000000f1';
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('visit_rate_cents' in SQLERRM) > 0;
  END;
  PERFORM rep('A20 owners still cannot set their rate', ok);
  PERFORM rep('A21 owners still see only their own',
    (SELECT count(*) FROM venue_partners) = 1);
END $$;

-- A venue added without an account still counts guests' visits.
DO $$
BEGIN
  RESET ROLE;
  INSERT INTO venue_partners (id, business_name, address, type, contact_name, contact_email, approved)
  VALUES ('12000000-0000-0000-0000-0000000000f2', 'No Account', '3 St', 'food', 'N', 'n@x.com', true);
  PERFORM set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-00000000000c', true);
  PERFORM rep('A22 venues without an account accept events',
    venue_accepts_events('12000000-0000-0000-0000-0000000000f2'));
END $$;
RESET ROLE;
