-- Make free-tier daily document upload limit configurable via DB setting

-- Simple key/value settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default value (keeps current behavior: 15/day)
INSERT INTO public.app_settings (key, value)
VALUES ('free_document_daily_limit', '15')
ON CONFLICT (key) DO NOTHING;

-- Helper to read integer setting safely
CREATE OR REPLACE FUNCTION public.get_app_setting_int(p_key TEXT, p_default INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value TEXT;
  v_int INTEGER;
BEGIN
  SELECT s.value
  INTO v_value
  FROM public.app_settings s
  WHERE s.key = p_key
  LIMIT 1;

  IF v_value IS NULL OR btrim(v_value) = '' THEN
    RETURN p_default;
  END IF;

  BEGIN
    v_int := v_value::INTEGER;
  EXCEPTION WHEN others THEN
    RETURN p_default;
  END;

  IF v_int IS NULL OR v_int <= 0 THEN
    RETURN p_default;
  END IF;

  RETURN v_int;
END;
$$;

-- Update helper to use setting when limit not explicitly provided
CREATE OR REPLACE FUNCTION public.can_upload_document_today(p_user_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT NULL)
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
  effective_limit INTEGER;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());
  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  effective_limit := COALESCE(
    p_limit,
    public.get_app_setting_int('free_document_daily_limit', 15)
  );

  IF effective_limit IS NULL OR effective_limit <= 0 THEN
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

  RETURN COALESCE(used_today, 0) < effective_limit;
END;
$$;

-- Recreate documents insert policy to use configurable limit
DROP POLICY IF EXISTS "users_insert_own_documents" ON public.documents;

CREATE POLICY "users_insert_own_documents" ON public.documents
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.check_is_admin_safe(auth.uid())
      OR public.is_premium_user(auth.uid())
      OR public.can_upload_document_today(auth.uid())
    )
  );
