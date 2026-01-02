-- Fix the handle_new_user function to be more robust
-- This handles cases where profile/stats might already exist (Apple Sign In re-auth)

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert profile, ignore if already exists
    INSERT INTO profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, profiles.email),
        updated_at = NOW();
    
    -- Insert user_stats, ignore if already exists
    INSERT INTO user_stats (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- Insert notification_settings, ignore if already exists
    INSERT INTO notification_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- Insert user_storage for cloud storage tracking
    INSERT INTO user_storage (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail - auth should still succeed
        RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure user_stats has proper unique constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_stats_user_id_key'
    ) THEN
        ALTER TABLE user_stats ADD CONSTRAINT user_stats_user_id_key UNIQUE (user_id);
    END IF;
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

-- Ensure notification_settings has proper unique constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'notification_settings_user_id_key'
    ) THEN
        ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_user_id_key UNIQUE (user_id);
    END IF;
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;
