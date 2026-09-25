-- Stripe billing for Premium (monthly, yearly, lifetime).
--
-- The stripe-webhook edge function is the only writer of these columns. It
-- runs as service_role, which the protect trigger lets through. A signed-in
-- account can read its own billing state but cannot change any of it; in
-- particular it cannot point stripe_customer_id at somebody else's customer
-- and then open their billing portal.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
  ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_profile_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.subscription_tier := 'free';
    NEW.subscription_status := 'active';
    NEW.subscription_renews_at := NULL;
    NEW.stripe_customer_id := NULL;
    NEW.stripe_subscription_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    RAISE EXCEPTION 'subscription_tier is set by billing, not by the account';
  END IF;
  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
    RAISE EXCEPTION 'subscription_status is set by billing, not by the account';
  END IF;
  IF NEW.subscription_renews_at IS DISTINCT FROM OLD.subscription_renews_at THEN
    RAISE EXCEPTION 'subscription_renews_at is set by billing, not by the account';
  END IF;
  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'stripe_customer_id is set by billing, not by the account';
  END IF;
  IF NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN
    RAISE EXCEPTION 'stripe_subscription_id is set by billing, not by the account';
  END IF;
  RETURN NEW;
END;
$$;

-- Stripe delivers each event at least once and sometimes more. The webhook
-- records the id once it has handled the event, so a later retry is
-- acknowledged without being applied twice; a failed attempt is not recorded
-- and Stripe's retry runs it again. No policies: only service_role touches it.
CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stripe_events FROM anon, authenticated;
