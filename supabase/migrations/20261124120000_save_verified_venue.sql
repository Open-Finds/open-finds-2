/*
# Universal venues, Phase 2: new saves link to the shared venue

`save_verified_venue` saves a Google-confirmed venue for one person and links
the save to the shared `venues` record, creating that record the first time
anyone saves the place.

## Who may call it
Only the service role, from the `save-verified-venue` edge function. That
function has already checked the caller's session and a signed venue stamp
issued by `resolve-place`, so `p_place` holds Google's own details, never text
typed in the app. Signed-in and signed-out users cannot run it directly.

## Two kinds of text
The shared venue always takes Google's name and address. The person's own save
takes the name and address the app showed them (`p_save`), which may be tidied
(for example full-width digits), so it matches what they saved before. Those
are personal text only; they never reach the shared venue.

## What it does, in one transaction
1. Adds or refreshes the shared venue by Google place id (name, address,
   suburb and pin follow Google; the category is set once, when created).
2. If this person already has a save linked to that venue, returns it.
3. Otherwise, if they already saved the same name and address (an older,
   unlinked save), links that save and returns it.
4. Otherwise saves the venue, linked.
Serialised with the same lock key as `save_shared_venue`, so retries and
double taps on either path cannot create two rows.

## Link protection change
A person may still edit their own save. If they change its address, the link
is cleared (the save may no longer be that place); renaming keeps the link.

Rollback: supabase/rollback/20261124120000_save_verified_venue.rollback.sql
*/

CREATE FUNCTION public.save_verified_venue(p_user uuid, p_place jsonb, p_save jsonb)
RETURNS public.saved_venues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller text := p_user::text;
  place_id text := p_place->>'google_place_id';
  place_name text := btrim(p_place->>'name');
  place_address text := btrim(p_place->>'address');
  place_suburb text := nullif(btrim(coalesce(p_place->>'suburb', '')), '');
  place_category text := p_place->>'category';
  place_lat double precision;
  place_lon double precision;
  save_name text := btrim(p_save->>'name');
  save_address text := btrim(p_save->>'address');
  source_link text := p_save->>'link';
  save_type text := p_save->>'type';
  venue uuid;
  result public.saved_venues;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'A user is required' USING errcode = '22023';
  END IF;
  IF jsonb_typeof(p_place->'lat') IS DISTINCT FROM 'number' OR jsonb_typeof(p_place->'lon') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid venue details' USING errcode = '22023';
  END IF;
  place_lat := (p_place->>'lat')::double precision;
  place_lon := (p_place->>'lon')::double precision;
  IF place_id IS NULL OR char_length(place_id) NOT BETWEEN 10 AND 300 OR place_id !~ '^[A-Za-z0-9_-]+$'
    OR coalesce(char_length(place_name), 0) NOT BETWEEN 1 AND 200
    OR coalesce(char_length(place_address), 0) NOT BETWEEN 1 AND 500
    OR place_category IS NULL
    OR place_category NOT IN ('food', 'dessert', 'cafe', 'bar', 'nightlife', 'activity', 'outdoors') THEN
    RAISE EXCEPTION 'Invalid venue details' USING errcode = '22023';
  END IF;
  IF coalesce(char_length(save_name), 0) NOT BETWEEN 1 AND 200 THEN save_name := place_name; END IF;
  IF coalesce(char_length(save_address), 0) NOT BETWEEN 1 AND 500 THEN save_address := place_address; END IF;
  IF source_link IS NOT NULL AND (char_length(source_link) > 2048 OR source_link !~ '^https://') THEN
    source_link := NULL;
  END IF;
  IF save_type IS NULL OR save_type NOT IN ('food', 'dessert', 'bar', 'activity') THEN
    save_type := CASE place_category
      WHEN 'cafe' THEN 'food' WHEN 'nightlife' THEN 'bar' WHEN 'outdoors' THEN 'activity' ELSE place_category END;
  END IF;

  INSERT INTO public.venues (google_place_id, name, address, suburb, lat, lon, category, verification, verified_at)
    VALUES (place_id, place_name, place_address, place_suburb, place_lat, place_lon, place_category, 'google_verified', now())
  ON CONFLICT (google_place_id) DO UPDATE SET
    name = excluded.name,
    address = excluded.address,
    suburb = coalesce(excluded.suburb, public.venues.suburb),
    lat = excluded.lat,
    lon = excluded.lon,
    verification = 'google_verified',
    verified_at = excluded.verified_at
  RETURNING id INTO venue;

  -- Same key as save_shared_venue: one save per person per name and address at a time.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    caller || ':' || lower(save_name) || ':' || lower(save_address), 0));

  SELECT * INTO result FROM public.saved_venues
    WHERE user_id = caller AND venue_id = venue
    ORDER BY legacy_duplicate, created_at, id LIMIT 1;
  IF found THEN RETURN result; END IF;

  SELECT * INTO result FROM public.saved_venues
    WHERE user_id = caller
      AND lower(btrim(name)) = lower(save_name)
      AND lower(btrim(address)) = lower(save_address)
    ORDER BY legacy_duplicate, created_at, id LIMIT 1;
  IF found THEN
    IF result.venue_id IS NULL THEN
      UPDATE public.saved_venues SET venue_id = venue WHERE id = result.id RETURNING * INTO result;
    END IF;
    RETURN result;
  END IF;

  INSERT INTO public.saved_venues (user_id, name, address, type, link, lat, lon, venue_id)
    VALUES (caller, save_name, save_address, save_type, source_link, place_lat, place_lon, venue)
    RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Supabase gives the API roles EXECUTE on new functions by default: close it.
REVOKE ALL ON FUNCTION public.save_verified_venue(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_venue(uuid, jsonb, jsonb) TO service_role;

-- People still cannot set a link; changing a save's address now clears it.
CREATE OR REPLACE FUNCTION public.lock_saved_venue_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.venue_id := NULL;
    ELSIF lower(btrim(NEW.address)) IS DISTINCT FROM lower(btrim(OLD.address)) THEN
      NEW.venue_id := NULL;
    ELSE
      NEW.venue_id := OLD.venue_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_saved_venue_link() FROM PUBLIC, anon, authenticated;
