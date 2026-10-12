\set QUIET on
SET client_min_messages TO notice;

-- Admin Ana, sellers Sal and Tia, venue owner Vic.
INSERT INTO auth.users (id, email) VALUES
  ('13000000-0000-0000-0000-00000000000a', 'ana@x.com'),
  ('13000000-0000-0000-0000-00000000000b', 'sal@x.com'),
  ('13000000-0000-0000-0000-00000000000c', 'tia@x.com'),
  ('13000000-0000-0000-0000-00000000000d', 'vic@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES
  ('13000000-0000-0000-0000-00000000000a', 'Ana'),
  ('13000000-0000-0000-0000-00000000000b', 'Sal'),
  ('13000000-0000-0000-0000-00000000000c', 'Tia'),
  ('13000000-0000-0000-0000-00000000000d', 'Vic')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET role = 'admin' WHERE id = '13000000-0000-0000-0000-00000000000a';
UPDATE profiles SET role = 'staff' WHERE id IN ('13000000-0000-0000-0000-00000000000b', '13000000-0000-0000-0000-00000000000c');

SET ROLE authenticated;

-- Sal signs a venue up.
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-00000000000b', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO venue_partners (id, business_name, address, type, contact_name, contact_email, account_manager)
  VALUES ('13000000-0000-0000-0000-0000000000f1', 'Sal Client', '1 Sal St', 'food', 'C', 'c@x.com', '13000000-0000-0000-0000-00000000000c');
  PERFORM rep('S1 a seller manages the venues they add',
    (SELECT account_manager FROM venue_partners WHERE id = '13000000-0000-0000-0000-0000000000f1') = '13000000-0000-0000-0000-00000000000b');

  BEGIN
    UPDATE venue_partners SET account_manager = '13000000-0000-0000-0000-00000000000c' WHERE id = '13000000-0000-0000-0000-0000000000f1';
    ok := false;
  EXCEPTION WHEN others THEN ok := position('account_manager' in SQLERRM) > 0; END;
  PERFORM rep('S2 a seller can''t hand a client on', ok);

  BEGIN
    UPDATE profiles SET commission_percent = 50 WHERE id = '13000000-0000-0000-0000-00000000000b';
    ok := false;
  EXCEPTION WHEN others THEN ok := position('commission_percent' in SQLERRM) > 0; END;
  PERFORM rep('S3 a seller can''t set their own commission', ok);

  BEGIN
    PERFORM admin_set_commission('13000000-0000-0000-0000-00000000000b', 50);
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('S4 only admins set commission', ok);
END $$;

-- Tia can't see Sal's client.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-00000000000c', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM rep('S5 sellers see only their own clients',
    NOT EXISTS (SELECT 1 FROM venue_partners WHERE id = '13000000-0000-0000-0000-0000000000f1')
    AND jsonb_array_length(admin_partner_overview()) = 0);
END $$;

-- The venue is approved and gets visits: 4 this month at 10c.
RESET ROLE;
UPDATE venue_partners SET approved = true, visit_rate_cents = 10 WHERE id = '13000000-0000-0000-0000-0000000000f1';
INSERT INTO venue_events (venue_id, event_type, created_at)
SELECT '13000000-0000-0000-0000-0000000000f1', 'visited', now() FROM generate_series(1, 4);
INSERT INTO venue_events (venue_id, event_type, created_at)
SELECT '13000000-0000-0000-0000-0000000000f1', 'visited', date_trunc('month', now()) - interval '2 days' FROM generate_series(1, 6);
SET ROLE authenticated;

-- Ana sets Sal's commission and sees the team's numbers.
DO $$
DECLARE team jsonb; sal jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-00000000000a', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM admin_set_commission('13000000-0000-0000-0000-00000000000b', 25);
  team := admin_team();
  SELECT e INTO sal FROM jsonb_array_elements(team) e WHERE e->>'email' = 'sal@x.com';
  PERFORM rep('S6 the team shows each seller''s clients and billing',
    (sal->'sales'->>'clients')::int = 1 AND (sal->'sales'->>'month_billed_cents')::int = 40 AND (sal->'sales'->>'total_billed_cents')::int = 100);
  PERFORM rep('S7 commission is billing x their percentage',
    (sal->'sales'->>'month_commission_cents')::int = 10 AND (sal->'sales'->>'total_commission_cents')::int = 25);
  PERFORM rep('S8 admins see every partner with its manager',
    EXISTS (SELECT 1 FROM jsonb_array_elements(admin_partner_overview()) e WHERE lower(e->>'account_manager_name') = 'sal'));

  UPDATE venue_partners SET account_manager = '13000000-0000-0000-0000-00000000000c' WHERE id = '13000000-0000-0000-0000-0000000000f1';
END $$;

-- After Ana hands the client to Tia.
DO $$
DECLARE mine jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-00000000000c', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  mine := my_sales_summary();
  PERFORM rep('S9 admins can reassign a client',
    (mine->>'clients')::int = 1 AND EXISTS (SELECT 1 FROM venue_partners WHERE id = '13000000-0000-0000-0000-0000000000f1'));
END $$;

-- A venue registering itself has no manager until an admin gives it one.
DO $$
DECLARE m uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-00000000000d', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO venue_partners (owner_id, business_name, address, type, contact_name, contact_email, account_manager)
  VALUES ('13000000-0000-0000-0000-00000000000d', 'Vic Self Signup', '2 Vic St', 'bar', 'Vic', 'vic@x.com', '13000000-0000-0000-0000-00000000000b')
  RETURNING account_manager INTO m;
  PERFORM rep('S10 self sign-ups start without a manager', m IS NULL);
END $$;
RESET ROLE;
