-- Feature flags for remote config
CREATE TABLE IF NOT EXISTS public.feature_flags (
  feature_name TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- Allow read for everyone (including anon) so apps can fetch config without auth
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feature_flags'
      AND policyname = 'Anyone can read feature flags'
  ) THEN
    CREATE POLICY "Anyone can read feature flags"
      ON public.feature_flags
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- Seed default flags
INSERT INTO public.feature_flags (feature_name, enabled, settings)
VALUES
  ('streaming', true, NULL),
  ('multi_model', true, '{"models": ["claude", "gpt", "gemini"]}'),
  ('retry_button', true, NULL),
  ('like_dislike', true, NULL),
  ('dark_mode', false, NULL),
  ('guest_mode', true, '{"message_limit": 10, "history_retention_hours": 24}')
ON CONFLICT (feature_name) DO NOTHING;

-- Chat messages (for retry + feedback)
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_id TEXT,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  chat_type TEXT NOT NULL DEFAULT 'chatmind',
  prompt TEXT NOT NULL,
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'Users can read own chat messages'
  ) THEN
    CREATE POLICY "Users can read own chat messages"
      ON public.chat_messages
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'Users can insert own chat messages'
  ) THEN
    CREATE POLICY "Users can insert own chat messages"
      ON public.chat_messages
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'Users can update own chat messages'
  ) THEN
    CREATE POLICY "Users can update own chat messages"
      ON public.chat_messages
      FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'Guests can insert chat messages'
  ) THEN
    CREATE POLICY "Guests can insert chat messages"
      ON public.chat_messages
      FOR INSERT
      WITH CHECK (auth.role() = 'anon' AND user_id IS NULL AND guest_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_guest_id ON public.chat_messages(guest_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at);

-- Feedback (like/dislike)
CREATE TABLE IF NOT EXISTS public.chat_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_id TEXT,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.chat_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_feedback'
      AND policyname = 'Users can insert own feedback'
  ) THEN
    CREATE POLICY "Users can insert own feedback"
      ON public.chat_feedback
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_feedback'
      AND policyname = 'Guests can insert feedback'
  ) THEN
    CREATE POLICY "Guests can insert feedback"
      ON public.chat_feedback
      FOR INSERT
      WITH CHECK (auth.role() = 'anon' AND user_id IS NULL AND guest_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_feedback_message_id ON public.chat_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_user_id ON public.chat_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_guest_id ON public.chat_feedback(guest_id);
