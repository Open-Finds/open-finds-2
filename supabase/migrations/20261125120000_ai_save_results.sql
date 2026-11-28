/*
# AI Save results: did the app find the right venue?

One row per AI Save attempt, so the success rate can be tracked. It records what AI Save did
(confirmed by Google, picked from choices, typed by hand...), how the venue was found, the signals
that need no tap (the person edited the result, used "None of these match", pasted a caption),
and the person's own 👍 or 👎 with a one-tap reason. The link is kept so a failed post can be
re-run and added to the test set. The post's caption is never stored.

## Who can do what
- A signed-in person writes and reads only their own rows (one row per attempt; a later write
  for the same attempt updates it, which is how a 👍 or 👎 is added or changed).
- An admin (`is_admin()`) can read every row, for the success-rate page. Nobody can delete rows
  from the app; rows go when the account goes.
- Not callable by `anon`.

## Limits
- At most 300 new rows per person per day, so a broken or abusive client cannot fill the table.
- Notes are capped at 200 characters; the reason can only be set with a 👎.

Rollback: DROP TABLE public.ai_save_results; DROP FUNCTION public.ai_save_results_guard();
*/

CREATE TABLE public.ai_save_results (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  platform text NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'youtube', 'maps', 'website', 'other')),
  post_kind text NOT NULL DEFAULT 'unknown' CHECK (post_kind IN ('video', 'photo', 'post', 'unknown')),
  link text CHECK (link IS NULL OR char_length(link) <= 2048),
  outcome text NOT NULL CHECK (outcome IN ('confirmed', 'chosen', 'searched', 'unconfirmed', 'manual', 'multiple', 'not_saved')),
  found_by text NOT NULL DEFAULT 'ai' CHECK (found_by IN ('caption', 'shared_text', 'pasted_caption', 'ai', 'manual')),
  venue_name text CHECK (venue_name IS NULL OR char_length(venue_name) <= 200),
  venue_count integer NOT NULL DEFAULT 1 CHECK (venue_count BETWEEN 0 AND 20),
  saved_venue_id uuid REFERENCES public.saved_venues(id) ON DELETE SET NULL,
  edited boolean NOT NULL DEFAULT false,
  used_none_of_these boolean NOT NULL DEFAULT false,
  used_pasted_caption boolean NOT NULL DEFAULT false,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  rating text CHECK (rating IN ('like', 'dislike')),
  reason text CHECK (reason IN ('wrong_venue', 'wrong_address', 'missing_venue', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  PRIMARY KEY (user_id, attempt_id),
  CONSTRAINT ai_save_results_reason_needs_dislike CHECK (reason IS NULL OR rating = 'dislike')
);

COMMENT ON TABLE public.ai_save_results IS
  'One row per AI Save attempt: what it did, how the venue was found, and the person''s own thumbs up or down. For the success rate.';

CREATE INDEX ai_save_results_created_idx ON public.ai_save_results (created_at DESC);
CREATE INDEX ai_save_results_rating_idx ON public.ai_save_results (rating) WHERE rating IS NOT NULL;

-- Keeps who and when fixed, stamps updates, and caps new rows per person per day.
CREATE FUNCTION public.ai_save_results_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT count(*) FROM public.ai_save_results r
          WHERE r.user_id = NEW.user_id AND r.created_at > now() - interval '1 day') >= 300 THEN
      RAISE EXCEPTION 'Too many AI Save results today' USING errcode = '54000';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSE
    NEW.user_id := OLD.user_id;
    NEW.attempt_id := OLD.attempt_id;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_save_results_guard
BEFORE INSERT OR UPDATE ON public.ai_save_results
FOR EACH ROW EXECUTE FUNCTION public.ai_save_results_guard();

ALTER TABLE public.ai_save_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_save_results FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.ai_save_results TO authenticated;

CREATE POLICY "own_select_ai_save_results" ON public.ai_save_results FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin_select_ai_save_results" ON public.ai_save_results FOR SELECT
  TO authenticated USING (is_admin());
CREATE POLICY "own_insert_ai_save_results" ON public.ai_save_results FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_update_ai_save_results" ON public.ai_save_results FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
