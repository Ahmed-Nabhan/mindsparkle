-- Enforce daily free-tier limits server-side
-- - Documents: max 5 uploads/day for free users
-- - Premium users (pro/enterprise) bypass limits

-- Helper: premium check (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_premium_user(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  v_is_active BOOLEAN;
  v_tier TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());
  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT is_active, tier, expires_at
  INTO v_is_active, v_tier, v_expires_at
  FROM public.user_subscriptions
  WHERE user_id = target_user_id
  LIMIT 1;

  RETURN COALESCE(v_is_active, FALSE)
    AND (v_expires_at IS NULL OR v_expires_at > NOW())
    AND COALESCE(v_tier, 'free') IN ('pro', 'enterprise');
END;
$$;

-- Helper: check if user is under daily document upload limit
CREATE OR REPLACE FUNCTION public.can_upload_document_today(p_user_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 5)
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

-- Replace documents insert policy to enforce daily free-tier limit
DROP POLICY IF EXISTS "users_insert_own_documents" ON public.documents;

CREATE POLICY "users_insert_own_documents" ON public.documents
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.check_is_admin_safe(auth.uid())
      OR public.is_premium_user(auth.uid())
      OR public.can_upload_document_today(auth.uid(), 5)
    )
  );
