-- Usage log for paid AI calls (OpenRouter), for cost tracking and future plan limits.
--
-- One row per successful paid call, written by the ai-proxy edge function with the
-- service role. The service role is used here because the caller is a signed-in user
-- whose JWT ai-proxy has already verified, and the row only records what OpenRouter
-- reported for that call. Nothing a user sends chooses the row's contents beyond
-- the purpose and model, which ai-proxy has already checked.
--
-- Clients cannot read or write this table. Admins read totals through
-- admin_ai_usage_summary(), which checks is_admin() first.

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  purpose text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0)
);

create index ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

create or replace function public.admin_ai_usage_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
DECLARE
  v_since timestamptz;
  v_result jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));

  SELECT jsonb_build_object(
    'since', v_since,
    'totals', (
      SELECT jsonb_build_object(
        'calls', count(*),
        'tokens', coalesce(sum(total_tokens), 0),
        'cost_usd', coalesce(sum(cost_usd), 0),
        'users', count(DISTINCT user_id)
      ) FROM ai_usage WHERE created_at >= v_since
    ),
    'by_day', coalesce((
      SELECT jsonb_agg(d ORDER BY d->>'day' DESC) FROM (
        SELECT jsonb_build_object(
          'day', to_char(date_trunc('day', created_at), 'YYYY-MM-DD'),
          'calls', count(*),
          'tokens', coalesce(sum(total_tokens), 0),
          'cost_usd', coalesce(sum(cost_usd), 0)
        ) AS d
        FROM ai_usage WHERE created_at >= v_since
        GROUP BY date_trunc('day', created_at)
      ) days
    ), '[]'::jsonb),
    'by_purpose', coalesce((
      SELECT jsonb_agg(p ORDER BY (p->>'calls')::int DESC) FROM (
        SELECT jsonb_build_object(
          'purpose', purpose,
          'model', model,
          'calls', count(*),
          'tokens', coalesce(sum(total_tokens), 0),
          'cost_usd', coalesce(sum(cost_usd), 0)
        ) AS p
        FROM ai_usage WHERE created_at >= v_since
        GROUP BY purpose, model
      ) purposes
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ai_usage_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ai_usage_summary(integer) TO authenticated;
