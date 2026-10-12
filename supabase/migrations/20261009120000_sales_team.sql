/*
# Sales team: who brought each venue partner in, and what they're owed

Robert (call, 2026-10-09): if he hires people to sell to venues and onboard
them, each should be able to track their own clients, and he needs to see
what each one brings in so he can pay them. First version, ahead of his
fuller brief:

- venue_partners.account_manager: the team member responsible for the
  partner. Set to whoever adds it (staff can only add for themselves); an
  admin can reassign. Partners who signed up through the portal have none
  until an admin gives them one.
- Staff now see and edit only their own clients; admins see everyone.
- profiles.commission_percent: set by an admin per team member, 10% unless
  changed (Robert's spec: workers get 10% of their venues' revenue, for as
  long as the venue pays). Commission = what their clients were billed
  (visits x rate, capped at budget) x %.
- admin_partner_overview() includes the manager; staff get only theirs.
- admin_team() includes each member's clients, billing and commission;
  my_sales_summary() gives a staff member their own.
*/

-- ════════════════════════════════════════════════════════════
-- 1. COLUMNS
-- ════════════════════════════════════════════════════════════

ALTER TABLE venue_partners
  ADD COLUMN IF NOT EXISTS account_manager uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_venue_partners_account_manager ON venue_partners(account_manager);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS commission_percent numeric(5,2) NOT NULL DEFAULT 10;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_commission_percent_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_commission_percent_check CHECK (commission_percent BETWEEN 0 AND 100);

-- Commission is an admin's call, like the role.
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
    NEW.commission_percent := 10;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_admin() THEN
    RAISE EXCEPTION 'role is set by an admin';
  END IF;
  IF NEW.commission_percent IS DISTINCT FROM OLD.commission_percent AND NOT is_admin() THEN
    RAISE EXCEPTION 'commission_percent is set by an admin';
  END IF;
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 2. WHO SEES WHICH PARTNERS
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff_select_venue_partners" ON venue_partners;
CREATE POLICY "staff_select_venue_partners" ON venue_partners FOR SELECT
  TO authenticated USING (is_admin() OR (is_staff() AND account_manager = auth.uid()));

DROP POLICY IF EXISTS "staff_update_venue_partners" ON venue_partners;
CREATE POLICY "staff_update_venue_partners" ON venue_partners FOR UPDATE
  TO authenticated
  USING (is_admin() OR (is_staff() AND account_manager = auth.uid()))
  WITH CHECK (is_admin() OR (is_staff() AND account_manager = auth.uid()));

-- A new partner is managed by whoever adds it; only an admin picks someone else.
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
    NEW.account_manager := COALESCE(NEW.account_manager, auth.uid());
    RETURN NEW;
  END IF;
  IF is_staff() THEN
    NEW.account_manager := auth.uid();
  ELSE
    -- A venue registering itself through the portal.
    NEW.account_manager := NULL;
  END IF;
  NEW.approved := false;
  NEW.visit_rate_cents := 10;
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
  -- The service role, and the SQL Editor (no session), are not limited, as
  -- on insert; anonymous requests can't update this table at all.
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

  IF NEW.approved IS DISTINCT FROM OLD.approved THEN
    RAISE EXCEPTION 'approved is set by an admin';
  END IF;
  IF NEW.visit_rate_cents IS DISTINCT FROM OLD.visit_rate_cents THEN
    RAISE EXCEPTION 'visit_rate_cents is set by an admin';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is set by an admin';
  END IF;
  IF NEW.account_manager IS DISTINCT FROM OLD.account_manager THEN
    RAISE EXCEPTION 'account_manager is set by an admin';
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 3. NUMBERS
-- ════════════════════════════════════════════════════════════

/*
What each partner was billed: per month, visits x rate, capped at the
monthly budget. Shared by the overview and the team totals.
*/
CREATE OR REPLACE FUNCTION partner_billing()
RETURNS TABLE (venue_id uuid, month timestamptz, visits bigint, cents bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT mo.venue_id, mo.month, mo.visits,
    LEAST(mo.visits * vp.visit_rate_cents, COALESCE(vp.monthly_budget_cents::bigint, mo.visits * vp.visit_rate_cents))::bigint
  FROM (
    SELECT e.venue_id, date_trunc('month', e.created_at) AS month, COUNT(*) AS visits
    FROM venue_events e
    WHERE e.event_type = 'visited'
    GROUP BY 1, 2
  ) mo
  JOIN venue_partners vp ON vp.id = mo.venue_id;
$$;
REVOKE ALL ON FUNCTION partner_billing() FROM PUBLIC;

CREATE OR REPLACE FUNCTION admin_partner_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin boolean := is_admin();
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
  billed AS (SELECT * FROM partner_billing())
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
      'account_manager', vp.account_manager,
      'account_manager_name', mgr.display_name,
      'impressions', COALESCE(t.impressions, 0),
      'saves', COALESCE(t.saves, 0),
      'visits', COALESCE(t.visits, 0),
      'month_visits', COALESCE((SELECT b.visits FROM billed b WHERE b.venue_id = vp.id AND b.month = date_trunc('month', now())), 0),
      'month_billed_cents', COALESCE((SELECT b.cents FROM billed b WHERE b.venue_id = vp.id AND b.month = date_trunc('month', now())), 0),
      'total_billed_cents', COALESCE((SELECT SUM(b.cents) FROM billed b WHERE b.venue_id = vp.id), 0)
    ) AS row
    FROM venue_partners vp
    LEFT JOIN totals t ON t.venue_id = vp.id
    LEFT JOIN profiles mgr ON mgr.id = vp.account_manager
    -- Staff see their own clients; admins see everyone's.
    WHERE v_admin OR vp.account_manager = auth.uid()
  ) rows;

  RETURN v_result;
END;
$$;

/* One team member's clients and what they're owed. */
CREATE OR REPLACE FUNCTION sales_summary_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH mine AS (SELECT id FROM venue_partners WHERE account_manager = p_user),
  b AS (SELECT * FROM partner_billing() WHERE venue_id IN (SELECT id FROM mine)),
  pct AS (SELECT COALESCE(commission_percent, 0) AS p FROM profiles WHERE id = p_user)
  SELECT jsonb_build_object(
    'clients', (SELECT COUNT(*) FROM mine),
    'month_billed_cents', COALESCE((SELECT SUM(cents) FROM b WHERE month = date_trunc('month', now())), 0),
    'total_billed_cents', COALESCE((SELECT SUM(cents) FROM b), 0),
    'commission_percent', COALESCE((SELECT p FROM pct), 0),
    'month_commission_cents', ROUND(COALESCE((SELECT SUM(cents) FROM b WHERE month = date_trunc('month', now())), 0) * COALESCE((SELECT p FROM pct), 0) / 100),
    'total_commission_cents', ROUND(COALESCE((SELECT SUM(cents) FROM b), 0) * COALESCE((SELECT p FROM pct), 0) / 100)
  );
$$;
REVOKE ALL ON FUNCTION sales_summary_for(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION my_sales_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501';
  END IF;
  RETURN sales_summary_for(auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION my_sales_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_sales_summary() TO authenticated;

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
      'role', p.role,
      'sales', sales_summary_for(p.id)
    ) ORDER BY p.role, p.display_name)
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.role IN ('staff', 'admin')
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_commission(p_user uuid, p_percent numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 100 THEN
    RAISE EXCEPTION 'Commission is a percentage from 0 to 100';
  END IF;
  UPDATE profiles SET commission_percent = p_percent WHERE id = p_user AND role IN ('staff', 'admin');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only team members earn commission';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION admin_set_commission(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_commission(uuid, numeric) TO authenticated;
