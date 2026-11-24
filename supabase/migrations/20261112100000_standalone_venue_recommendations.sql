-- Keep legacy saved-venue recommendations and add authenticated standalone snapshots.
alter table public.venue_recommendations
  alter column venue_id drop not null,
  add column publisher_id uuid references auth.users(id) on delete cascade,
  add column snapshot_key bytea,
  add constraint venue_recommendation_origin check (
    (venue_id is not null and publisher_id is null and snapshot_key is null)
    or (venue_id is null and publisher_id is not null and snapshot_key is not null)
  ),
  add constraint venue_recommendation_publisher_snapshot unique (publisher_id, snapshot_key);

create function public.publish_standalone_venue_recommendation(p_venue jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  venue_name text := btrim(p_venue->>'name');
  venue_address text := btrim(p_venue->>'address');
  venue_type text := p_venue->>'type';
  source_link text;
  public_snapshot jsonb;
  recommendation_id uuid;
begin
  if caller is null then
    raise exception 'Sign in to publish a venue recommendation' using errcode = '42501';
  end if;
  if jsonb_typeof(p_venue) is distinct from 'object'
    or jsonb_typeof(p_venue->'name') is distinct from 'string'
    or jsonb_typeof(p_venue->'address') is distinct from 'string'
    or char_length(venue_name) not between 1 and 200
    or char_length(venue_address) not between 1 and 500
    or venue_name ~ '[[:cntrl:]]' or venue_address ~ '[[:cntrl:]]'
    or venue_type is null or venue_type not in ('food', 'bar', 'dessert', 'activity') then
    raise exception 'Invalid venue recommendation details' using errcode = '22023';
  end if;

  -- Only public post URLs are included. Strip fragments and tracking parameters.
  if jsonb_typeof(p_venue->'link') = 'string' and char_length(p_venue->>'link') <= 2048 then
    source_link := rtrim(split_part(split_part(p_venue->>'link', '?', 1), '#', 1), '/');
    if source_link !~ '^https://((www\.)?instagram\.com/(reels?|p|tv)/[A-Za-z0-9_-]+|(www\.)?tiktok\.com/@[A-Za-z0-9_.-]+/video/[0-9]+|(vm|vt)\.tiktok\.com/[A-Za-z0-9]+)$' then
      source_link := null;
    end if;
  end if;

  public_snapshot := jsonb_build_object(
    'name', venue_name, 'address', venue_address, 'type', venue_type, 'link', source_link
  );

  insert into public.venue_recommendations (publisher_id, snapshot_key, snapshot)
    values (caller, sha256(convert_to(public_snapshot::text, 'UTF8')), public_snapshot)
  on conflict on constraint venue_recommendation_publisher_snapshot
    do update set snapshot_key = excluded.snapshot_key
  returning id into recommendation_id;

  return recommendation_id;
end;
$$;

revoke all on function public.publish_standalone_venue_recommendation(jsonb) from public, anon;
grant execute on function public.publish_standalone_venue_recommendation(jsonb) to authenticated;
