/*
# Super admin approves every venue; one rate for everyone

Robert (2026-10-12), changing the 2026-10-09 spec:
- "workers are able to add venues without super admin approval. admin needs
  to verify each approval" — every venue a worker or manager adds now waits
  in Approvals, and only the super admin approves or rejects.
- "rates should be the same for everyone only admin can change the rates" —
  one rate per review/visit, kept in app_settings.visit_rate_cents. Every
  venue is charged it; only the super admin changes it, and changing it
  changes it for every venue.

Managers keep the dashboard, editing venue details, pausing and assigning
who looks after a venue.
*/

-- ════════════════════════════════════════════════════════════
-- 1. THE RATE
-- ════════════════════════════════════════════════════════════

INSERT INTO app_settings (key, value)
VALUES ('visit_rate_cents', to_jsonb(COALESCE((SELECT max(visit_rate_cents) FROM venue_partners), 10)))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION visit_rate_cents()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::int FROM app_settings WHERE key = 'visit_rate_cents'), 10);
$$;
REVOKE ALL ON FUNCTION visit_rate_cents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visit_rate_cents() TO authenticated;

-- Every venue on the one rate from now on.
UPDATE venue_partners SET visit_rate_cents = visit_rate_cents() WHERE visit_rate_cents IS DISTINCT FROM visit_rate_cents();

CREATE OR REPLACE FUNCTION admin_set_visit_rate(p_cents int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only the super admin changes the rate' USING ERRCODE = '42501';
  END IF;
  IF p_cents IS NULL OR p_cents < 0 OR p_cents > 10000 THEN
    RAISE EXCEPTION 'The rate is between $0 and $100';
  END IF;
  INSERT INTO app_settings (key, value, updated_at) VALUES ('visit_rate_cents', to_jsonb(p_cents), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  UPDATE venue_partners SET visit_rate_cents = p_cents;
END;
$$;
REVOKE ALL ON FUNCTION admin_set_visit_rate(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_visit_rate(int) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. NEW VENUES WAIT FOR THE SUPER ADMIN
-- ════════════════════════════════════════════════════════════

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
  NEW.stripe_customer_id := NULL;
  NEW.rejection_reason := NULL;
  NEW.visit_rate_cents := visit_rate_cents();
  IF is_admin() THEN
    NEW.account_manager := COALESCE(NEW.account_manager, auth.uid());
    RETURN NEW;
  END IF;
  NEW.approved := false;
  IF is_manager() THEN
    NEW.account_manager := COALESCE(NEW.account_manager, auth.uid());
  ELSIF is_staff() THEN
    -- A worker's venue is theirs.
    NEW.account_manager := auth.uid();
    IF NEW.owner_id IS DISTINCT FROM auth.uid() THEN
      NEW.owner_id := NULL;
    END IF;
  ELSE
    -- A venue registering itself through the portal.
    NEW.account_manager := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_venue_partner_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The service role, and the SQL Editor (no session), are not limited.
  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'stripe_customer_id is managed by billing';
  END IF;

  IF is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'Only the super admin approves or rejects venues';
  END IF;
  IF NEW.visit_rate_cents IS DISTINCT FROM OLD.visit_rate_cents THEN
    RAISE EXCEPTION 'Only the super admin changes the rate';
  END IF;
  -- Managers may still decide who looks after a venue.
  IF is_manager() THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is set by a manager';
  END IF;
  IF NEW.account_manager IS DISTINCT FROM OLD.account_manager THEN
    RAISE EXCEPTION 'account_manager is set by a manager';
  END IF;

  RETURN NEW;
END;
$$;
