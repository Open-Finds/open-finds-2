/*
# Workers, managers, reviews and credits

Robert's spec (chat, 2026-10-09), on top of the sales-team migration:

| role    | shown as    | can                                                             |
|---------|-------------|-----------------------------------------------------------------|
| user    | User        | the app; review sponsored venues for credits                    |
| staff   | Worker      | all of that, plus submit venue partners (live straight away), see and edit their own, see their own commission |
| manager | Manager     | all of that, plus the admin dashboard: every venue, approve or reject with a reason, the team's numbers |
| admin   | Super admin | everything, plus roles, commission rates and marking commission paid |

- Workers' venues go live with no approval (trust-based). A manager can
  reject one with a reason, which takes it down and tells the worker why.
  Venues that register themselves through the portal still wait for review.
- The worker who signs a venue up agrees its rate, so they can set and change
  it; they can't approve, reject or hand the venue to someone else.
- commission_payouts records what Robert has paid each team member, so the
  dashboard shows commission paid and still owed.
- venue_reviews: one review per person per sponsored venue. The first review
  of a venue earns 1 credit (once, even if deleted and posted again), and
  counts as a visit, which is what the venue is billed for.
- credit_ledger: credits are earned and spent here and never expire. ai-proxy
  spends one when a free account has used today's 3 and asks for one more.
- Visits can no longer be recorded straight from the app; only a review makes
  one. Views and saves still can, once per person, venue and day.
*/

-- ════════════════════════════════════════════════════════════
-- 1. ROLES
-- ════════════════════════════════════════════════════════════

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'staff', 'manager', 'admin'));

-- Anyone on the team: workers, managers and super admins.
CREATE OR REPLACE FUNCTION is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_role() IN ('staff', 'manager', 'admin');
$$;

-- Managers and super admins: the admin dashboard.
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_role() IN ('manager', 'admin');
$$;

REVOKE ALL ON FUNCTION is_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_manager() TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. VENUE PARTNERS
-- ════════════════════════════════════════════════════════════

ALTER TABLE venue_partners ADD COLUMN IF NOT EXISTS contact_phone text;
-- Set when a manager takes a venue down; the worker sees why.
ALTER TABLE venue_partners ADD COLUMN IF NOT EXISTS rejection_reason text;

DROP POLICY IF EXISTS "staff_select_venue_partners" ON venue_partners;
CREATE POLICY "staff_select_venue_partners" ON venue_partners FOR SELECT
  TO authenticated USING (is_manager() OR (is_staff() AND account_manager = auth.uid()));

DROP POLICY IF EXISTS "staff_update_venue_partners" ON venue_partners;
CREATE POLICY "staff_update_venue_partners" ON venue_partners FOR UPDATE
  TO authenticated
  USING (is_manager() OR (is_staff() AND account_manager = auth.uid()))
  WITH CHECK (is_manager() OR (is_staff() AND account_manager = auth.uid()));

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
  IF is_manager() THEN
    NEW.account_manager := COALESCE(NEW.account_manager, auth.uid());
    RETURN NEW;
  END IF;
  IF is_staff() THEN
    -- A worker's venue is theirs and live straight away, at the rate they agreed.
    NEW.account_manager := auth.uid();
    IF NEW.owner_id IS DISTINCT FROM auth.uid() THEN
      NEW.owner_id := NULL;
    END IF;
    NEW.approved := true;
    RETURN NEW;
  END IF;
  -- A venue registering itself through the portal waits for review.
  NEW.account_manager := NULL;
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
  -- The service role, and the SQL Editor (no session), are not limited.
  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'stripe_customer_id is managed by billing';
  END IF;

  IF is_manager() THEN
    RETURN NEW;
  END IF;

  IF NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'approved is set by a manager';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is set by a manager';
  END IF;
  IF NEW.account_manager IS DISTINCT FROM OLD.account_manager THEN
    RAISE EXCEPTION 'account_manager is set by a manager';
  END IF;
  -- The worker who signed the venue up agreed its rate; the venue itself can't change it.
  IF NEW.visit_rate_cents IS DISTINCT FROM OLD.visit_rate_cents
     AND NOT (is_staff() AND OLD.account_manager = auth.uid()) THEN
    RAISE EXCEPTION 'visit_rate_cents is set by agreement';
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 3. VISITS COME FROM REVIEWS
-- ════════════════════════════════════════════════════════════

/*
A visit is what a venue pays for and what a worker's commission is worked
out from, so it can't be one the app simply says happened. Views and saves
stay as they were.
*/
DROP POLICY IF EXISTS "insert_venue_events" ON venue_events;
CREATE POLICY "insert_venue_events" ON venue_events FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_uid = auth.uid()
    AND event_type IN ('impression', 'saved')
    AND venue_accepts_events(venue_id)
  );

/* Views or saves of several venues at once; repeats the same day are ignored. */
CREATE OR REPLACE FUNCTION record_venue_events(p_venue_ids uuid[], p_type text, p_plan uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'A signed-in session is required';
  END IF;
  IF p_type NOT IN ('impression', 'saved') THEN
    RAISE EXCEPTION 'Only views and saves are recorded this way';
  END IF;
  INSERT INTO venue_events (venue_id, event_type, plan_id, auth_uid, user_id)
  SELECT v, p_type, p_plan, auth.uid(), auth.uid()::text
  FROM unnest(p_venue_ids[1:50]) AS v
  WHERE venue_accepts_events(v)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION record_venue_events(uuid[], text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_venue_events(uuid[], text, uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 4. CREDITS
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta int NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (reason IN ('review', 'extract', 'discover', 'refund', 'admin')),
  -- For a review, the venue it was for.
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id);
-- One credit per venue reviewed, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_one_per_review
  ON credit_ledger (user_id, ref) WHERE reason = 'review';

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_credits" ON credit_ledger;
CREATE POLICY "select_own_credits" ON credit_ledger FOR SELECT
  TO authenticated USING (user_id = auth.uid());
-- No write policies: credits only move through the functions below.

CREATE OR REPLACE FUNCTION my_credits()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(delta), 0)::int FROM credit_ledger WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION my_credits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_credits() TO authenticated;

/*
Spends one credit for one more AI use. Returns the balance left, or NULL if
there was none to spend. Called by ai-proxy with the service role only; the
lock stops two requests at once spending the same credit.
*/
CREATE OR REPLACE FUNCTION spend_credit(p_user uuid, p_reason text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance int;
BEGIN
  IF p_reason NOT IN ('extract', 'discover') THEN
    RAISE EXCEPTION 'Unknown use %', p_reason;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('credits:' || p_user::text));
  SELECT COALESCE(SUM(delta), 0) INTO v_balance FROM credit_ledger WHERE user_id = p_user;
  IF v_balance < 1 THEN
    RETURN NULL;
  END IF;
  INSERT INTO credit_ledger (user_id, delta, reason) VALUES (p_user, -1, p_reason);
  RETURN v_balance - 1;
END;
$$;

/* Gives a credit back when the AI call it paid for failed. */
CREATE OR REPLACE FUNCTION refund_credit(p_user uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO credit_ledger (user_id, delta, reason) VALUES (p_user, 1, 'refund');
$$;

REVOKE ALL ON FUNCTION spend_credit(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refund_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION spend_credit(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION refund_credit(uuid) TO service_role;

-- ════════════════════════════════════════════════════════════
-- 5. REVIEWS
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venue_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venue_partners(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_venue_reviews_venue ON venue_reviews(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_reviews_user_created ON venue_reviews(user_id, created_at);

/*
A live venue, and not one the reviewer owns or manages: a venue's own staff,
or the worker earning commission on it, can't bill it with reviews.
*/
CREATE OR REPLACE FUNCTION venue_open_for_reviews(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM venue_partners vp
    WHERE vp.id = p_venue_id
      AND vp.approved AND vp.active
      AND vp.owner_id IS DISTINCT FROM auth.uid()
      AND vp.account_manager IS DISTINCT FROM auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION venue_open_for_reviews(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_open_for_reviews(uuid) TO authenticated;

ALTER TABLE venue_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_venue_reviews" ON venue_reviews;
CREATE POLICY "select_venue_reviews" ON venue_reviews FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_venue_review" ON venue_reviews;
CREATE POLICY "insert_own_venue_review" ON venue_reviews FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid() AND venue_open_for_reviews(venue_id));

DROP POLICY IF EXISTS "update_own_venue_review" ON venue_reviews;
CREATE POLICY "update_own_venue_review" ON venue_reviews FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Managers can take down abusive reviews.
DROP POLICY IF EXISTS "delete_venue_review" ON venue_reviews;
CREATE POLICY "delete_venue_review" ON venue_reviews FOR DELETE
  TO authenticated USING (user_id = auth.uid() OR is_manager());

/*
Timestamps are the server's; an edit can change the stars and the words but
not which venue or whose review it is. At most 5 new reviews a day each, so a
script can't farm credits or run up a venue's bill.
*/
CREATE OR REPLACE FUNCTION guard_venue_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT count(*) FROM venue_reviews
        WHERE user_id = NEW.user_id AND created_at > now() - interval '1 day') >= 5 THEN
      RAISE EXCEPTION 'You can post up to 5 reviews a day. Try again tomorrow.';
    END IF;
    NEW.created_at := now();
  ELSE
    NEW.venue_id := OLD.venue_id;
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.body := btrim(NEW.body);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_venue_review ON venue_reviews;
CREATE TRIGGER trg_guard_venue_review
  BEFORE INSERT OR UPDATE ON venue_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_venue_review();

/* A new review earns its credit (first time for this venue) and counts as a visit. */
CREATE OR REPLACE FUNCTION reward_venue_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO credit_ledger (user_id, delta, reason, ref)
  VALUES (NEW.user_id, 1, 'review', NEW.venue_id::text)
  ON CONFLICT DO NOTHING;
  INSERT INTO venue_events (venue_id, event_type, auth_uid, user_id)
  VALUES (NEW.venue_id, 'visited', NEW.user_id, NEW.user_id::text)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reward_venue_review ON venue_reviews;
CREATE TRIGGER trg_reward_venue_review
  AFTER INSERT ON venue_reviews
  FOR EACH ROW EXECUTE FUNCTION reward_venue_review();

/* A venue's reviews with who wrote them (profiles aren't readable across accounts). */
CREATE OR REPLACE FUNCTION venue_reviews_for(p_venue_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'rating', r.rating,
    'body', r.body,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'name', COALESCE(p.display_name, p.username, 'Someone'),
    'username', p.username,
    'mine', r.user_id = auth.uid()
  ) ORDER BY (r.user_id = auth.uid()) DESC, r.created_at DESC), '[]'::jsonb)
  FROM venue_reviews r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.venue_id = p_venue_id AND auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION venue_reviews_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_reviews_for(uuid) TO authenticated;

/* The Sponsored Venues page: live partners and their ratings, no contact details. */
CREATE OR REPLACE FUNCTION sponsored_venues()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', vp.id,
    'business_name', vp.business_name,
    'address', vp.address,
    'type', vp.type,
    'instagram_link', vp.instagram_link,
    'website', vp.website,
    'lat', vp.lat,
    'lon', vp.lon,
    'review_count', COALESCE(r.n, 0),
    'average_rating', COALESCE(r.avg, 0),
    'reviewed_by_me', COALESCE(r.mine, false),
    'can_review', vp.owner_id IS DISTINCT FROM auth.uid() AND vp.account_manager IS DISTINCT FROM auth.uid()
  ) ORDER BY vp.business_name), '[]'::jsonb)
  FROM venue_partners vp
  LEFT JOIN (
    SELECT venue_id, COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg, bool_or(user_id = auth.uid()) AS mine
    FROM venue_reviews GROUP BY venue_id
  ) r ON r.venue_id = vp.id
  WHERE vp.approved AND vp.active AND auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION sponsored_venues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sponsored_venues() TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 6. COMMISSION PAID
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS commission_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_user ON commission_payouts(user_id);

ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_commission_payouts" ON commission_payouts;
CREATE POLICY "select_commission_payouts" ON commission_payouts FOR SELECT
  TO authenticated USING (is_manager() OR user_id = auth.uid());
-- A payout recorded by mistake can be removed by a super admin.
DROP POLICY IF EXISTS "admin_delete_commission_payouts" ON commission_payouts;
CREATE POLICY "admin_delete_commission_payouts" ON commission_payouts FOR DELETE
  TO authenticated USING (is_admin());

CREATE OR REPLACE FUNCTION admin_record_payout(p_user uuid, p_amount_cents bigint, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Super admins only' USING ERRCODE = '42501';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'A payout is an amount over $0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user) THEN
    RAISE EXCEPTION 'No such team member';
  END IF;
  INSERT INTO commission_payouts (user_id, amount_cents, note, recorded_by)
  VALUES (p_user, p_amount_cents, NULLIF(btrim(coalesce(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION admin_record_payout(uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_record_payout(uuid, bigint, text) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 7. NUMBERS
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_partner_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_all boolean := is_manager();
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
  reviews AS (
    SELECT venue_id, COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM venue_reviews GROUP BY venue_id
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
      'contact_phone', vp.contact_phone,
      'instagram_link', vp.instagram_link,
      'website', vp.website,
      'monthly_budget_cents', vp.monthly_budget_cents,
      'visit_rate_cents', vp.visit_rate_cents,
      'active', vp.active,
      'approved', vp.approved,
      'rejection_reason', vp.rejection_reason,
      'has_account', vp.owner_id IS NOT NULL,
      'created_at', vp.created_at,
      'account_manager', vp.account_manager,
      'account_manager_name', mgr.display_name,
      'impressions', COALESCE(t.impressions, 0),
      'saves', COALESCE(t.saves, 0),
      'visits', COALESCE(t.visits, 0),
      'review_count', COALESCE(rv.n, 0),
      'average_rating', COALESCE(rv.avg, 0),
      'month_visits', COALESCE((SELECT b.visits FROM billed b WHERE b.venue_id = vp.id AND b.month = date_trunc('month', now())), 0),
      'month_billed_cents', COALESCE((SELECT b.cents FROM billed b WHERE b.venue_id = vp.id AND b.month = date_trunc('month', now())), 0),
      'total_billed_cents', COALESCE((SELECT SUM(b.cents) FROM billed b WHERE b.venue_id = vp.id), 0)
    ) AS row
    FROM venue_partners vp
    LEFT JOIN totals t ON t.venue_id = vp.id
    LEFT JOIN reviews rv ON rv.venue_id = vp.id
    LEFT JOIN profiles mgr ON mgr.id = vp.account_manager
    -- Workers see their own venues; managers and super admins see everyone's.
    WHERE v_all OR vp.account_manager = auth.uid()
  ) rows;

  RETURN v_result;
END;
$$;

/* One team member's venues, what they brought in, and their commission paid and owed. */
CREATE OR REPLACE FUNCTION sales_summary_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH mine AS (SELECT id, approved, active, rejection_reason FROM venue_partners WHERE account_manager = p_user),
  b AS (SELECT * FROM partner_billing() WHERE venue_id IN (SELECT id FROM mine)),
  ev AS (
    SELECT COUNT(*) FILTER (WHERE event_type = 'impression') AS impressions,
           COUNT(*) FILTER (WHERE event_type = 'visited') AS visits
    FROM venue_events WHERE venue_id IN (SELECT id FROM mine)
  ),
  pct AS (SELECT COALESCE(commission_percent, 0) AS p FROM profiles WHERE id = p_user),
  money AS (
    SELECT
      COALESCE((SELECT SUM(cents) FROM b WHERE month = date_trunc('month', now())), 0) AS month_billed,
      COALESCE((SELECT SUM(cents) FROM b), 0) AS total_billed,
      COALESCE((SELECT p FROM pct), 0) AS pct,
      COALESCE((SELECT SUM(amount_cents) FROM commission_payouts WHERE user_id = p_user), 0) AS paid
  )
  SELECT jsonb_build_object(
    'clients', (SELECT COUNT(*) FROM mine),
    'live', (SELECT COUNT(*) FROM mine WHERE approved AND active),
    'pending', (SELECT COUNT(*) FROM mine WHERE NOT approved AND rejection_reason IS NULL),
    'rejected', (SELECT COUNT(*) FROM mine WHERE NOT approved AND rejection_reason IS NOT NULL),
    'impressions', (SELECT impressions FROM ev),
    'visits', (SELECT visits FROM ev),
    'month_billed_cents', m.month_billed,
    'total_billed_cents', m.total_billed,
    'commission_percent', m.pct,
    'month_commission_cents', ROUND(m.month_billed * m.pct / 100),
    'total_commission_cents', ROUND(m.total_billed * m.pct / 100),
    'paid_cents', m.paid,
    'unpaid_cents', GREATEST(ROUND(m.total_billed * m.pct / 100) - m.paid, 0)
  )
  FROM money m;
$$;
REVOKE ALL ON FUNCTION sales_summary_for(uuid) FROM PUBLIC;

-- Managers see the team's numbers too; only a super admin changes the team.
CREATE OR REPLACE FUNCTION admin_team()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_manager() THEN
    RAISE EXCEPTION 'Managers only' USING ERRCODE = '42501';
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
    WHERE p.role IN ('staff', 'manager', 'admin')
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
    RAISE EXCEPTION 'Super admins only' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('user', 'staff', 'manager', 'admin') THEN
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

CREATE OR REPLACE FUNCTION admin_set_commission(p_user uuid, p_percent numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Super admins only' USING ERRCODE = '42501';
  END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 100 THEN
    RAISE EXCEPTION 'Commission is a percentage from 0 to 100';
  END IF;
  UPDATE profiles SET commission_percent = p_percent WHERE id = p_user AND role IN ('staff', 'manager', 'admin');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only team members earn commission';
  END IF;
END;
$$;
