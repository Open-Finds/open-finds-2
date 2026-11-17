\set QUIET on
SET client_min_messages TO notice;

-- AI Save testing allowance: claim_ai_save_attempt.
-- These run in one session, so they check the counting rules, the rolling window
-- and the access controls. They cannot interleave two sessions: concurrent claims
-- rely on the per-user advisory lock and are covered by ai_save_attempts_concurrency.sh.

INSERT INTO auth.users (id, email) VALUES
  ('a5a5a5a5-0000-0000-0000-000000000001', 'attempts1@x.com'),
  ('a5a5a5a5-0000-0000-0000-000000000002', 'attempts2@x.com'),
  ('a5a5a5a5-0000-0000-0000-000000000003', 'attempts3@x.com'),
  ('a5a5a5a5-0000-0000-0000-000000000004', 'attempts4@x.com'),
  ('a5a5a5a5-0000-0000-0000-000000000005', 'attempts5@x.com'),
  ('a5a5a5a5-0000-0000-0000-000000000006', 'attempts6@x.com'),
  ('a5a5a5a5-0000-0000-0000-000000000007', 'attempts7@x.com')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  u1 uuid := 'a5a5a5a5-0000-0000-0000-000000000001';
  u2 uuid := 'a5a5a5a5-0000-0000-0000-000000000002';
  u3 uuid := 'a5a5a5a5-0000-0000-0000-000000000003';
  u4 uuid := 'a5a5a5a5-0000-0000-0000-000000000004';
  u5 uuid := 'a5a5a5a5-0000-0000-0000-000000000005';
  u6 uuid := 'a5a5a5a5-0000-0000-0000-000000000006';
  u7 uuid := 'a5a5a5a5-0000-0000-0000-000000000007';
  a uuid; r jsonb; n int; i int; ok boolean; retry int;
BEGIN
  -- A new attempt uses one slot.
  a := gen_random_uuid();
  r := public.claim_ai_save_attempt(u1, a);
  PERFORM rep('A1 a new attempt is allowed and counted',
    (r->>'allowed')::boolean AND (r->>'counted')::boolean AND (r->>'remaining')::int = 19 AND (r->>'requests')::int = 1);

  -- Further requests of the same attempt are free.
  r := public.claim_ai_save_attempt(u1, a);
  SELECT count(*) INTO n FROM public.ai_save_attempts WHERE user_id = u1;
  PERFORM rep('A2 the same attempt is free (not counted again)',
    (r->>'allowed')::boolean AND NOT (r->>'counted')::boolean AND (r->>'requests')::int = 2 AND n = 1);

  -- The per-attempt request cap: 12 requests, the 13th is refused and not recorded.
  FOR i IN 3..12 LOOP r := public.claim_ai_save_attempt(u1, a); END LOOP;
  PERFORM rep('A3 the 12th request of an attempt is allowed', (r->>'allowed')::boolean AND (r->>'requests')::int = 12);
  r := public.claim_ai_save_attempt(u1, a);
  SELECT requests INTO n FROM public.ai_save_attempts WHERE user_id = u1 AND attempt_id = a;
  PERFORM rep('A4 the 13th request is refused and not recorded',
    NOT (r->>'allowed')::boolean AND r->>'code' = 'attempt_request_limit' AND n = 12);

  -- The allowance: 20 distinct attempts, then refusal with the wait.
  FOR i IN 1..20 LOOP r := public.claim_ai_save_attempt(u2, gen_random_uuid()); END LOOP;
  PERFORM rep('B1 the 20th distinct attempt is allowed', (r->>'allowed')::boolean AND (r->>'remaining')::int = 0);
  r := public.claim_ai_save_attempt(u2, gen_random_uuid());
  retry := (r->>'retry_after')::int;
  SELECT count(*) INTO n FROM public.ai_save_attempts WHERE user_id = u2;
  PERFORM rep('B2 the 21st attempt is refused with the wait',
    NOT (r->>'allowed')::boolean AND r->>'code' = 'testing_limit' AND retry BETWEEN 1795 AND 1800 AND n = 20);

  -- Free repeats still work at the limit: a retry never needs allowance.
  SELECT attempt_id INTO a FROM public.ai_save_attempts WHERE user_id = u2 LIMIT 1;
  r := public.claim_ai_save_attempt(u2, a);
  PERFORM rep('B3 a retry of an existing attempt works at the limit', (r->>'allowed')::boolean AND NOT (r->>'counted')::boolean);

  -- Other users are unaffected.
  r := public.claim_ai_save_attempt(u3, gen_random_uuid());
  PERFORM rep('B4 another user is unaffected by a full allowance', (r->>'allowed')::boolean AND (r->>'remaining')::int = 19);

  -- Rolling window: the slot frees exactly when the oldest counted attempt ages out.
  FOR i IN 1..20 LOOP PERFORM public.claim_ai_save_attempt(u4, gen_random_uuid()); END LOOP;
  UPDATE public.ai_save_attempts SET created_at = now() - interval '25 minutes'
    WHERE user_id = u4 AND attempt_id = (SELECT attempt_id FROM public.ai_save_attempts WHERE user_id = u4 ORDER BY created_at LIMIT 1);
  r := public.claim_ai_save_attempt(u4, gen_random_uuid());
  retry := (r->>'retry_after')::int;
  PERFORM rep('C1 the wait is when the oldest attempt ages out', NOT (r->>'allowed')::boolean AND retry BETWEEN 298 AND 300);
  UPDATE public.ai_save_attempts SET created_at = now() - interval '31 minutes'
    WHERE user_id = u4 AND created_at = (SELECT min(created_at) FROM public.ai_save_attempts WHERE user_id = u4);
  r := public.claim_ai_save_attempt(u4, gen_random_uuid());
  PERFORM rep('C2 an aged-out attempt frees a slot', (r->>'allowed')::boolean AND (r->>'counted')::boolean);
  r := public.claim_ai_save_attempt(u4, gen_random_uuid());
  PERFORM rep('C3 and only one slot', NOT (r->>'allowed')::boolean AND r->>'code' = 'testing_limit');

  -- Several aged-out attempts free several slots.
  UPDATE public.ai_save_attempts SET created_at = now() - interval '40 minutes'
    WHERE user_id = u4 AND attempt_id IN (SELECT attempt_id FROM public.ai_save_attempts WHERE user_id = u4 ORDER BY created_at DESC LIMIT 3);
  n := 0;
  FOR i IN 1..5 LOOP
    r := public.claim_ai_save_attempt(u4, gen_random_uuid());
    IF (r->>'allowed')::boolean THEN n := n + 1; END IF;
  END LOOP;
  PERFORM rep('C4 three aged-out attempts free exactly three slots', n = 3);

  -- An expired attempt id is refused, not renewed, and does not use allowance.
  a := gen_random_uuid();
  PERFORM public.claim_ai_save_attempt(u5, a);
  UPDATE public.ai_save_attempts SET created_at = now() - interval '31 minutes' WHERE user_id = u5 AND attempt_id = a;
  r := public.claim_ai_save_attempt(u5, a);
  SELECT requests, (created_at < now() - interval '30 minutes') INTO n, ok FROM public.ai_save_attempts WHERE user_id = u5 AND attempt_id = a;
  PERFORM rep('D1 an expired attempt id is refused, unchanged and not renewed',
    NOT (r->>'allowed')::boolean AND r->>'code' = 'attempt_expired' AND n = 1 AND ok);
  r := public.claim_ai_save_attempt(u5, gen_random_uuid());
  PERFORM rep('D2 a refused expired id used no allowance', (r->>'allowed')::boolean AND (r->>'remaining')::int = 19);

  -- Invalid parameters are refused and write nothing.
  ok := true;
  FOR r IN SELECT x FROM (VALUES
      (public.claim_ai_save_attempt(NULL, gen_random_uuid())),
      (public.claim_ai_save_attempt(u6, NULL)),
      (public.claim_ai_save_attempt(u6, gen_random_uuid(), 0)),
      (public.claim_ai_save_attempt(u6, gen_random_uuid(), 101)),
      (public.claim_ai_save_attempt(u6, gen_random_uuid(), 20, 59)),
      (public.claim_ai_save_attempt(u6, gen_random_uuid(), 20, 86401)),
      (public.claim_ai_save_attempt(u6, gen_random_uuid(), 20, 1800, 0)),
      (public.claim_ai_save_attempt(u6, gen_random_uuid(), 20, 1800, 51))
    ) AS t(x) LOOP
    ok := ok AND NOT (r->>'allowed')::boolean AND r->>'code' = 'invalid_claim';
  END LOOP;
  SELECT count(*) INTO n FROM public.ai_save_attempts WHERE user_id = u6;
  PERFORM rep('E1 invalid parameters are refused and write nothing', ok AND n = 0);

  -- A lowered limit works from the same history; the wait is when enough attempts have aged out.
  FOR i IN 1..20 LOOP
    INSERT INTO public.ai_save_attempts (user_id, attempt_id, created_at) VALUES (u7, gen_random_uuid(), now() - make_interval(mins => i));
  END LOOP;
  r := public.claim_ai_save_attempt(u7, gen_random_uuid(), 5);
  retry := (r->>'retry_after')::int;
  PERFORM rep('F1 a lowered limit waits for enough attempts to age out',
    NOT (r->>'allowed')::boolean AND r->>'code' = 'testing_limit' AND retry BETWEEN 1498 AND 1500);
  r := public.claim_ai_save_attempt(u7, gen_random_uuid(), 21);
  PERFORM rep('F2 a raised limit admits the next attempt', (r->>'allowed')::boolean AND (r->>'remaining')::int = 0);

  -- Old rows are removed at the user's next claim, others' are left alone.
  INSERT INTO public.ai_save_attempts (user_id, attempt_id, created_at) VALUES
    (u3, gen_random_uuid(), now() - interval '3 days'), (u5, gen_random_uuid(), now() - interval '3 days');
  PERFORM public.claim_ai_save_attempt(u3, gen_random_uuid());
  SELECT count(*) INTO n FROM public.ai_save_attempts WHERE user_id = u3 AND created_at < now() - interval '2 days';
  PERFORM rep('G1 old rows are removed on the next claim', n = 0);
  SELECT count(*) INTO n FROM public.ai_save_attempts WHERE user_id = u5 AND created_at < now() - interval '2 days';
  PERFORM rep('G2 another user''s old rows are left alone', n = 1);

  -- Access: only the service role can use it; the table is closed to the API roles.
  PERFORM rep('H1 the service role can claim',
    has_function_privilege('service_role', 'public.claim_ai_save_attempt(uuid,uuid,integer,integer,integer)', 'EXECUTE'));
  PERFORM rep('H2 anon and signed-in users cannot claim',
    NOT has_function_privilege('anon', 'public.claim_ai_save_attempt(uuid,uuid,integer,integer,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.claim_ai_save_attempt(uuid,uuid,integer,integer,integer)', 'EXECUTE'));
  -- The table is closed by RLS with no policy. Other test files grant broad table rights to the API roles,
  -- so this checks behaviour (what those roles can actually see or write), not the grant list.
  PERFORM public.claim_ai_save_attempt(u7, gen_random_uuid());
  SET LOCAL ROLE authenticated;
  BEGIN SELECT count(*) INTO n FROM public.ai_save_attempts; EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  BEGIN INSERT INTO public.ai_save_attempts (user_id, attempt_id) VALUES (u7, gen_random_uuid()); ok := true;
  EXCEPTION WHEN insufficient_privilege OR others THEN ok := false; END;
  RESET ROLE;
  PERFORM rep('H3 signed-in users can neither read nor write the table', n = 0 AND NOT ok);
  PERFORM rep('H4 row level security is on',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_save_attempts'::regclass));
  PERFORM rep('H5 the function runs with a fixed search path',
    (SELECT 'search_path=""' = ANY(proconfig) FROM pg_proc WHERE proname = 'claim_ai_save_attempt'));
END $$;

-- Deleting an account removes its attempts.
DO $$
DECLARE n int;
BEGIN
  DELETE FROM auth.users WHERE id = 'a5a5a5a5-0000-0000-0000-000000000001';
  SELECT count(*) INTO n FROM public.ai_save_attempts WHERE user_id = 'a5a5a5a5-0000-0000-0000-000000000001';
  PERFORM rep('I1 deleting an account removes its attempts', n = 0);
END $$;
