/*
# AI Save results: signed-in users get only read, add and update

Supabase gives new tables broad default rights for signed-in users (including DELETE and
TRUNCATE; TRUNCATE is not covered by row security). This leaves them only what the app needs.

Rollback: nothing to undo (it only narrows access).
*/
REVOKE ALL ON public.ai_save_results FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_save_results TO authenticated;
