/*
# Let a guest record their own decline reason

## Why this is needed
Declined.tsx updates `rsvps.decline_reason` directly. After the M01 lockdown the
only UPDATE policy on rsvps requires owning the parent plan, which a guest by
definition does not — so the decline-reason step broke.

Restoring an open UPDATE is not an option: it would let anyone rewrite any RSVP
on any plan. Instead this is a narrow, single-purpose RPC.

## What it is allowed to do
The guest is handed their own rsvp id immediately after declining (the flow
navigates to /plan/<id>/declined?rsvp=<rsvpId>), so possession of that id is the
capability — the same reasoning as the plan id being the share capability.

It is deliberately one-shot: a reason can only be written onto a row that is
actually declined and does not have one yet. That means a leaked id cannot be
used to repeatedly edit what a guest said, and nothing else on the row — name,
status, plan — can be touched through this path.
*/

CREATE OR REPLACE FUNCTION set_rsvp_decline_reason(
  p_rsvp_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_row rsvps%ROWTYPE;
BEGIN
  IF v_reason = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  -- submit_plan_rsvp writes '' (not NULL) when a decline carries no reason,
  -- so "unanswered" means null-or-empty. Normalised below so future rows are
  -- consistently NULL.
  UPDATE rsvps
     SET decline_reason = v_reason
   WHERE id = p_rsvp_id
     AND status = 'declined'
     AND (decline_reason IS NULL OR btrim(decline_reason) = '')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- Covers all of: unknown id, not a decline, already answered.
    RAISE EXCEPTION 'That RSVP cannot accept a reason';
  END IF;

  -- user_id is the host's device key; never hand it back to a guest.
  RETURN to_jsonb(v_row) - 'user_id';
END;
$$;

REVOKE ALL ON FUNCTION set_rsvp_decline_reason(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_rsvp_decline_reason(uuid, text) TO anon, authenticated;

-- Store NULL rather than '' for an absent reason, so "no reason given" has one
-- representation. Applies to the RSVP submission path going forward...
CREATE OR REPLACE FUNCTION normalise_blank_decline_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) = '' THEN
    NEW.decline_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalise_blank_decline_reason ON rsvps;
CREATE TRIGGER trg_normalise_blank_decline_reason
  BEFORE INSERT OR UPDATE ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION normalise_blank_decline_reason();

-- ...and to anything already stored.
UPDATE rsvps SET decline_reason = NULL
 WHERE decline_reason IS NOT NULL AND btrim(decline_reason) = '';
