-- STAGING ONLY. Not part of supabase/migrations. Never apply to production.
--
-- The spending ledger behind the staging provider controls (listed test-account
-- mode, see docs/STAGING-PROVIDER-CONTROLS.md). It was created on the staging
-- project crpkzysdtnoomzimibhe outside Git; this file records it so a fresh
-- staging project can be rebuilt. The supabase CLI only runs supabase/migrations,
-- so this file is applied by hand, on staging, after the migrations.
--
-- Safe to run more than once. On the live staging project it changes nothing:
-- the two functions below were checked against the live definitions on
-- 2026-11-18 (MD5 of the definition with carriage returns and the trailing newline
-- removed): staging_provider_control 781050dbbd615c5d4423ddb975783937,
-- staging_provider_control_core 052b12641dba125e9b7ec09c015d3d1b. Tables,
-- constraints and access were read from the live catalog the same day.
-- Open mode (STAGING_PROVIDER_ACCESS=open) does not use this ledger.
--
-- Access: RLS on, no policies, no grants to anon or authenticated. Only postgres
-- and service_role can run staging_provider_control; only postgres can run the
-- _core function.

CREATE TABLE IF NOT EXISTS public.staging_provider_campaigns (
  id text PRIMARY KEY CHECK (length(id) >= 1 AND length(id) <= 64),
  active_request uuid,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object')
);

CREATE TABLE IF NOT EXISTS public.staging_provider_requests (
  campaign text NOT NULL REFERENCES public.staging_provider_campaigns(id),
  id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  operation text NOT NULL CHECK (operation = ANY (ARRAY['extract-venue-meta', 'resolve-place', 'geocode', 'discover-venues', 'ai-proxy'])),
  conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  recovery_note text,
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0 AND calls <= 8),
  PRIMARY KEY (campaign, user_id, payload_hash)
);

CREATE TABLE IF NOT EXISTS public.staging_provider_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  day date NOT NULL,
  ai integer NOT NULL DEFAULT 0 CHECK (ai >= 0),
  google integer NOT NULL DEFAULT 0 CHECK (google >= 0),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.staging_provider_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_provider_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_provider_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staging_provider_campaigns, public.staging_provider_requests, public.staging_provider_daily
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staging_provider_control(p_campaign text, p_request uuid, p_user uuid, p_action text, p_hash text DEFAULT NULL::text, p_operation text DEFAULT NULL::text, p_conversation uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_daily_ai integer DEFAULT 10, p_daily_google integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  active_id uuid;
  released_id uuid;
begin
  if p_campaign = 'android-ai-save-robert' then
    select active_request into active_id from public.staging_provider_campaigns where id=p_campaign for update;
    if active_id is not null then
      update public.staging_provider_requests
        set finished_at=clock_timestamp(), recovery_note='Lease expired; provider outcomes unconfirmed and all reservations retained'
        where campaign=p_campaign and id=active_id and finished_at is null
          and created_at <= clock_timestamp() - interval '3 minutes'
        returning id into released_id;
      if released_id is not null then
        update public.staging_provider_campaigns set active_request=null where id=p_campaign and active_request=released_id;
      end if;
    end if;
    if p_action='finish' and exists (
      select 1 from public.staging_provider_requests
        where campaign=p_campaign and id=p_request and user_id=p_user and finished_at is not null
    ) then
      return jsonb_build_object('allowed',true);
    end if;
  end if;
  return public.staging_provider_control_core(p_campaign,p_request,p_user,p_action,p_hash,p_operation,p_conversation,p_kind,p_daily_ai,p_daily_google);
end;
$function$;

CREATE OR REPLACE FUNCTION public.staging_provider_control_core(p_campaign text, p_request uuid, p_user uuid, p_action text, p_hash text DEFAULT NULL::text, p_operation text DEFAULT NULL::text, p_conversation uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_daily_ai integer DEFAULT 10, p_daily_google integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c public.staging_provider_campaigns%ROWTYPE;
  r public.staging_provider_requests%ROWTYPE;
  d public.staging_provider_daily%ROWTYPE;
  n integer; ceiling integer; k text; conversation_count integer;
  today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_user IS NULL OR p_request IS NULL OR p_campaign IS NULL OR p_campaign !~ '^[a-zA-Z0-9_-]{1,64}$'
    OR p_action IS NULL OR p_action NOT IN ('start','call','finish')
    OR p_daily_ai IS NULL OR p_daily_ai NOT BETWEEN 0 AND 15
    OR p_daily_google IS NULL OR p_daily_google NOT BETWEEN 0 AND 30 THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_reservation');
  END IF;
  INSERT INTO public.staging_provider_campaigns(id) VALUES(p_campaign) ON CONFLICT DO NOTHING;
  -- Every operation uses the same lock order: campaign -> request -> daily row.
  SELECT * INTO c FROM public.staging_provider_campaigns WHERE id=p_campaign FOR UPDATE;
  IF p_action = 'start' THEN
    IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_operation IS NULL OR
      p_operation NOT IN ('extract-venue-meta','resolve-place','geocode','discover-venues','ai-proxy') THEN
      RETURN jsonb_build_object('allowed',false,'code','invalid_reservation');
    END IF;
    IF EXISTS(SELECT 1 FROM public.staging_provider_requests WHERE campaign=p_campaign AND user_id=p_user AND payload_hash=p_hash) THEN
      RETURN jsonb_build_object('allowed',false,'code','duplicate_request');
    END IF;
    IF c.active_request IS NOT NULL THEN
      RETURN jsonb_build_object('allowed',false,'code','campaign_busy');
    END IF;
    ceiling := CASE p_operation WHEN 'extract-venue-meta' THEN 12 WHEN 'ai-proxy' THEN 15
      WHEN 'geocode' THEN 10 WHEN 'resolve-place' THEN 20 WHEN 'discover-venues' THEN 5 END;
    k := 'entry_' || p_operation;
    n := COALESCE((c.counts->>k)::integer,0);
    IF n >= ceiling THEN RETURN jsonb_build_object('allowed',false,'code','budget_exhausted'); END IF;
    IF p_conversation IS NOT NULL THEN
      IF p_operation <> 'ai-proxy' THEN RETURN jsonb_build_object('allowed',false,'code','invalid_reservation'); END IF;
      IF NOT EXISTS(SELECT 1 FROM public.staging_provider_requests WHERE campaign=p_campaign AND user_id=p_user AND conversation_id=p_conversation) THEN
        SELECT count(DISTINCT (user_id,conversation_id)) INTO conversation_count
          FROM public.staging_provider_requests WHERE campaign=p_campaign AND conversation_id IS NOT NULL;
        IF conversation_count >= 5 THEN RETURN jsonb_build_object('allowed',false,'code','budget_exhausted'); END IF;
      END IF;
    END IF;
    INSERT INTO public.staging_provider_requests(campaign,id,user_id,payload_hash,operation,conversation_id)
      VALUES(p_campaign,p_request,p_user,p_hash,p_operation,p_conversation);
    UPDATE public.staging_provider_campaigns SET active_request=p_request, counts=jsonb_set(c.counts,ARRAY[k],to_jsonb(n+1)) WHERE id=p_campaign;
    RETURN jsonb_build_object('allowed',true);
  END IF;
  SELECT * INTO r FROM public.staging_provider_requests WHERE id=p_request AND campaign=p_campaign AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR r.finished_at IS NOT NULL OR c.active_request IS DISTINCT FROM p_request THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_reservation');
  END IF;
  IF p_action = 'finish' THEN
    UPDATE public.staging_provider_requests SET finished_at=now() WHERE id=p_request;
    UPDATE public.staging_provider_campaigns SET active_request=NULL WHERE id=p_campaign;
    RETURN jsonb_build_object('allowed',true);
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('ai','places','geocode','metadata') OR r.calls >= 8 THEN
    RETURN jsonb_build_object('allowed',false,'code','budget_exhausted');
  END IF;
  -- Reject resource types a route should never request, even on server bugs.
  IF (r.operation='ai-proxy' AND p_kind<>'ai') OR
    (r.operation='extract-venue-meta' AND p_kind<>'metadata') OR
    (r.operation='geocode' AND p_kind<>'geocode') OR
    (r.operation='discover-venues' AND p_kind<>'places') OR
    (r.operation='resolve-place' AND p_kind NOT IN ('places','geocode','metadata')) THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_reservation');
  END IF;
  ceiling := CASE p_kind WHEN 'ai' THEN 15 WHEN 'places' THEN 20 WHEN 'geocode' THEN 10 WHEN 'metadata' THEN 36 END;
  n := COALESCE((c.counts->>p_kind)::integer,0);
  IF n >= ceiling THEN RETURN jsonb_build_object('allowed',false,'code','budget_exhausted'); END IF;
  INSERT INTO public.staging_provider_daily(user_id,day) VALUES(p_user,today) ON CONFLICT DO NOTHING;
  SELECT * INTO d FROM public.staging_provider_daily WHERE user_id=p_user AND day=today FOR UPDATE;
  IF (p_kind='ai' AND d.ai >= p_daily_ai) OR (p_kind IN ('places','geocode') AND d.google >= p_daily_google) THEN
    RETURN jsonb_build_object('allowed',false,'code','daily_limit');
  END IF;
  UPDATE public.staging_provider_daily SET ai=ai+CASE WHEN p_kind='ai' THEN 1 ELSE 0 END,
    google=google+CASE WHEN p_kind IN ('places','geocode') THEN 1 ELSE 0 END WHERE user_id=p_user AND day=today;
  UPDATE public.staging_provider_requests SET calls=calls+1 WHERE id=p_request;
  UPDATE public.staging_provider_campaigns SET counts=jsonb_set(c.counts,ARRAY[p_kind],to_jsonb(n+1)) WHERE id=p_campaign;
  RETURN jsonb_build_object('allowed',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.staging_provider_control(text, uuid, uuid, text, text, text, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staging_provider_control(text, uuid, uuid, text, text, text, uuid, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.staging_provider_control_core(text, uuid, uuid, text, text, text, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
