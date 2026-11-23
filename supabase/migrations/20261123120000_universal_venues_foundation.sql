/*
# Universal venues, Phase 1: schema foundation

One shared record per physical venue (`venues`), linked from each person's own
save (`saved_venues.venue_id`). This migration only adds structure:

- No existing row is changed: every `saved_venues.venue_id` starts empty.
- Nothing in the app reads or writes the new table or column yet.
- No brands table yet (deferred to the partner / Our Picks phase, 2026-11-23).

## venues
- `google_place_id`: Google's id for the physical place. Unique, so two
  branches of a franchise (different place ids) stay separate records and the
  same branch is never stored twice. Optional so a venue can later be verified
  another way, but a `google_verified` venue must have one.
- `category`: the app's seven categories (src/lib/taxonomy.ts CATEGORIES).
  The key `outdoors` is shown as "Nature"; keys never change with labels.
- `suburb`: needed for Our Picks (same category and suburb). Optional until the
  save workflow fills it from Google's address parts.
- No photo column: storing Google content long-term is still an open question
  (Google Maps Platform terms), so the photo stays on each save for now.

## Who can do what
- Signed-in users may read venues (public facts about a place, no personal data).
- Signed-out users have no access to the table.
- Nobody may insert, update or delete venues through the API. Later phases
  write them only from trusted server code that has checked the caller and
  verified the place with Google.
- A person cannot set or change `saved_venues.venue_id` themselves (a trigger
  keeps the stored value), so a save can only be linked by trusted code. This
  stops someone attaching their save to an unrelated venue.
- Deleting a venue never deletes anyone's save: the link is cleared instead.

## Rule
One save per person per venue: (user_id, venue_id) is unique for linked rows.
Rows already flagged `legacy_duplicate` are exempt, matching the existing
name-and-address rule (20261118130000). Staging has no linked rows, so this
cannot fail on existing data.

Rollback: supabase/rollback/20261123120000_universal_venues_foundation.rollback.sql
*/

CREATE TABLE public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id text UNIQUE
    -- Length is checked separately: Postgres regexes allow at most 255 repeats.
    CHECK (char_length(google_place_id) BETWEEN 10 AND 300 AND google_place_id ~ '^[A-Za-z0-9_-]+$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 1 AND 500),
  suburb text CHECK (suburb IS NULL OR char_length(btrim(suburb)) BETWEEN 1 AND 100),
  lat double precision CHECK (lat BETWEEN -90 AND 90),
  lon double precision CHECK (lon BETWEEN -180 AND 180),
  category text NOT NULL
    CHECK (category IN ('food', 'dessert', 'cafe', 'bar', 'nightlife', 'activity', 'outdoors')),
  verification text NOT NULL DEFAULT 'unverified'
    CHECK (verification IN ('google_verified', 'unverified')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venues_coordinates_together CHECK ((lat IS NULL) = (lon IS NULL)),
  CONSTRAINT venues_verified_has_place_id
    CHECK (verification <> 'google_verified' OR (google_place_id IS NOT NULL AND verified_at IS NOT NULL))
);

COMMENT ON TABLE public.venues IS
  'One record per physical venue, shared by everyone who saves it. Personal data stays in saved_venues.';

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

-- Supabase grants every API role full access to new tables by default; close
-- that and open only reading to signed-in users.
REVOKE ALL ON public.venues FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venues TO authenticated;

CREATE POLICY "signed_in_read_venues" ON public.venues FOR SELECT
  TO authenticated USING (true);

CREATE FUNCTION public.touch_venue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_venue_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER venues_touch_updated_at
BEFORE UPDATE ON public.venues
FOR EACH ROW EXECUTE FUNCTION public.touch_venue_updated_at();

-- The link from a person's save to the shared venue.
ALTER TABLE public.saved_venues
  ADD COLUMN venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL;

CREATE INDEX idx_saved_venues_venue_id ON public.saved_venues (venue_id)
  WHERE venue_id IS NOT NULL;

CREATE UNIQUE INDEX saved_venues_one_per_canonical_venue
  ON public.saved_venues (user_id, venue_id)
  WHERE venue_id IS NOT NULL AND NOT legacy_duplicate;

-- People must not link their own saves. Requests from the app run as the anon
-- or authenticated role; trusted server code (service role, or a SECURITY
-- DEFINER function owned by postgres) runs as another role and may set it.
CREATE FUNCTION public.lock_saved_venue_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.venue_id := NULL;
    ELSE
      NEW.venue_id := OLD.venue_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_saved_venue_link() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER saved_venues_lock_venue_link
BEFORE INSERT OR UPDATE ON public.saved_venues
FOR EACH ROW EXECUTE FUNCTION public.lock_saved_venue_link();
