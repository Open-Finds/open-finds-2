-- Stage 1 task S1-06: one saved venue per person per name and address.
--
-- Before this, nothing stopped a person saving the same venue twice (manual saves
-- always inserted), and save_shared_venue matched on the source link alone, so a
-- second, different venue found in the same post was dropped and the first venue
-- was returned as if it had been saved.
--
-- Existing duplicates are kept. Every row after the first in a group is flagged
-- legacy_duplicate and exempted from the rule, so no user data is deleted and the
-- migration cannot fail on data it did not expect (staging had 1 pair; production
-- has not been counted). People can delete legacy duplicates themselves.
--
-- Rollback (nothing is lost by it):
--   DROP INDEX public.saved_venues_one_per_venue;
--   DROP TRIGGER saved_venues_lock_legacy_flag ON public.saved_venues;
--   DROP FUNCTION public.lock_saved_venue_legacy_flag();
--   ALTER TABLE public.saved_venues DROP COLUMN legacy_duplicate;
--   and restore save_shared_venue from 20261108120000_ai_save_quick_share.sql.

ALTER TABLE public.saved_venues
  ADD COLUMN IF NOT EXISTS legacy_duplicate boolean NOT NULL DEFAULT false;

-- Flag every duplicate after the earliest saved one. Identical to the rule below.
UPDATE public.saved_venues v
SET legacy_duplicate = true
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, lower(btrim(name)), lower(btrim(address))
           ORDER BY created_at, id
         ) AS n
  FROM public.saved_venues
) d
WHERE v.id = d.id AND d.n > 1;

-- People must not be able to set or clear the flag themselves, or they could
-- bypass the rule. Inserts always start false; updates keep the stored value.
CREATE FUNCTION public.lock_saved_venue_legacy_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.legacy_duplicate := false;
  ELSE
    NEW.legacy_duplicate := OLD.legacy_duplicate;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_saved_venue_legacy_flag() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER saved_venues_lock_legacy_flag
BEFORE INSERT OR UPDATE ON public.saved_venues
FOR EACH ROW EXECUTE FUNCTION public.lock_saved_venue_legacy_flag();

CREATE UNIQUE INDEX saved_venues_one_per_venue
  ON public.saved_venues (user_id, lower(btrim(name)), lower(btrim(address)))
  WHERE NOT legacy_duplicate;

-- The same venue returns the saved row; a different venue from the same link is
-- saved as its own venue. Serialised per account and venue so retries and double
-- taps cannot create two rows.
CREATE OR REPLACE FUNCTION public.save_shared_venue(p_venue jsonb)
RETURNS public.saved_venues
LANGUAGE plpgsql
SET search_path = ''
AS $$
declare
  caller text := auth.uid()::text;
  source text := p_venue->>'link';
  venue_name text := btrim(p_venue->>'name');
  venue_address text := btrim(p_venue->>'address');
  result public.saved_venues;
begin
  if caller is null then raise exception 'Sign in to save a shared venue'; end if;
  if source is null or length(source) > 2048 or source !~ '^https://'
    or coalesce(venue_name, '') = ''
    or coalesce(venue_address, '') = '' then
    raise exception 'A venue name, address, and HTTPS source are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    caller || ':' || lower(venue_name) || ':' || lower(venue_address), 0));
  select * into result from public.saved_venues
    where user_id = caller
      and lower(btrim(name)) = lower(venue_name)
      and lower(btrim(address)) = lower(venue_address)
    order by legacy_duplicate, created_at, id limit 1;
  if found then return result; end if;
  insert into public.saved_venues (user_id, name, address, type, link, lat, lon)
    values (caller, venue_name, venue_address, p_venue->>'type',
      source, (p_venue->>'lat')::double precision, (p_venue->>'lon')::double precision)
    returning * into result;
  return result;
end;
$$;
