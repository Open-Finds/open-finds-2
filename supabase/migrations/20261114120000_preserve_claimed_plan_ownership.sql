-- Device claims are one-way. Preserve legacy NULL-to-account claims and
-- prevent subsequent ownership changes through ordinary row updates.
CREATE FUNCTION public.preserve_claimed_plan_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Claimed ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_claimed_plan_ownership() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER preserve_claimed_plan_ownership
BEFORE UPDATE OF owner_id ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.preserve_claimed_plan_ownership();

CREATE TRIGGER preserve_claimed_trip_ownership
BEFORE UPDATE OF owner_id ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.preserve_claimed_plan_ownership();
