-- Cloud Storage Schema for MindSparkle
-- Supports hybrid local/cloud document processing with tiered storage limits

-- ============================================
-- User Storage Tracking Table
-- ============================================
CREATE TABLE IF NOT EXISTS user_storage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    used_bytes BIGINT DEFAULT 0,
    file_count INTEGER DEFAULT 0,
    -- Storage limits in bytes (5GB free, 200GB pro)
    storage_limit_bytes BIGINT DEFAULT 5368709120, -- 5GB default (free tier)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for user_storage
ALTER TABLE user_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own storage" ON user_storage
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own storage" ON user_storage
    FOR UPDATE USING (auth.uid() = user_id);

-- Service role can insert/update for any user (used by edge functions)
CREATE POLICY "Service can manage storage" ON user_storage
    FOR ALL USING (true);

-- Index for faster lookups
CREATE INDEX idx_user_storage_user_id ON user_storage(user_id);

-- ============================================
-- Cloud Documents Table (for large files)
-- ============================================
CREATE TABLE IF NOT EXISTS cloud_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL, -- Local document ID reference
    title TEXT NOT NULL,
    file_type TEXT,
    file_size BIGINT NOT NULL, -- Size in bytes
    storage_path TEXT NOT NULL, -- Path in Supabase Storage
    storage_bucket TEXT DEFAULT 'documents',
    -- Processing status
    status TEXT DEFAULT 'uploading', -- uploading, processing, ready, error
    processing_error TEXT,
    -- Extracted content (populated by edge function)
    extracted_text TEXT,
    page_count INTEGER,
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- RLS for cloud_documents
ALTER TABLE cloud_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cloud documents" ON cloud_documents
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cloud documents" ON cloud_documents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cloud documents" ON cloud_documents
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cloud documents" ON cloud_documents
    FOR DELETE USING (auth.uid() = user_id);

-- Service role policy for edge functions
CREATE POLICY "Service can manage cloud documents" ON cloud_documents
    FOR ALL USING (true);

-- Indexes
CREATE INDEX idx_cloud_documents_user_id ON cloud_documents(user_id);
CREATE INDEX idx_cloud_documents_document_id ON cloud_documents(document_id);
CREATE INDEX idx_cloud_documents_status ON cloud_documents(status);

-- ============================================
-- Function to update user storage on insert/delete
-- ============================================
CREATE OR REPLACE FUNCTION update_user_storage_on_cloud_doc()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Add to user's storage
        INSERT INTO user_storage (user_id, used_bytes, file_count)
        VALUES (NEW.user_id, NEW.file_size, 1)
        ON CONFLICT (user_id) DO UPDATE
        SET used_bytes = user_storage.used_bytes + NEW.file_size,
            file_count = user_storage.file_count + 1,
            updated_at = NOW();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Remove from user's storage
        UPDATE user_storage
        SET used_bytes = GREATEST(0, used_bytes - OLD.file_size),
            file_count = GREATEST(0, file_count - 1),
            updated_at = NOW()
        WHERE user_id = OLD.user_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for automatic storage tracking
DROP TRIGGER IF EXISTS trigger_update_storage ON cloud_documents;
CREATE TRIGGER trigger_update_storage
    AFTER INSERT OR DELETE ON cloud_documents
    FOR EACH ROW EXECUTE FUNCTION update_user_storage_on_cloud_doc();

-- ============================================
-- Function to check storage limit before upload
-- ============================================
CREATE OR REPLACE FUNCTION check_storage_limit(p_user_id UUID, p_file_size BIGINT)
RETURNS TABLE (
    allowed BOOLEAN,
    current_used BIGINT,
    storage_limit BIGINT,
    remaining BIGINT
) AS $$
DECLARE
    v_used BIGINT;
    v_limit BIGINT;
BEGIN
    -- Get current usage
    SELECT COALESCE(us.used_bytes, 0), COALESCE(us.storage_limit_bytes, 5368709120)
    INTO v_used, v_limit
    FROM user_storage us
    WHERE us.user_id = p_user_id;
    
    -- If no record exists, use defaults
    IF NOT FOUND THEN
        v_used := 0;
        v_limit := 5368709120; -- 5GB free tier
    END IF;
    
    RETURN QUERY SELECT 
        (v_used + p_file_size) <= v_limit AS allowed,
        v_used AS current_used,
        v_limit AS storage_limit,
        v_limit - v_used AS remaining;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Function to update storage limit (for premium upgrade)
-- ============================================
CREATE OR REPLACE FUNCTION update_storage_limit(p_user_id UUID, p_is_premium BOOLEAN)
RETURNS VOID AS $$
DECLARE
    v_limit BIGINT;
BEGIN
    -- Set limit based on premium status
    -- Free: 5GB, Pro: 200GB
    v_limit := CASE WHEN p_is_premium THEN 214748364800 ELSE 5368709120 END;
    
    INSERT INTO user_storage (user_id, storage_limit_bytes)
    VALUES (p_user_id, v_limit)
    ON CONFLICT (user_id) DO UPDATE
    SET storage_limit_bytes = v_limit,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Create Storage Bucket for documents
-- (This needs to be done via Supabase Dashboard or CLI)
-- ============================================
-- Note: Run this in Supabase Dashboard SQL editor:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);
