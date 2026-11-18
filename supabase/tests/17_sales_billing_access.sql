\set QUIET on
SET client_min_messages TO notice;

-- Stage 1 task S1-04: the two helper functions that compute sales and billing
-- figures were callable by signed-out and ordinary signed-in users through the
-- API. They are only meant to run inside the guarded functions that call them.

-- A seller with some activity, so there is something to leak.
INSERT INTO auth.users (id, email) VALUES
  ('17000000-0000-0000-0000-00000000000a', 'seller17@x.com'),
  ('17000000-0000-0000-0000-00000000000b', 'mgr17@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES
  ('17000000-0000-0000-0000-00000000000a', 'Seller17'),
  ('17000000-0000-0000-0000-00000000000b', 'Mgr17')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET role = 'staff' WHERE id = '17000000-0000-0000-0000-00000000000a';
UPDATE profiles SET role = 'manager' WHERE id = '17000000-0000-0000-0000-00000000000b';

SELECT rep('X1 anon has no EXECUTE on sales_summary_for',
  NOT has_function_privilege('anon', 'public.sales_summary_for(uuid)', 'EXECUTE'));
SELECT rep('X2 authenticated has no EXECUTE on sales_summary_for',
  NOT has_function_privilege('authenticated', 'public.sales_summary_for(uuid)', 'EXECUTE'));
SELECT rep('X3 anon has no EXECUTE on partner_billing',
  NOT has_function_privilege('anon', 'public.partner_billing()', 'EXECUTE'));
SELECT rep('X4 authenticated has no EXECUTE on partner_billing',
  NOT has_function_privilege('authenticated', 'public.partner_billing()', 'EXECUTE'));

-- A real call as a signed-out caller is refused.
SET ROLE anon;
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    PERFORM sales_summary_for('17000000-0000-0000-0000-00000000000a');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM rep('X5 signed-out call to sales_summary_for is refused', ok);

  BEGIN
    PERFORM * FROM partner_billing();
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM rep('X6 signed-out call to partner_billing is refused', ok);
END $$;
RESET ROLE;

-- Signed-in non-managers are refused too.
SET ROLE authenticated;
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-00000000000a', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM sales_summary_for('17000000-0000-0000-0000-00000000000b');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM rep('X7 signed-in user cannot read another''s sales summary', ok);
END $$;

-- The guarded paths still work.
DO $$
DECLARE s jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-00000000000a', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  s := my_sales_summary();
  PERFORM rep('X8 a seller still reads their own summary', s IS NOT NULL AND s ? 'clients');
END $$;

DO $$
DECLARE t jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-00000000000b', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  t := admin_team();
  PERFORM rep('X9 a manager still reads the team list', jsonb_typeof(t) = 'array');
END $$;
RESET ROLE;
