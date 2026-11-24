-- ROLLBACK for supabase/migrations/20261112110000_require_plan_invite_ownership.sql
-- Undoes: the rule that only the plan owner can invite
-- Data effect: none
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

ALTER POLICY "insert_plan_invites" ON public.plan_invites
  TO authenticated
  WITH CHECK (invited_by = auth.uid());
