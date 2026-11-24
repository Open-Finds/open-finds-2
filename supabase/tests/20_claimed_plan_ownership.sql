\set QUIET on
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('ecb35bb2-c959-4c16-8bb5-f549ee726f58', 'phase1-owner@example.invalid');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ecb35bb2-c959-4c16-8bb5-f549ee726f58', true);
SELECT set_config('request.headers', '{"x-user-id":"phase1-owner-device"}', true);

DO $$
DECLARE
  fixture_plan uuid;
  fixture_trip uuid;
BEGIN
  INSERT INTO plans (title, date, host_name, user_id)
  VALUES ('Phase 1 fixture plan', current_date, 'Host', 'phase1-owner-device')
  RETURNING id INTO fixture_plan;

  INSERT INTO trips (name, destination, start_date, num_days, host_name, user_id)
  VALUES ('Phase 1 fixture trip', 'Sydney', current_date, 1, 'Host', 'phase1-owner-device')
  RETURNING id INTO fixture_trip;

  IF public.claim_device_rows('phase1-owner-device') <> '{"plans":1,"trips":1}'::jsonb THEN
    RAISE EXCEPTION 'Legacy claim failed';
  END IF;

  UPDATE plans SET title = 'Updated fixture' WHERE id = fixture_plan;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owner could not update plan'; END IF;
  UPDATE trips SET name = 'Updated fixture' WHERE id = fixture_trip;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owner could not update trip'; END IF;

  BEGIN
    UPDATE plans SET owner_id = NULL WHERE id = fixture_plan;
    RAISE EXCEPTION 'Plan ownership must remain claimed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'Claimed ownership cannot be changed' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE trips SET owner_id = NULL WHERE id = fixture_trip;
    RAISE EXCEPTION 'Trip ownership must remain claimed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'Claimed ownership cannot be changed' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'Claimed plan and trip ownership: PASS';
END;
$$;

ROLLBACK;
