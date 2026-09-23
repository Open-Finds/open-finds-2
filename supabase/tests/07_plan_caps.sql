\set QUIET on
SET client_min_messages TO notice;

INSERT INTO auth.users (id, email) VALUES
  ('12121212-1212-1212-1212-121212121212', 'cap@x.com')
ON CONFLICT DO NOTHING;

-- The first plan is written with no session, which is how maintenance runs.
-- The cap applies once a signed-in user is the one writing.
INSERT INTO plans (id, title, date, host_name, location, type, status, user_id, owner_id)
VALUES
  ('12121212-0000-0000-0000-000000000001', 'One', CURRENT_DATE + 7, 'Cap', 'Sydney', 'food', 'active', 'device', '12121212-1212-1212-1212-121212121212');

INSERT INTO stops (plan_id, name, address, time, sort_order) VALUES
  ('12121212-0000-0000-0000-000000000001', 'A', '1 George St', '18:00', 0),
  ('12121212-0000-0000-0000-000000000001', 'B', '2 Pitt St', '20:00', 1);

DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '12121212-1212-1212-1212-121212121212', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  BEGIN
    INSERT INTO plans (title, date, host_name, location, type, status, user_id, owner_id)
    VALUES ('Two', CURRENT_DATE + 8, 'Cap', 'Sydney', 'food', 'active', 'device', '12121212-1212-1212-1212-121212121212');
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('1 active plan' in SQLERRM) > 0;
  END;
  PERFORM rep('P4 free account cannot start a second active plan', ok);

  BEGIN
    UPDATE profiles SET subscription_tier = 'premium_monthly'
    WHERE id = '12121212-1212-1212-1212-121212121212';
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('subscription_tier' in SQLERRM) > 0;
  END;
  PERFORM rep('P5 account cannot grant itself Premium', ok);

  BEGIN
    INSERT INTO stops (plan_id, name, address, time, sort_order)
    VALUES ('12121212-0000-0000-0000-000000000001', 'C', '3 York St', '21:00', 2);
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('limited to 2' in SQLERRM) > 0;
  END;
  PERFORM rep('P7 free plan refuses a third stop', ok);
END $$;
