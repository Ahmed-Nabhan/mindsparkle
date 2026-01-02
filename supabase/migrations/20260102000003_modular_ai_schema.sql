-- ============================================
-- Step 8: Modular AI & Future Proofing Schema Updates
-- ============================================
-- This migration extends the AI processing tables to support:
-- 1. Multiple AI providers (OpenAI, Gemini, Anthropic, etc.)
-- 2. Enhanced validation tracking
-- 3. Multi-pass processing metadata
-- 4. Fallback model tracking

-- ============================================
-- Create AI Provider ENUM (if needed in future)
-- ============================================
-- Note: Using TEXT for flexibility, but could be ENUM for strictness
-- Currently supported: 'openai', 'google', 'anthropic', 'mistral', 'local'

-- ============================================
-- Update document_analysis table
-- Add new columns for modular AI support
-- ============================================

-- Add AI provider column
ALTER TABLE document_analysis
ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai';

-- Add fallback models used (array of model names)
ALTER TABLE document_analysis
ADD COLUMN IF NOT EXISTS fallback_models_used TEXT[];

-- Add validation score column
ALTER TABLE document_analysis
ADD COLUMN IF NOT EXISTS validation_score FLOAT;

-- Add multi-pass metadata
ALTER TABLE document_analysis
ADD COLUMN IF NOT EXISTS pass_count INTEGER DEFAULT 1;

-- Add processing metadata as JSONB for extensibility
ALTER TABLE document_analysis
ADD COLUMN IF NOT EXISTS processing_metadata JSONB DEFAULT '{}'::jsonb;

-- Comment explaining the new columns
COMMENT ON COLUMN document_analysis.ai_provider IS 'AI provider used: openai, google, anthropic, mistral, local';
COMMENT ON COLUMN document_analysis.fallback_models_used IS 'Array of fallback models that were tried during processing';
COMMENT ON COLUMN document_analysis.validation_score IS 'Final validation score from ValidationLayer (0-100)';
COMMENT ON COLUMN document_analysis.pass_count IS 'Number of passes completed in multi-pass processing';
COMMENT ON COLUMN document_analysis.processing_metadata IS 'Extensible JSONB for additional processing metadata';

-- ============================================
-- Update ai_summaries table
-- Add new columns for enhanced tracking
-- ============================================

-- Add AI provider column
ALTER TABLE ai_summaries
ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai';

-- Add warnings from validation
ALTER TABLE ai_summaries
ADD COLUMN IF NOT EXISTS validation_warnings TEXT[];

-- Add source grounding score
ALTER TABLE ai_summaries
ADD COLUMN IF NOT EXISTS grounding_score FLOAT;

-- Add metadata for extensibility
ALTER TABLE ai_summaries
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Comment explaining the new columns
COMMENT ON COLUMN ai_summaries.ai_provider IS 'AI provider used: openai, google, anthropic, mistral, local';
COMMENT ON COLUMN ai_summaries.validation_warnings IS 'Array of validation warnings generated during processing';
COMMENT ON COLUMN ai_summaries.grounding_score IS 'Percentage of content grounded in source document (0-100)';
COMMENT ON COLUMN ai_summaries.metadata IS 'Extensible JSONB for additional summary metadata';

-- ============================================
-- Create AI Provider Usage Stats Table
-- Track usage per provider for analytics and cost management
-- ============================================
CREATE TABLE IF NOT EXISTS ai_provider_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Provider info
    provider TEXT NOT NULL, -- 'openai', 'google', 'anthropic', etc.
    model TEXT NOT NULL, -- 'gpt-4o', 'gemini-2.5-pro', etc.
    
    -- Usage metrics
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    estimated_cost FLOAT NOT NULL DEFAULT 0,
    
    -- Request metadata
    request_type TEXT, -- 'summary', 'quiz', 'labs', etc.
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    
    -- Success/failure tracking
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    
    -- Performance
    latency_ms INTEGER,
    was_fallback BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Date for aggregation
    usage_date DATE DEFAULT CURRENT_DATE
);

-- RLS for ai_provider_usage
ALTER TABLE ai_provider_usage ENABLE ROW LEVEL SECURITY;

-- Users can view their own usage
CREATE POLICY "Users can view own provider usage" ON ai_provider_usage
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own usage records
CREATE POLICY "Users can insert own provider usage" ON ai_provider_usage
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can view all usage (for analytics)
-- Uses the is_admin() function from RBAC migration
CREATE POLICY "Admins can view all provider usage" ON ai_provider_usage
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles 
            WHERE user_roles.user_id = auth.uid() 
            AND user_roles.role = 'admin'
        )
    );

-- Indexes for analytics queries
CREATE INDEX idx_ai_provider_usage_user_id ON ai_provider_usage(user_id);
CREATE INDEX idx_ai_provider_usage_provider ON ai_provider_usage(provider);
CREATE INDEX idx_ai_provider_usage_model ON ai_provider_usage(model);
CREATE INDEX idx_ai_provider_usage_date ON ai_provider_usage(usage_date);
CREATE INDEX idx_ai_provider_usage_document ON ai_provider_usage(document_id);

-- ============================================
-- Create function to log AI provider usage
-- Called from Edge Functions after each AI call
-- ============================================
CREATE OR REPLACE FUNCTION log_ai_usage(
    p_user_id UUID,
    p_provider TEXT,
    p_model TEXT,
    p_tokens_input INTEGER,
    p_tokens_output INTEGER,
    p_estimated_cost FLOAT,
    p_request_type TEXT DEFAULT NULL,
    p_document_id UUID DEFAULT NULL,
    p_success BOOLEAN DEFAULT TRUE,
    p_error_message TEXT DEFAULT NULL,
    p_latency_ms INTEGER DEFAULT NULL,
    p_was_fallback BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage_id UUID;
BEGIN
    INSERT INTO ai_provider_usage (
        user_id, provider, model, tokens_input, tokens_output,
        estimated_cost, request_type, document_id, success,
        error_message, latency_ms, was_fallback
    ) VALUES (
        p_user_id, p_provider, p_model, p_tokens_input, p_tokens_output,
        p_estimated_cost, p_request_type, p_document_id, p_success,
        p_error_message, p_latency_ms, p_was_fallback
    )
    RETURNING id INTO v_usage_id;
    
    RETURN v_usage_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION log_ai_usage TO authenticated;

-- ============================================
-- Create view for daily usage summary
-- Useful for dashboards and cost tracking
-- ============================================
CREATE OR REPLACE VIEW daily_ai_usage_summary AS
SELECT 
    user_id,
    usage_date,
    provider,
    model,
    COUNT(*) as request_count,
    SUM(tokens_input) as total_tokens_input,
    SUM(tokens_output) as total_tokens_output,
    SUM(estimated_cost) as total_cost,
    COUNT(*) FILTER (WHERE success = TRUE) as successful_requests,
    COUNT(*) FILTER (WHERE success = FALSE) as failed_requests,
    COUNT(*) FILTER (WHERE was_fallback = TRUE) as fallback_requests,
    AVG(latency_ms) as avg_latency_ms
FROM ai_provider_usage
GROUP BY user_id, usage_date, provider, model;

-- ============================================
-- Add update trigger for document_analysis
-- ============================================
CREATE OR REPLACE FUNCTION update_document_analysis_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_update_document_analysis_timestamp ON document_analysis;
CREATE TRIGGER trigger_update_document_analysis_timestamp
    BEFORE UPDATE ON document_analysis
    FOR EACH ROW
    EXECUTE FUNCTION update_document_analysis_timestamp();

-- Same for ai_summaries
DROP TRIGGER IF EXISTS trigger_update_ai_summaries_timestamp ON ai_summaries;
CREATE TRIGGER trigger_update_ai_summaries_timestamp
    BEFORE UPDATE ON ai_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_document_analysis_timestamp();
