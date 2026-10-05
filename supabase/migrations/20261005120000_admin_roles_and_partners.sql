/*
# Admin levels and the venue partner admin page

Robert asked for levels of access (call, 2026-10-01) and a page to manage
venue partners himself (Round 3, item 23):

| role  | who                     | can                                                       |
|-------|-------------------------|-----------------------------------------------------------|
| user  | everyone (the default)  | the app                                                   |
| staff | people helping with B2B | see every venue partner and its numbers, add and edit them, pause them |
| admin | Robert                  | all of that, plus approve partners, set their rate, delete them, and choose who is staff or admin |

- `profiles.role` holds the level. Nobody can raise their own; only an admin
  (through admin_set_role) or the SQL Editor can change it.
- `venue_partners.owner_id` becomes optional, so staff can add a venue that
  has no account in the app yet. Owners keep their self-serve portal.
- `admin_partner_overview()` returns every partner with its stats and what it
  has been billed: visits x rate per month, capped at the monthly budget.

To make someone the first admin, run once in the SQL Editor with their
sign-in email:

  UPDATE profiles SET role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('robert@example.com'));
*/

-- ════════════════════════════════════════════════════════════
-- 1. ROLES
-- ════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'staff', 'admin'));

-- SECURITY DEFINER so policies can ask without the caller being able to read
-- other people's profiles.
CREATE OR REPLACE FUNCTION app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT role FROM profiles WHERE id = auth.uid()), 'user');
$$;

CREATE OR REPLACE FUNCTION is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_role() IN ('staff', 'admin');
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_role() = 'admin';
$$;

REVOKE ALL ON FUNCTION app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- A role is given, never taken. The SQL Editor (no session) and the service
-- role are not limited, so the first admin can be set by hand.
CREATE OR REPLACE FUNCTION protect_profile_role()
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
    NEW.role := 'user';
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_admin() THEN
    RAISE EXCEPTION 'role is set by an admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON profiles;
CREATE TRIGGER trg_protect_profile_role
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profile_role();

-- ════════════════════════════════════════════════════════════
-- 2. VENUE PARTNERS: staff and admin access
-- ════════════════════════════════════════════════════════════

-- Staff add venues that have no account yet.
ALTER TABLE venue_partners ALTER COLUMN owner_id DROP NOT NULL;

-- `owner_id <> auth.uid()` is NULL for a venue with no owner, which would
-- refuse every event for it. IS DISTINCT FROM treats "no owner" as "not you".
CREATE OR REPLACE FUNCTION venue_accepts_events(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM venue_partners vp
    WHERE vp.id = p_venue_id
      AND vp.approved = true
      AND vp.active = true
      -- A partner may never generate their own metrics.
      AND vp.owner_id IS DISTINCT FROM auth.uid()
  );
$$;

DROP POLICY IF EXISTS "staff_select_venue_partners" ON venue_partners;
CREATE POLICY "staff_select_venue_partners" ON venue_partners FOR SELECT
  TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "staff_insert_venue_partners" ON venue_partners;
CREATE POLICY "staff_insert_venue_partners" ON venue_partners FOR INSERT
  TO authenticated WITH CHECK (is_staff());

DROP POLICY IF EXISTS "staff_update_venue_partners" ON venue_partners;
CREATE POLICY "staff_update_venue_partners" ON venue_partners FOR UPDATE
  TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "admin_delete_venue_partners" ON venue_partners;
CREATE POLICY "admin_delete_venue_partners" ON venue_partners FOR DELETE
  TO authenticated USING (is_admin());

-- New partners: an admin may approve and price on the spot; everyone else's
-- additions wait for review at the standard rate.
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
  IF is_admin() THEN
    RETURN NEW;
  END IF;
  NEW.approved := false;
  NEW.visit_rate_cents := 10;
  RETURN NEW;
END;
$$;

-- Edits: approval, rate and owner are an admin's call; the Stripe customer
-- stays with billing for everyone.
CREATE OR REPLACE FUNCTION protect_venue_partner_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The service role (admin tooling, billing jobs) bypasses this entirely.
  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'stripe_customer_id is managed by billing';
  END IF;

  IF is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.approved IS DISTINCT FROM OLD.approved THEN
    RAISE EXCEPTION 'approved is set by an admin';
  END IF;

  IF NEW.visit_rate_cents IS DISTINCT FROM OLD.visit_rate_cents THEN
    RAISE EXCEPTION 'visit_rate_cents is set by an admin';
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is set by an admin';
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 3. ADMIN OVERVIEW: every partner, its numbers, what it was billed
-- ════════════════════════════════════════════════════════════

/*
Billed per month = visits that month x the partner's rate, never more than its
monthly budget. "Total billed" adds those months up. Uses the current rate for
past months, since rate changes aren't recorded.
*/
CREATE OR REPLACE FUNCTION admin_partner_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501';
  END IF;

  WITH totals AS (
    SELECT venue_id,
      COUNT(*) FILTER (WHERE event_type = 'impression') AS impressions,
      COUNT(*) FILTER (WHERE event_type = 'saved') AS saves,
      COUNT(*) FILTER (WHERE event_type = 'visited') AS visits
    FROM venue_events
    GROUP BY venue_id
  ),
  monthly AS (
    SELECT e.venue_id, date_trunc('month', e.created_at) AS month, COUNT(*) AS visits
    FROM venue_events e
    WHERE e.event_type = 'visited'
    GROUP BY 1, 2
  ),
  billed AS (
    SELECT mo.venue_id, mo.month, mo.visits,
      LEAST(mo.visits * vp.visit_rate_cents, COALESCE(vp.monthly_budget_cents::bigint, mo.visits * vp.visit_rate_cents)) AS cents
    FROM monthly mo
    JOIN venue_partners vp ON vp.id = mo.venue_id
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'approved')::boolean, row->>'created_at' DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', vp.id,
      'business_name', vp.business_name,
      'address', vp.address,
      'type', vp.type,
      'contact_name', vp.contact_name,
      'contact_email', vp.contact_email,
      'instagram_link', vp.instagram_link,
      'website', vp.website,
      'monthly_budget_cents', vp.monthly_budget_cents,
      'visit_rate_cents', vp.visit_rate_cents,
      'active', vp.active,
      'approved', vp.approved,
      'has_account', vp.owner_id IS NOT NULL,
      'created_at', vp.created_at,
      'impressions', COALESCE(t.impressions, 0),
      'saves', COALESCE(t.saves, 0),
      'visits', COALESCE(t.visits, 0),
      'month_visits', COALESCE((SELECT b.visits FROM billed b WHERE b.venue_id = vp.id AND b.month = date_trunc('month', now())), 0),
      'month_billed_cents', COALESCE((SELECT b.cents FROM billed b WHERE b.venue_id = vp.id AND b.month = date_trunc('month', now())), 0),
      'total_billed_cents', COALESCE((SELECT SUM(b.cents) FROM billed b WHERE b.venue_id = vp.id), 0)
    ) AS row
    FROM venue_partners vp
    LEFT JOIN totals t ON t.venue_id = vp.id
  ) rows;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION admin_partner_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_partner_overview() TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 4. TEAM: who is staff or admin (admins only)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_team()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'username', p.username,
      'email', u.email,
      'role', p.role
    ) ORDER BY p.role, p.display_name)
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.role IN ('staff', 'admin')
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_role(p_email text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('user', 'staff', 'admin') THEN
    RAISE EXCEPTION 'Unknown role %', p_role;
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(btrim(coalesce(p_email, '')));
  IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_id) THEN
    RAISE EXCEPTION 'No account uses that email';
  END IF;

  -- Someone has to be left able to manage the team.
  IF p_role <> 'admin'
     AND (SELECT role FROM profiles WHERE id = v_id) = 'admin'
     AND (SELECT count(*) FROM profiles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'There has to be at least one admin';
  END IF;

  UPDATE profiles SET role = p_role WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'role', p_role);
END;
$$;

REVOKE ALL ON FUNCTION admin_team() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_role(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_team() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_role(text, text) TO authenticated;
