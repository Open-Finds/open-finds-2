-- ROLLBACK for supabase/migrations/20261117130000_ai_save_attempt_allowance.sql
-- Undoes: the AI Save attempt counter (table and function)
-- Data effect: drops the attempt counters (short-lived; they only limit testing attempts)
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

DROP FUNCTION IF EXISTS public.claim_ai_save_attempt(uuid, uuid, integer, integer, integer);
DROP TABLE IF EXISTS public.ai_save_attempts;
