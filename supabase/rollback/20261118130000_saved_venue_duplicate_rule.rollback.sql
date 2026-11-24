-- ROLLBACK for supabase/migrations/20261118130000_saved_venue_duplicate_rule.sql
-- Undoes: the one-saved-venue-per-name-and-address rule, the legacy_duplicate flag, and the name-and-address matching in save_shared_venue
-- Data effect: drops the legacy_duplicate flag column (it only records which old duplicates were flagged; no venue rows are deleted)
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

DROP INDEX IF EXISTS public.saved_venues_one_per_venue;
DROP TRIGGER IF EXISTS saved_venues_lock_legacy_flag ON public.saved_venues;
DROP FUNCTION IF EXISTS public.lock_saved_venue_legacy_flag();
ALTER TABLE public.saved_venues DROP COLUMN IF EXISTS legacy_duplicate;

-- Put back the link-matching save_shared_venue from 20261108120000 (only if AI Save is installed).
DO $outer$
BEGIN
  IF to_regprocedure('public.save_shared_venue(jsonb)') IS NOT NULL THEN
    EXECUTE $restore$
create or replace function public.save_shared_venue(p_venue jsonb)
returns public.saved_venues
language plpgsql security invoker set search_path = ''
as $$
declare
  caller text := auth.uid()::text;
  source text := p_venue->>'link';
  result public.saved_venues;
begin
  if caller is null then raise exception 'Sign in to save a shared venue'; end if;
  if source is null or length(source) > 2048 or source !~ '^https://'
    or coalesce(btrim(p_venue->>'name'), '') = ''
    or coalesce(btrim(p_venue->>'address'), '') = '' then
    raise exception 'A venue name, address, and HTTPS source are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller || ':' || source, 0));
  select * into result from public.saved_venues
    where user_id = caller and (link = source or (
      source ~ '^https://([a-zA-Z0-9-]+\.)*(instagram\.com|tiktok\.com)/'
      and split_part(split_part(link, '?', 1), '#', 1) = source))
    order by created_at, id limit 1;
  if found then return result; end if;
  insert into public.saved_venues (user_id, name, address, type, link, lat, lon)
    values (caller, btrim(p_venue->>'name'), btrim(p_venue->>'address'), p_venue->>'type',
      source, (p_venue->>'lat')::double precision, (p_venue->>'lon')::double precision)
    returning * into result;
  return result;
end;
$$;
    $restore$;
  END IF;
END
$outer$;
