-- Require the inviter to own the plan under the existing account/device rules.
ALTER POLICY "insert_plan_invites" ON public.plan_invites
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.plans AS plan
      WHERE plan.id = plan_invites.plan_id
        AND public.app_is_owner(plan.owner_id, plan.user_id)
    )
  );
