\set QUIET on
SET client_min_messages TO notice;
SET ROLE anon;
DO $$
DECLARE pid uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; ok boolean; j jsonb;
BEGIN
  PERFORM set_config('request.headers','{}',true);
  PERFORM rep('R1 anon cannot list plans',  (SELECT count(*) FROM plans)=0);
  PERFORM rep('R2 anon cannot list stops',  (SELECT count(*) FROM stops)=0);
  PERFORM rep('R3 anon cannot list rsvps',  (SELECT count(*) FROM rsvps)=0);
  PERFORM rep('R4 anon cannot list trips',  (SELECT count(*) FROM trips)=0);

  j := get_shared_plan(pid);
  PERFORM rep('R5 share RPC returns plan',  j->'plan'->>'title' IS NOT NULL);
  PERFORM rep('R6 share RPC returns stops', jsonb_array_length(j->'stops')=1);
  PERFORM rep('R7 share RPC returns rsvps', jsonb_array_length(j->'rsvps')>=1);
  PERFORM rep('R8 owner key NOT leaked',    NOT ((j->'plan') ? 'user_id'));
  PERFORM rep('R9 stop owner key NOT leaked', NOT ((j->'stops'->0) ? 'user_id'));
  PERFORM rep('R10 unknown id -> null',     get_shared_plan('dddddddd-dddd-dddd-dddd-dddddddddddd') IS NULL);

  PERFORM rep('R11 guest RSVP accepted',    submit_plan_rsvp(pid,'Jordan','in')->>'name'='Jordan');
  PERFORM rep('R12 RSVP reply omits user_id', NOT (submit_plan_rsvp(pid,'Kim','in') ? 'user_id'));

  BEGIN PERFORM submit_plan_rsvp(pid,'X','hacked'); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('R13 invalid status rejected', ok);

  BEGIN PERFORM submit_plan_rsvp('dddddddd-dddd-dddd-dddd-dddddddddddd','X','in'); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('R14 unknown plan rejected', ok);

  BEGIN PERFORM submit_plan_rsvp(pid,'','in'); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('R15 empty name rejected', ok);

  BEGIN PERFORM submit_plan_rsvp(pid, repeat('z',200),'in'); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('R16 oversized name rejected', ok);

  -- The RSVP just submitted must still not be listable by enumeration.
  PERFORM rep('R17 rsvps still not listable', (SELECT count(*) FROM rsvps)=0);
END $$;
RESET ROLE;

-- Guest decline-reason path (Declined.tsx). A guest has no UPDATE rights on
-- rsvps, so this must go through the RPC and must be one-shot.
SET ROLE anon;
DO $$
DECLARE pid uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; rid uuid; ok boolean;
BEGIN
  rid := (submit_plan_rsvp(pid,'Decliner','declined')->>'id')::uuid;
  PERFORM rep('R18 decline reason accepted',
    set_rsvp_decline_reason(rid,'Double booked')->>'decline_reason'='Double booked');

  BEGIN PERFORM set_rsvp_decline_reason(rid,'changed my mind'); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('R19 reason cannot be overwritten', ok);

  BEGIN PERFORM set_rsvp_decline_reason(rid,''); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('R20 empty reason rejected', ok);

  -- An RSVP that is "in" is not a decline and must be refused.
  rid := (submit_plan_rsvp(pid,'Attender','in')->>'id')::uuid;
  BEGIN PERFORM set_rsvp_decline_reason(rid,'nope'); ok:=false;
  EXCEPTION WHEN others THEN ok:=true; END;
  PERFORM rep('R21 non-decline refused', ok);

  -- Guests still cannot UPDATE rsvps directly.
  UPDATE rsvps SET name='Hijacked' WHERE id=rid;
  PERFORM rep('R22 direct rsvp update still blocked',
    (SELECT count(*) FROM rsvps WHERE name='Hijacked')=0);
END $$;
RESET ROLE;
