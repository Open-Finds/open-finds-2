/*
# "How was it?" reminders after an event

Robert (2026-10-14): after an event has passed, notify people to leave a
review and earn credits.

- An event has ended an hour after its last stop's time (or 4 hours after
  its start when it has one stop), read in Sydney time, like the app's
  countdown.
- Reviews and their credits are for sponsored venues, so an event is only
  reminded about when it included one; otherwise the reminder would promise
  credits there's no way to earn.
- Who: the host and everyone signed in who said "I'm in". Not someone who
  owns or looks after the venue, and not someone who's already reviewed
  every sponsored venue on it.
- Once per person per event (review_reminders), and only from 9am to 9pm
  Sydney time, so a late night doesn't end with a 1am buzz. Events from more
  than 3 days ago are left alone.
- An hourly job (pg_cron) calls the review-reminders function, which writes
  the in-app notification and sends the push.
*/

-- ════════════════════════════════════════════════════════════
-- 1. WHICH STOP IS WHICH SPONSORED VENUE
-- ════════════════════════════════════════════════════════════

-- Set when a stop is picked from Sponsored Venues; older stops match by name.
ALTER TABLE stops ADD COLUMN IF NOT EXISTS venue_partner_id uuid REFERENCES venue_partners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stops_venue_partner ON stops(venue_partner_id) WHERE venue_partner_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 2. WHO HAS BEEN REMINDED
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS review_reminders (
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, user_id)
);
ALTER TABLE review_reminders ENABLE ROW LEVEL SECURITY;
-- No policies: only the reminder job (service role) reads or writes it.

-- ════════════════════════════════════════════════════════════
-- 3. WHO IS DUE ONE NOW
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION due_review_reminders(p_ignore_quiet_hours boolean DEFAULT false)
RETURNS TABLE (plan_id uuid, user_id uuid, plan_title text, venue_names text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sydney_hour AS (
    SELECT extract(hour FROM now() AT TIME ZONE 'Australia/Sydney')::int AS h
  ),
  ended AS (
    SELECT p.id, p.title, p.owner_id,
      (p.date::timestamp + CASE
         WHEN max(s.time::time) > min(s.time::time) THEN max(s.time::time) + interval '1 hour'
         ELSE min(s.time::time) + interval '4 hours'
       END) AT TIME ZONE 'Australia/Sydney' AS ends_at
    FROM plans p
    JOIN stops s ON s.plan_id = p.id
    WHERE NOT p.canceled
      AND p.date BETWEEN (now() AT TIME ZONE 'Australia/Sydney')::date - 4 AND (now() AT TIME ZONE 'Australia/Sydney')::date
      AND s.time ~ '^\d{1,2}:\d{2}'
    GROUP BY p.id
  ),
  sponsored AS (
    SELECT DISTINCT e.id AS plan_id, vp.id AS venue_id, vp.business_name, vp.owner_id, vp.account_manager
    FROM ended e
    JOIN stops s ON s.plan_id = e.id
    JOIN venue_partners vp
      ON vp.approved AND vp.active
     AND (s.venue_partner_id = vp.id OR (s.venue_partner_id IS NULL AND lower(btrim(s.name)) = lower(btrim(vp.business_name))))
    WHERE e.ends_at + interval '1 hour' <= now()
      AND e.ends_at >= now() - interval '3 days'
  ),
  people AS (
    SELECT e.id AS plan_id, e.owner_id AS user_id FROM ended e WHERE e.owner_id IS NOT NULL
    UNION
    SELECT r.plan_id, r.auth_uid FROM rsvps r JOIN ended e ON e.id = r.plan_id WHERE r.status = 'in' AND r.auth_uid IS NOT NULL
  )
  SELECT pe.plan_id, pe.user_id, e.title, array_agg(DISTINCT sp.business_name ORDER BY sp.business_name)
  FROM people pe
  JOIN ended e ON e.id = pe.plan_id
  JOIN sponsored sp ON sp.plan_id = pe.plan_id
  WHERE (p_ignore_quiet_hours OR (SELECT h FROM sydney_hour) BETWEEN 9 AND 20)
    -- Not their own venue, and not one they've already reviewed.
    AND sp.owner_id IS DISTINCT FROM pe.user_id
    AND sp.account_manager IS DISTINCT FROM pe.user_id
    AND NOT EXISTS (SELECT 1 FROM venue_reviews vr WHERE vr.venue_id = sp.venue_id AND vr.user_id = pe.user_id)
    AND NOT EXISTS (SELECT 1 FROM review_reminders rr WHERE rr.plan_id = pe.plan_id AND rr.user_id = pe.user_id)
  GROUP BY pe.plan_id, pe.user_id, e.title;
$$;

REVOKE ALL ON FUNCTION due_review_reminders(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION due_review_reminders(boolean) TO service_role;

-- ════════════════════════════════════════════════════════════
-- 4. EVERY HOUR
-- ════════════════════════════════════════════════════════════

-- The job proves itself to the function with this, not with a service key.
INSERT INTO app_secrets (key, value)
VALUES ('CRON_SECRET', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

/*
pg_cron and pg_net come with Supabase (Database → Extensions). Skipped
where they aren't available, as in the test database, so the rest of this
migration still applies.
*/
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    CREATE EXTENSION IF NOT EXISTS pg_net;
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'review-reminders';
    PERFORM cron.schedule(
      'review-reminders',
      '5 * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://wfrlkifdlgmlbffumglt.supabase.co/functions/v1/review-reminders',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET')
          ),
          body := '{}'::jsonb
        );
      $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron / pg_net not available: review reminders are not scheduled';
  END IF;
END
$outer$;
