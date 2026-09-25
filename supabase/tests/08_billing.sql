\set QUIET on
SET client_min_messages TO notice;

INSERT INTO auth.users (id, email) VALUES
  ('13131313-1313-1313-1313-131313131313', 'bill@x.com')
ON CONFLICT DO NOTHING;

INSERT INTO profiles (id, display_name) VALUES
  ('13131313-1313-1313-1313-131313131313', 'Bill')
ON CONFLICT (id) DO NOTHING;

-- Billing (no session, as service_role would be) links the Stripe customer.
UPDATE profiles SET stripe_customer_id = 'cus_bill', stripe_subscription_id = 'sub_bill'
WHERE id = '13131313-1313-1313-1313-131313131313';

DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '13131313-1313-1313-1313-131313131313', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  BEGIN
    UPDATE profiles SET stripe_customer_id = 'cus_someone_else'
    WHERE id = '13131313-1313-1313-1313-131313131313';
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('stripe_customer_id' in SQLERRM) > 0;
  END;
  PERFORM rep('B1 account cannot repoint its Stripe customer', ok);

  BEGIN
    UPDATE profiles SET stripe_subscription_id = NULL
    WHERE id = '13131313-1313-1313-1313-131313131313';
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('stripe_subscription_id' in SQLERRM) > 0;
  END;
  PERFORM rep('B2 account cannot detach its subscription', ok);

  BEGIN
    UPDATE profiles SET subscription_renews_at = now() + interval '10 years'
    WHERE id = '13131313-1313-1313-1313-131313131313';
    ok := false;
  EXCEPTION WHEN others THEN
    ok := position('subscription_renews_at' in SQLERRM) > 0;
  END;
  PERFORM rep('B3 account cannot move its renewal date', ok);

  BEGIN
    UPDATE profiles SET display_name = 'Bill B'
    WHERE id = '13131313-1313-1313-1313-131313131313';
    ok := true;
  EXCEPTION WHEN others THEN
    ok := false;
  END;
  PERFORM rep('B4 account can still edit its own name', ok);
END $$;

-- 01_write_policies grants every table to the API roles, so the boundary under
-- test here is RLS with no policies, not the REVOKE in the migration.
INSERT INTO stripe_events (id, type) VALUES ('evt_test', 'test');

DO $$
DECLARE ok boolean; n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '13131313-1313-1313-1313-131313131313', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO n FROM stripe_events;
  PERFORM rep('B5 signed-in user cannot read stripe_events', n = 0);

  BEGIN
    INSERT INTO stripe_events (id, type) VALUES ('evt_forged', 'forged');
    ok := false;
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  PERFORM rep('B6 signed-in user cannot mark an event handled', ok);

  RESET ROLE;
END $$;
