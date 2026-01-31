-- ChatMind opt-in memory (per user)

CREATE TABLE IF NOT EXISTS public.chatmind_memory (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chatmind_memory ENABLE ROW LEVEL SECURITY;

-- Users can read their own memory
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chatmind_memory'
      AND policyname = 'Users can read own chatmind memory'
  ) THEN
    CREATE POLICY "Users can read own chatmind memory"
      ON public.chatmind_memory
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END$$;

-- Users can create their own memory row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chatmind_memory'
      AND policyname = 'Users can insert own chatmind memory'
  ) THEN
    CREATE POLICY "Users can insert own chatmind memory"
      ON public.chatmind_memory
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

-- Users can update their own memory row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chatmind_memory'
      AND policyname = 'Users can update own chatmind memory'
  ) THEN
    CREATE POLICY "Users can update own chatmind memory"
      ON public.chatmind_memory
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

-- Users can delete their own memory row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chatmind_memory'
      AND policyname = 'Users can delete own chatmind memory'
  ) THEN
    CREATE POLICY "Users can delete own chatmind memory"
      ON public.chatmind_memory
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END$$;

-- updated_at trigger (re-uses existing helper function set_updated_at_timestamp if present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at_timestamp') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_chatmind_memory_updated_at') THEN
      CREATE TRIGGER set_chatmind_memory_updated_at
      BEFORE UPDATE ON public.chatmind_memory
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at_timestamp();
    END IF;
  END IF;
END$$;
