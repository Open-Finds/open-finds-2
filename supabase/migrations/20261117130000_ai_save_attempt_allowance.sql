-- Testing allowance for AI Save on staging: N complete attempts per user per
-- rolling window, counted once however many edge functions the attempt calls.
--
-- Used only by the staging provider controls (supabase/functions/_shared/
-- stagingProviders.ts) when STAGING_PROVIDER_ACCESS=open. Nothing else reads it,
-- the existing staging_provider_* ledger is untouched, and on any project that
-- never calls the function the table stays empty.
--
-- An attempt is one AI Save dialog session, identified by an id the app creates.
-- The first paid provider call of any request in the attempt claims it:
--   * a new id uses one slot of the allowance (refused when the user is at the limit);
--   * an id seen before in the window is free, up to a per-attempt request cap;
--   * an id older than the window is refused, never renewed.
-- Every claim takes a per-user lock, so counting and recording cannot interleave.

create table public.ai_save_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  created_at timestamptz not null default now(),
  requests integer not null default 1 check (requests > 0),
  primary key (user_id, attempt_id)
);

create index ai_save_attempts_user_created_idx on public.ai_save_attempts (user_id, created_at desc);

-- Locked down: only the security-definer function below (called by the edge
-- functions with the service role) reads or writes this table.
alter table public.ai_save_attempts enable row level security;
revoke all on public.ai_save_attempts from public, anon, authenticated;

create function public.claim_ai_save_attempt(
  p_user uuid,
  p_attempt uuid,
  p_limit integer default 20,
  p_window_seconds integer default 1800,
  p_max_requests integer default 12
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_window interval;
  v_row public.ai_save_attempts;
  v_used integer;
  v_requests integer;
  v_oldest timestamptz;
begin
  if p_user is null or p_attempt is null
    or p_limit is null or p_limit not between 1 and 100
    or p_window_seconds is null or p_window_seconds not between 60 and 86400
    or p_max_requests is null or p_max_requests not between 1 and 50 then
    return jsonb_build_object('allowed', false, 'code', 'invalid_claim');
  end if;
  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  -- One claim per user at a time, so two new attempts cannot both take the last slot
  -- and two requests of one attempt cannot both take the last request.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai_save_attempts:' || p_user::text, 0));

  -- Housekeeping without a scheduler: this user's rows past twice the window (at least a day) go.
  delete from public.ai_save_attempts
    where user_id = p_user and created_at < now() - greatest(interval '24 hours', v_window * 2);

  select * into v_row from public.ai_save_attempts where user_id = p_user and attempt_id = p_attempt;
  if found then
    if v_row.created_at <= now() - v_window then
      return jsonb_build_object('allowed', false, 'code', 'attempt_expired');
    end if;
    if v_row.requests >= p_max_requests then
      return jsonb_build_object('allowed', false, 'code', 'attempt_request_limit');
    end if;
    update public.ai_save_attempts set requests = requests + 1
      where user_id = p_user and attempt_id = p_attempt
      returning requests into v_requests;
    return jsonb_build_object('allowed', true, 'counted', false, 'requests', v_requests);
  end if;

  select count(*) into v_used from public.ai_save_attempts
    where user_id = p_user and created_at > now() - v_window;
  if v_used >= p_limit then
    -- The slot frees when enough of the oldest counted attempts have aged out
    -- for the count to drop below the limit.
    select created_at into v_oldest from public.ai_save_attempts
      where user_id = p_user and created_at > now() - v_window
      order by created_at asc offset (v_used - p_limit) limit 1;
    return jsonb_build_object(
      'allowed', false, 'code', 'testing_limit', 'limit', p_limit,
      'retry_after', greatest(ceil(extract(epoch from (v_oldest + v_window - now())))::integer, 1)
    );
  end if;

  insert into public.ai_save_attempts (user_id, attempt_id, created_at, requests)
    values (p_user, p_attempt, now(), 1);
  return jsonb_build_object('allowed', true, 'counted', true, 'requests', 1, 'remaining', p_limit - v_used - 1);
end;
$$;

revoke all on function public.claim_ai_save_attempt(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_save_attempt(uuid, uuid, integer, integer, integer) to service_role;
