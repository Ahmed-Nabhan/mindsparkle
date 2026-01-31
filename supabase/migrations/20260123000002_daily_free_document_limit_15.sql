-- Increase free-tier daily document upload limit from 5/day to 15/day

-- Update helper default
CREATE OR REPLACE FUNCTION public.can_upload_document_today(p_user_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 15)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  used_today INTEGER;
  start_of_day TIMESTAMPTZ;
  start_of_next_day TIMESTAMPTZ;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());
  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 THEN
    RETURN FALSE;
  END IF;

  start_of_day := date_trunc('day', NOW());
  start_of_next_day := start_of_day + interval '1 day';

  -- Count uploads today. Include soft-deleted rows to prevent bypass.
  SELECT COUNT(*)
  INTO used_today
  FROM public.documents d
  WHERE d.user_id = target_user_id
    AND d.created_at >= start_of_day
    AND d.created_at < start_of_next_day;

  RETURN COALESCE(used_today, 0) < p_limit;
END;
$$;

-- Recreate documents insert policy with the new limit
DROP POLICY IF EXISTS "users_insert_own_documents" ON public.documents;

CREATE POLICY "users_insert_own_documents" ON public.documents
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.check_is_admin_safe(auth.uid())
      OR public.is_premium_user(auth.uid())
      OR public.can_upload_document_today(auth.uid(), 15)
    )
  );
