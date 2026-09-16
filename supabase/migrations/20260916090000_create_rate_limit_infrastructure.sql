/*
# Rate limiting for edge functions

## Why
ai-proxy, geocode, travel-times, resolve-place and extract-venue-meta all spend
money per call (OpenRouter, Google Maps). Authentication alone bounds *who* can
call them, not *how often*, so a stolen session or a runaway client loop can
still run up a bill. Counting in Postgres makes the limit hold across edge
instances, which an in-memory counter cannot.

## Design
Fixed window. Each (bucket, subject) pair gets a row; the window resets when
the stored window_start falls outside the requested window. Callers treat a
failure of this function as "allow" — these limits bound cost abuse, they are
not an authorisation control, and they should never take the app down.
*/

CREATE TABLE IF NOT EXISTS edge_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE edge_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) may touch this.

CREATE INDEX IF NOT EXISTS idx_edge_rate_limits_updated_at
  ON edge_rate_limits (updated_at);

CREATE OR REPLACE FUNCTION consume_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
RETURNS TABLE (allowed boolean, remaining int, retry_after int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_row edge_rate_limits%ROWTYPE;
BEGIN
  INSERT INTO edge_rate_limits AS t (key, window_start, count, updated_at)
  VALUES (p_key, v_now, 1, v_now)
  ON CONFLICT (key) DO UPDATE
    SET
      -- Reset the window if the stored one has expired, else increment.
      window_start = CASE
        WHEN t.window_start < v_now - make_interval(secs => p_window_seconds)
        THEN v_now ELSE t.window_start END,
      count = CASE
        WHEN t.window_start < v_now - make_interval(secs => p_window_seconds)
        THEN 1 ELSE t.count + 1 END,
      updated_at = v_now
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.count <= p_limit,
    GREATEST(p_limit - v_row.count, 0),
    GREATEST(
      CEIL(EXTRACT(EPOCH FROM (
        v_row.window_start + make_interval(secs => p_window_seconds) - v_now
      )))::int,
      0
    );
END;
$$;

-- Only the service role calls this; browsers must never reach it.
REVOKE ALL ON FUNCTION consume_rate_limit(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_rate_limit(text, int, int) FROM anon, authenticated;

/*
Housekeeping: rows are tiny and self-resetting, but stale keys accumulate.
If pg_cron is available, schedule:
  SELECT cron.schedule('purge-edge-rate-limits', '0 4 * * *',
    $$DELETE FROM edge_rate_limits WHERE updated_at < now() - interval '7 days'$$);
*/
