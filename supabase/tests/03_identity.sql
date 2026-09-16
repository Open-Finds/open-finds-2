\set QUIET on
SET client_min_messages TO notice;

-- Fixtures: two unclaimed plans on two different devices, plus a trip.
INSERT INTO auth.users (id,email) VALUES
 ('33333333-3333-3333-3333-333333333333','alice@x.com'),
 ('44444444-4444-4444-4444-444444444444','mallory@x.com')
ON CONFLICT DO NOTHING;

INSERT INTO plans (id,title,date,host_name,location,type,status,user_id,owner_id)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','Alice Phone Plan','2026-12-01','A','Fitzroy','food','active','alice-phone',NULL);
INSERT INTO plans (id,title,date,host_name,location,type,status,user_id,owner_id)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','Mallory Plan','2026-12-02','M','Carlton','food','active','mallory-phone',NULL);
INSERT INTO trips (id,name,destination,start_date,num_days,host_name,status,user_id,owner_id)
VALUES ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1','Alice Trip','Sydney','2026-12-05',3,'A','active','alice-phone',NULL);

SET ROLE anon;
DO $$
BEGIN
  -- Before claiming, the device id still works (nobody is locked out mid-migration).
  PERFORM set_config('request.headers','{"x-user-id":"alice-phone"}',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM rep('I1 unclaimed row via device id',
    (SELECT count(*) FROM plans WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')=1);

  -- Another device sees nothing.
  PERFORM set_config('request.headers','{"x-user-id":"bob-phone"}',true);
  PERFORM rep('I2 other device still blocked',
    (SELECT count(*) FROM plans WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')=0);
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$
DECLARE r jsonb; ok boolean;
BEGIN
  -- Alice signs in on her phone and claims.
  PERFORM set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
  PERFORM set_config('request.headers','{"x-user-id":"alice-phone"}',true);
  r := claim_device_rows('alice-phone');
  PERFORM rep('I3 claim reports 1 plan + 1 trip',
    (r->>'plans')::int=1 AND (r->>'trips')::int=1);

  -- Cross-device sync: her laptop has a different device id and no claim of its own.
  PERFORM set_config('request.headers','{"x-user-id":"alice-laptop"}',true);
  PERFORM rep('I4 claimed plan visible on a new device',
    (SELECT count(*) FROM plans WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')=1);
  PERFORM rep('I5 claimed trip visible on a new device',
    (SELECT count(*) FROM trips WHERE id='a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')=1);

  -- And she can edit from the laptop.
  UPDATE plans SET title='Edited From Laptop' WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  PERFORM rep('I6 owner can edit from new device',
    (SELECT title FROM plans WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')='Edited From Laptop');

  -- Claiming is idempotent: a second run finds nothing left to take.
  r := claim_device_rows('alice-phone');
  PERFORM rep('I7 re-claim is a no-op', (r->>'plans')::int=0);

  -- Progress reporting.
  PERFORM rep('I8 unclaimed counter reaches zero',
    (my_unclaimed_row_counts('alice-phone')->>'plans')::int=0);
END $$;
RESET ROLE;

-- The bearer path must close the moment a row has an owner.
SET ROLE anon;
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.headers','{"x-user-id":"alice-phone"}',true);
  PERFORM rep('I9 stolen device id no longer reads',
    (SELECT count(*) FROM plans WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')=0);

  UPDATE plans SET title='Hijacked' WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM rep('I10 stolen device id cannot write', n=0);
END $$;
RESET ROLE;

-- Mallory must not be able to claim a device that is not hers... but note the
-- honest limitation: claiming is gated on knowing the device id, so this
-- asserts the rule we can actually enforce — she cannot take an OWNED row.
SET ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
  r := claim_device_rows('alice-phone');
  PERFORM rep('I11 cannot claim an already-owned row', (r->>'plans')::int=0);
  -- Mallory cannot even see the row, which is the stronger statement. (Reading
  -- owner_id from her session would return NULL for exactly this reason.)
  PERFORM rep('I12 attacker cannot see the row',
    (SELECT count(*) FROM plans WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')=0);
END $$;
RESET ROLE;

-- ...and from Alice's own session the ownership is intact.
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
  PERFORM set_config('request.headers','{}',true);
  PERFORM rep('I12b owner still Alice after attempt',
    (SELECT owner_id FROM plans WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
      ='33333333-3333-3333-3333-333333333333');
END $$;
RESET ROLE;

-- Anonymous callers cannot claim at all.
SET ROLE anon;
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM claim_device_rows('mallory-phone');
    ok := false;
  EXCEPTION WHEN others THEN ok := true;
  END;
  PERFORM rep('I13 anon cannot claim', ok);
END $$;
RESET ROLE;

-- Guests are untouched by any of this.
SET ROLE anon;
DO $$
BEGIN
  PERFORM set_config('request.headers','{}',true);
  PERFORM rep('I14 share link still works after claim',
    get_shared_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')->'plan'->>'title'='Edited From Laptop');
  PERFORM rep('I15 owner_id not leaked to guests',
    NOT ((get_shared_plan('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')->'plan') ? 'owner_id'));
END $$;
RESET ROLE;
