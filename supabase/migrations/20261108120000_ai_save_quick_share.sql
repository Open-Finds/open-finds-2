-- Serialize writes from the share workflow for the same account and source URL.
create function public.save_shared_venue(p_venue jsonb)
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
revoke all on function public.save_shared_venue(jsonb) from public, anon;
grant execute on function public.save_shared_venue(jsonb) to authenticated;

create table public.venue_recommendations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null unique references public.saved_venues(id) on delete cascade,
  snapshot jsonb not null
);
alter table public.venue_recommendations enable row level security;
revoke all on public.venue_recommendations from public, anon, authenticated;

create function public.publish_venue_recommendation(p_venue_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  venue public.saved_venues;
  result uuid;
begin
  select * into venue from public.saved_venues
    where id = p_venue_id and user_id = auth.uid()::text;
  if not found then raise exception 'Venue not found'; end if;
  insert into public.venue_recommendations (venue_id, snapshot)
    values (venue.id, jsonb_build_object('name', venue.name, 'address', venue.address,
      'type', venue.type, 'link', case
        when venue.link ~ '^https://([a-zA-Z0-9-]+\.)*(instagram\.com|tiktok\.com)/'
        then split_part(split_part(venue.link, '?', 1), '#', 1) end))
    on conflict (venue_id) do update set snapshot = excluded.snapshot
    returning id into result;
  return result;
end;
$$;
revoke all on function public.publish_venue_recommendation(uuid) from public, anon;
grant execute on function public.publish_venue_recommendation(uuid) to authenticated;

create function public.read_venue_recommendation(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select snapshot from public.venue_recommendations where id = p_id;
$$;
revoke all on function public.read_venue_recommendation(uuid) from public;
grant execute on function public.read_venue_recommendation(uuid) to anon, authenticated;
