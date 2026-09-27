\set QUIET on
SET client_min_messages TO notice;

UPDATE app_settings SET value = 'true' WHERE key = 'premium_unlocked';

INSERT INTO auth.users (id, email) VALUES
  ('15151515-1515-1515-1515-151515151515', 'open@x.com')
ON CONFLICT DO NOTHING;

INSERT INTO plans (id, title, date, host_name, location, type, status, user_id, owner_id)
VALUES
  ('15151515-0000-0000-0000-000000000001', 'One', CURRENT_DATE + 7, 'Open', 'Sydney', 'food', 'active', 'device', '15151515-1515-1515-1515-151515151515');

DO $$
DECLARE ok boolean; i int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '15151515-1515-1515-1515-151515151515', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  BEGIN
    INSERT INTO plans (title, date, host_name, location, type, status, user_id, owner_id)
    VALUES ('Two', CURRENT_DATE + 8, 'Open', 'Sydney', 'food', 'active', 'device', '15151515-1515-1515-1515-151515151515');
    ok := true;
  EXCEPTION WHEN others THEN
    ok := false;
  END;
  PERFORM rep('U1 unlocked: free account can start a second plan', ok);

  BEGIN
    FOR i IN 1..5 LOOP
      INSERT INTO stops (plan_id, name, address, time, sort_order)
      VALUES ('15151515-0000-0000-0000-000000000001', 'S' || i, i || ' George St', '18:00', i);
    END LOOP;
    ok := true;
  EXCEPTION WHEN others THEN
    ok := false;
  END;
  PERFORM rep('U2 unlocked: free plan takes 5 stops', ok);

  BEGIN
    INSERT INTO stops (plan_id, name, address, time, sort_order)
    VALUES ('15151515-0000-0000-0000-000000000001', 'S6', '6 George St', '18:00', 6);
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('limited to 5' in SQLERRM) > 0;
  END;
  PERFORM rep('U3 unlocked: still no sixth stop', ok);

  PERFORM rep('U4 unlocked: tier itself is untouched',
    (SELECT COALESCE(subscription_tier, 'free') FROM profiles WHERE id = '15151515-1515-1515-1515-151515151515') = 'free');

  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE app_settings SET value = 'false' WHERE key = 'premium_unlocked';
    ok := NOT FOUND;
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  RESET ROLE;
  PERFORM rep('U5 a signed-in user cannot flip the switch', ok AND premium_unlocked());
END $$;
