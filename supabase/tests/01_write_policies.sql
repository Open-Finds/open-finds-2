\set QUIET on
SET client_min_messages TO notice;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

INSERT INTO auth.users (id,email) VALUES
 ('11111111-1111-1111-1111-111111111111','host@x.com'),
 ('22222222-2222-2222-2222-222222222222','other@x.com');
INSERT INTO plans (id,title,date,host_name,location,type,status,user_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Secret Birthday','2026-12-01','Host','Fitzroy','food','active','owner-device');
INSERT INTO stops (plan_id,name,address,time,sort_order,user_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Cutler & Co','55 Gertrude St','19:00',0,'owner-device');
INSERT INTO rsvps (plan_id,name,status,user_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sam','in','owner-device');
-- approved=false so flipping it is a genuine change
INSERT INTO venue_partners (id,owner_id,business_name,address,contact_name,contact_email,approved,active,visit_rate_cents)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','Bar Liberty','234 Johnston St','O','o@b.com',false,true,50);
INSERT INTO venue_partners (id,owner_id,business_name,address,contact_name,contact_email,approved,active,visit_rate_cents)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111','Approved Venue','1 St','O','o@b.com',true,true,50);

-- rep() lives in 00_platform_stub.sql
CREATE OR REPLACE FUNCTION rep_unused(l text, ok boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  RAISE NOTICE '%', rpad(l,36) || CASE WHEN ok THEN ': PASS' ELSE ': ** FAIL **' END; END $$;

SET ROLE anon;
DO $$
DECLARE n int; ok boolean;
BEGIN
  PERFORM set_config('request.headers','{"x-user-id":"owner-device"}',true);
  UPDATE plans SET title='Renamed' WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('T6 owner CAN update own plan', n=1);

  PERFORM set_config('request.headers','{"x-user-id":"attacker-device"}',true);
  UPDATE plans SET title='Hacked' WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('T8 other device CANNOT update', n=0);

  DELETE FROM plans WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('T8b other device CANNOT delete', n=0);

  PERFORM set_config('request.headers','{}',true);
  PERFORM rep('T8c no header sees no plans', (SELECT count(*) FROM plans)=0);
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
  BEGIN
    INSERT INTO venue_events (venue_id,event_type,auth_uid,user_id)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','visited','11111111-1111-1111-1111-111111111111','x');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('T16 spoofed auth_uid blocked', ok);

  INSERT INTO venue_events (venue_id,event_type,auth_uid,user_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','visited','22222222-2222-2222-2222-222222222222','x');
  PERFORM rep('T17 honest event allowed', true);

  BEGIN
    INSERT INTO venue_events (venue_id,event_type,auth_uid,user_id)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','visited','22222222-2222-2222-2222-222222222222','x');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('T18 duplicate same-day blocked', ok);

  BEGIN
    INSERT INTO venue_events (venue_id,event_type,auth_uid,user_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','visited','22222222-2222-2222-2222-222222222222','x');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('T18b unapproved venue blocked', ok);

  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
  BEGIN
    INSERT INTO venue_events (venue_id,event_type,auth_uid,user_id)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','impression','11111111-1111-1111-1111-111111111111','x');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('T19 owner self-inflation blocked', ok);

  BEGIN
    UPDATE venue_partners SET approved=true WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('T20 self-approval blocked', ok);

  BEGIN
    UPDATE venue_partners SET visit_rate_cents=0 WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('T21 self-set rate blocked', ok);

  UPDATE venue_partners SET business_name='Renamed' WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  PERFORM rep('T22 normal field still editable', true);
END $$;
RESET ROLE;
