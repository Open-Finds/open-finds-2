-- ROLLBACK for supabase/migrations/20261114120000_preserve_claimed_plan_ownership.sql
-- Undoes: the rule that a set plan or trip owner cannot change
-- Data effect: none
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

DROP TRIGGER IF EXISTS preserve_claimed_plan_ownership ON public.plans;
DROP TRIGGER IF EXISTS preserve_claimed_trip_ownership ON public.trips;
DROP FUNCTION IF EXISTS public.preserve_claimed_plan_ownership();
