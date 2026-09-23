-- Free tier, as set on 21 Sep 2026: 1 active plan, 2 stops on it.
-- Paid tiers: unlimited plans, 5 stops. A signed-in user cannot change their
-- own tier; that column is what billing will write.

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
    RETURN NEW;
  END IF;

  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    RAISE EXCEPTION 'subscription_tier is set by billing, not by the account';
  END IF;
  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
    RAISE EXCEPTION 'subscription_status is set by billing, not by the account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_billing ON profiles;
CREATE TRIGGER trg_protect_profile_billing
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profile_billing_columns();

CREATE OR REPLACE FUNCTION enforce_active_plan_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier text;
  v_active int;
BEGIN
  -- Tests and maintenance run without a user session. The cap is for the app.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('role', true) = 'service_role' OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id IS NULL OR NEW.canceled THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(subscription_tier, 'free') INTO v_tier
  FROM profiles WHERE id = NEW.owner_id;
  IF v_tier IS DISTINCT FROM 'free' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_active
  FROM plans
  WHERE owner_id = NEW.owner_id
    AND canceled = false
    AND date >= CURRENT_DATE
    AND id IS DISTINCT FROM NEW.id;

  IF v_active >= 1 THEN
    RAISE EXCEPTION 'Free includes 1 active plan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_active_plan_cap ON plans;
CREATE TRIGGER trg_enforce_active_plan_cap
  BEFORE INSERT OR UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION enforce_active_plan_cap();

CREATE OR REPLACE FUNCTION enforce_stop_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_tier text;
  v_max int := 2;
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('role', true) = 'service_role' OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO v_owner FROM plans WHERE id = NEW.plan_id;
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(subscription_tier, 'free') INTO v_tier
  FROM profiles WHERE id = v_owner;
  IF v_tier IS DISTINCT FROM 'free' THEN
    v_max := 5;
  END IF;

  SELECT COUNT(*) INTO v_count FROM stops WHERE plan_id = NEW.plan_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'This plan is limited to % stops', v_max;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_stop_cap ON stops;
CREATE TRIGGER trg_enforce_stop_cap
  BEFORE INSERT ON stops
  FOR EACH ROW
  EXECUTE FUNCTION enforce_stop_cap();

-- A venue does not set its own price or approve itself. The rate is the
-- published appearance price: 10 cents. Billing batches are applied on top.
ALTER TABLE venue_partners ALTER COLUMN visit_rate_cents SET DEFAULT 10;

CREATE OR REPLACE FUNCTION protect_venue_partner_on_insert()
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
  NEW.approved := false;
  NEW.visit_rate_cents := 10;
  NEW.stripe_customer_id := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_venue_partner_insert ON venue_partners;
CREATE TRIGGER trg_protect_venue_partner_insert
  BEFORE INSERT ON venue_partners
  FOR EACH ROW
  EXECUTE FUNCTION protect_venue_partner_on_insert();
