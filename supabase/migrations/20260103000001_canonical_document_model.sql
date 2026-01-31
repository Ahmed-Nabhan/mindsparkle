-- ============================================
-- Migration: Canonical Document Model Support
-- Date: 2026-01-03
-- 
-- Adds columns needed for the new backend-only extraction architecture.
-- ============================================

-- Add new columns to documents table
DO $$ 
BEGIN
    -- Canonical content (JSON with structured pages, tables, figures)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'canonical_content'
    ) THEN
        ALTER TABLE documents ADD COLUMN canonical_content JSONB;
    END IF;

    -- Extraction metadata (method, timing, errors)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'extraction_metadata'
    ) THEN
        ALTER TABLE documents ADD COLUMN extraction_metadata JSONB;
    END IF;

    -- Full extracted text (separate from content for search)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'extracted_text'
    ) THEN
        ALTER TABLE documents ADD COLUMN extracted_text TEXT;
    END IF;

    -- Has extractable text
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'has_text'
    ) THEN
        ALTER TABLE documents ADD COLUMN has_text BOOLEAN DEFAULT FALSE;
    END IF;

    -- Text length
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'text_length'
    ) THEN
        ALTER TABLE documents ADD COLUMN text_length INTEGER DEFAULT 0;
    END IF;

    -- Page count
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'page_count'
    ) THEN
        ALTER TABLE documents ADD COLUMN page_count INTEGER DEFAULT 1;
    END IF;

    -- Word count
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'word_count'
    ) THEN
        ALTER TABLE documents ADD COLUMN word_count INTEGER DEFAULT 0;
    END IF;

    -- Vendor detection
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'vendor_id'
    ) THEN
        ALTER TABLE documents ADD COLUMN vendor_id TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'vendor_name'
    ) THEN
        ALTER TABLE documents ADD COLUMN vendor_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'vendor_confidence'
    ) THEN
        ALTER TABLE documents ADD COLUMN vendor_confidence DECIMAL(3,2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'domain'
    ) THEN
        ALTER TABLE documents ADD COLUMN domain TEXT;
    END IF;

    -- Quality metrics
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'quality_score'
    ) THEN
        ALTER TABLE documents ADD COLUMN quality_score INTEGER DEFAULT 50;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'is_scanned'
    ) THEN
        ALTER TABLE documents ADD COLUMN is_scanned BOOLEAN DEFAULT FALSE;
    END IF;

    -- Processing error
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'processing_error'
    ) THEN
        ALTER TABLE documents ADD COLUMN processing_error TEXT;
    END IF;

    -- Extraction timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'extracted_at'
    ) THEN
        ALTER TABLE documents ADD COLUMN extracted_at TIMESTAMPTZ;
    END IF;

    -- Soft delete
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE documents ADD COLUMN deleted_at TIMESTAMPTZ;
    END IF;

    -- Storage path (if not using file_uri)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'storage_path'
    ) THEN
        ALTER TABLE documents ADD COLUMN storage_path TEXT;
    END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_extraction_status ON documents(extraction_status);
CREATE INDEX IF NOT EXISTS idx_documents_vendor_id ON documents(vendor_id);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_documents_domain ON documents(domain);

-- Enable Realtime for documents table (for status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE documents;

-- Create extraction status enum check
-- First update any existing rows to valid values
UPDATE documents SET extraction_status = 'extracted' 
WHERE extraction_status NOT IN ('uploaded', 'processing', 'extracted', 'analyzed', 'failed')
  AND extraction_status IS NOT NULL;

UPDATE documents SET extraction_status = 'uploaded'
WHERE extraction_status IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'documents_extraction_status_check'
    ) THEN
        ALTER TABLE documents ADD CONSTRAINT documents_extraction_status_check 
        CHECK (extraction_status IN ('uploaded', 'processing', 'extracted', 'analyzed', 'failed', 'pending', 'completed'));
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- Subscription Management Tables
-- ============================================

-- User subscriptions table (for manual subscription control)
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Subscription status
    is_active BOOLEAN DEFAULT FALSE,
    tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    
    -- Source of subscription
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'revenuecat', 'stripe', 'promo')),
    external_id TEXT, -- RevenueCat/Stripe subscription ID
    
    -- Dates
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id)
);

-- RLS for user_subscriptions
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their own subscription
CREATE POLICY "Users can view own subscription" ON user_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

-- Only admins can modify subscriptions
CREATE POLICY "Admins can manage subscriptions" ON user_subscriptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Service role can manage subscriptions (for webhooks)
CREATE POLICY "Service role can manage subscriptions" ON user_subscriptions
    FOR ALL USING (auth.role() = 'service_role');

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires_at ON user_subscriptions(expires_at);

-- ============================================
-- Helper Functions
-- ============================================

-- Function to check if user has active subscription
CREATE OR REPLACE FUNCTION check_subscription(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_is_active BOOLEAN;
BEGIN
    SELECT is_active AND (expires_at IS NULL OR expires_at > NOW())
    INTO v_is_active
    FROM user_subscriptions
    WHERE user_id = p_user_id;
    
    RETURN COALESCE(v_is_active, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to grant subscription (admin only)
CREATE OR REPLACE FUNCTION grant_subscription(
    p_user_id UUID,
    p_tier TEXT DEFAULT 'pro',
    p_days INTEGER DEFAULT 365,
    p_source TEXT DEFAULT 'manual'
)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO user_subscriptions (user_id, is_active, tier, source, started_at, expires_at)
    VALUES (
        p_user_id, 
        TRUE, 
        p_tier, 
        p_source, 
        NOW(), 
        CASE WHEN p_days > 0 THEN NOW() + (p_days || ' days')::INTERVAL ELSE NULL END
    )
    ON CONFLICT (user_id) DO UPDATE SET
        is_active = TRUE,
        tier = p_tier,
        source = p_source,
        started_at = COALESCE(user_subscriptions.started_at, NOW()),
        expires_at = CASE WHEN p_days > 0 THEN NOW() + (p_days || ' days')::INTERVAL ELSE NULL END,
        updated_at = NOW();
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke subscription (admin only)
CREATE OR REPLACE FUNCTION revoke_subscription(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE user_subscriptions
    SET is_active = FALSE, cancelled_at = NOW(), updated_at = NOW()
    WHERE user_id = p_user_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE user_subscriptions IS 'Manual subscription management. Can override RevenueCat for promo codes, enterprise, etc.';
COMMENT ON FUNCTION check_subscription IS 'Check if user has active subscription (for RLS policies)';
COMMENT ON FUNCTION grant_subscription IS 'Admin function to grant subscription to a user';
COMMENT ON FUNCTION revoke_subscription IS 'Admin function to revoke subscription from a user';
