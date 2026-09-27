-- A switch that lifts the free-plan limits for everyone, for open testing.
--
-- While app_settings.premium_unlocked is true, every account gets Premium
-- limits (unlimited active plans, 5 stops a plan, unlimited AI) without
-- paying. Nobody's subscription_tier changes, so paying customers stay
-- recorded as paid and everyone else drops back to Free the moment the
-- switch is turned off:
--
--   UPDATE app_settings SET value = 'false' WHERE key = 'premium_unlocked';
--
-- The app reads the switch to hide upgrade prompts; only the SQL editor or
-- service_role can change it.

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Public flags only; never put a secret here (that is what app_secrets is for).
DROP POLICY IF EXISTS "read_app_settings" ON app_settings;
CREATE POLICY "read_app_settings" ON app_settings FOR SELECT
  TO anon, authenticated USING (true);

INSERT INTO app_settings (key, value) VALUES ('premium_unlocked', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE OR REPLACE FUNCTION premium_unlocked()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT value = 'true'::jsonb FROM app_settings WHERE key = 'premium_unlocked'), false);
$$;

GRANT EXECUTE ON FUNCTION premium_unlocked() TO anon, authenticated;

-- The two caps from 20260923160000, now skipped while the switch is on.

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
  IF premium_unlocked() THEN
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
  IF v_tier IS DISTINCT FROM 'free' OR premium_unlocked() THEN
    v_max := 5;
  END IF;

  SELECT COUNT(*) INTO v_count FROM stops WHERE plan_id = NEW.plan_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'This plan is limited to % stops', v_max;
  END IF;
  RETURN NEW;
END;
$$;
