\set QUIET on
SET client_min_messages TO notice;

-- A trip day with three stops, deliberately created out of time order so the
-- two orderings can be told apart.
INSERT INTO trips (id,name,destination,start_date,num_days,host_name,status,user_id,owner_id)
VALUES ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1','Order Trip','Melbourne','2026-12-01',1,'H','active','order-device',NULL);
INSERT INTO plans (id,title,date,host_name,location,type,status,user_id,owner_id,trip_id,day_number)
VALUES ('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1','Day One','2026-12-01','H','Fitzroy','food','active','order-device',NULL,'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',1);

INSERT INTO stops (id,plan_id,name,address,time,sort_order,user_id) VALUES
 ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa','d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1','Dinner','1 St','20:00',0,'order-device'),
 ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa','d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1','Drinks','2 St','18:00',1,'order-device'),
 ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa','d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1','Dessert','3 St','22:00',2,'order-device');

SET ROLE anon;
DO $$
DECLARE n int; ok boolean;
BEGIN
  PERFORM set_config('request.headers','{"x-user-id":"order-device"}',true);

  -- Reorder to Drinks, Dinner, Dessert in one atomic call.
  n := reorder_plan_stops('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
    ARRAY['22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[]);
  PERFORM rep('C1 reorder updates the rows it must', n=2);

  PERFORM rep('C2 sort_order reflects the new order',
    (SELECT string_agg(name,',' ORDER BY sort_order) FROM stops
      WHERE plan_id='d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1') = 'Drinks,Dinner,Dessert');

  -- Re-running the same order changes nothing.
  n := reorder_plan_stops('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
    ARRAY['22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[]);
  PERFORM rep('C3 repeat reorder is a no-op', n=0);

  -- Duplicates would assign two stops the same index.
  BEGIN
    PERFORM reorder_plan_stops('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
      ARRAY['22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[]);
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('C4 duplicate ids rejected', ok);

  -- A stop from another plan must not be reorderable through this plan.
  BEGIN
    PERFORM reorder_plan_stops('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
      ARRAY['aaaaaaaa-1111-1111-1111-111111111111']::uuid[]);
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('C5 foreign stop id rejected', ok);

  BEGIN
    PERFORM reorder_plan_stops('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', ARRAY[]::uuid[]);
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('C6 empty ordering rejected', ok);
END $$;
RESET ROLE;

-- A caller who does not own the plan must not be able to reorder it, even
-- though the RPC itself is SECURITY INVOKER.
SET ROLE anon;
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.headers','{"x-user-id":"someone-else"}',true);
  n := reorder_plan_stops('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
    ARRAY['11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[]);
  PERFORM rep('C7 non-owner reorder affects nothing', n=0);
EXCEPTION WHEN others THEN
  -- RLS hiding the rows entirely is an equally correct outcome.
  PERFORM rep('C7 non-owner reorder affects nothing', true);
END $$;
RESET ROLE;

-- ── Per-stop RSVP identity ────────────────────────────────────
SET ROLE anon;
DO $$
DECLARE stop uuid := '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; ok boolean;
        r1 jsonb; r2 jsonb; alpha_id text;
BEGIN
  PERFORM set_config('request.headers','{}',true);

  -- The headline bug: two different guests who happen to share a name.
  r1 := submit_stop_rsvp(stop,'Sam','in','browser-alpha');
  r2 := submit_stop_rsvp(stop,'Sam','out','browser-beta');
  alpha_id := r1->>'id';
  PERFORM rep('C8 same name, two guests, two rows', alpha_id <> (r2->>'id'));
  PERFORM rep('C10 each answer is its own',
    (r1->>'status')='in' AND (r2->>'status')='out');

  -- The same guest changing their mind updates in place.
  r1 := submit_stop_rsvp(stop,'Sam','out','browser-alpha');
  PERFORM rep('C12 the update took', (r1->>'status')='out');
  PERFORM rep('C12b update reused the same row', (r1->>'id') = alpha_id);

  -- A guest may rename themselves without forking into a second row.
  r1 := submit_stop_rsvp(stop,'Samantha','in','browser-alpha');
  PERFORM rep('C13 rename reuses the guest row', (r1->>'name')='Samantha');

  -- Without a key a guest is indistinguishable, so it is refused.
  BEGIN PERFORM submit_stop_rsvp(stop,'Nokey','in',NULL); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('C14 guest with no key refused', ok);

  BEGIN PERFORM submit_stop_rsvp(stop,'Bad','maybe','browser-gamma'); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('C15 invalid status rejected', ok);

  PERFORM rep('C16 guest_key not leaked to guests',
    NOT ((get_shared_trip('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1')->'stop_rsvps'->0) ? 'guest_key'));
END $$;
RESET ROLE;

-- Signed-in users are keyed on the account, not the browser.
SET ROLE authenticated;
DO $$
DECLARE stop uuid := '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; r1 jsonb; r2 jsonb;
BEGIN
  PERFORM set_config('request.headers','{}',true);
  PERFORM set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);

  r1 := submit_stop_rsvp(stop,'Alice','in','browser-one');
  -- Same account, different browser: still one answer.
  r2 := submit_stop_rsvp(stop,'Alice','out','browser-two');
  PERFORM rep('C17 account identity beats browser', (r1->>'id') = (r2->>'id'));
  PERFORM rep('C18 the later answer wins', (r2->>'status')='out');
END $$;
RESET ROLE;

-- Row counts belong to the host: guests have no SELECT on stop_rsvps.
SET ROLE anon;
DO $$
DECLARE stop uuid := '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.headers','{"x-user-id":"order-device"}',true);

  PERFORM rep('C9 both same-name guests survive',
    (SELECT count(*) FROM stop_rsvps WHERE stop_id=stop)=2);
  PERFORM rep('C11 repeat answers do not duplicate',
    (SELECT count(*) FROM stop_rsvps
      WHERE stop_id=stop AND guest_key='browser-alpha')=1);
  PERFORM rep('C13b rename did not fork a row',
    (SELECT count(*) FROM stop_rsvps
      WHERE stop_id=stop AND guest_key='browser-alpha' AND name='Samantha')=1);
END $$;
RESET ROLE;
