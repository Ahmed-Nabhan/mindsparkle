-- AI Document Processing Schema for MindSparkle
-- Stores AI-generated analysis, summaries, and knowledge graphs

-- ============================================
-- Document Analysis Table
-- Stores vendor detection, complexity analysis, and AI metadata
-- ============================================
CREATE TABLE IF NOT EXISTS document_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Vendor Detection Results
    vendor_id TEXT, -- 'cisco', 'aws', 'microsoft', etc.
    vendor_name TEXT,
    vendor_confidence FLOAT,
    certification_detected TEXT, -- 'CCNA', 'AWS-SAA', etc.
    
    -- Content Analysis
    complexity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'expert'
    has_cli_commands BOOLEAN DEFAULT FALSE,
    has_config_blocks BOOLEAN DEFAULT FALSE,
    content_length INTEGER,
    
    -- AI Processing Info
    processing_status TEXT DEFAULT 'pending', -- 'pending', 'analyzing', 'processing', 'complete', 'error'
    processing_progress INTEGER DEFAULT 0, -- 0-100
    processing_message TEXT,
    processing_error TEXT,
    
    -- Model Used
    ai_model TEXT, -- 'gpt-4o-mini', 'gpt-4o', etc.
    tokens_used INTEGER,
    processing_cost FLOAT,
    
    -- Suggested Features
    suggested_modes TEXT[], -- ['study', 'quiz', 'labs', etc.]
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    
    -- Unique constraint: one analysis per document
    CONSTRAINT unique_document_analysis UNIQUE (document_id)
);

-- RLS for document_analysis
ALTER TABLE document_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analyses" ON document_analysis
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses" ON document_analysis
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analyses" ON document_analysis
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses" ON document_analysis
    FOR DELETE USING (auth.uid() = user_id);

-- Indexes for faster queries
CREATE INDEX idx_document_analysis_user_id ON document_analysis(user_id);
CREATE INDEX idx_document_analysis_document_id ON document_analysis(document_id);
CREATE INDEX idx_document_analysis_vendor ON document_analysis(vendor_id);
CREATE INDEX idx_document_analysis_status ON document_analysis(processing_status);

-- ============================================
-- AI Generated Summaries Table
-- Stores different types of AI summaries per document
-- ============================================
CREATE TABLE IF NOT EXISTS ai_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Summary Type
    summary_type TEXT NOT NULL, -- 'summary', 'study', 'quiz', 'labs', 'interview', 'video', 'flashcards'
    language TEXT DEFAULT 'en', -- 'en' or 'ar'
    
    -- Content
    content TEXT NOT NULL,
    
    -- Validation
    validation_passed BOOLEAN DEFAULT TRUE,
    validation_score FLOAT, -- 0-100
    corrections_made INTEGER DEFAULT 0,
    
    -- Metadata
    ai_model TEXT,
    tokens_used INTEGER,
    processing_time_ms INTEGER,
    
    -- Multi-pass info
    passes_completed INTEGER DEFAULT 1,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint: one summary per document/type/language combo
    CONSTRAINT unique_summary UNIQUE (document_id, summary_type, language)
);

-- RLS for ai_summaries
ALTER TABLE ai_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own summaries" ON ai_summaries
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own summaries" ON ai_summaries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own summaries" ON ai_summaries
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own summaries" ON ai_summaries
    FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_ai_summaries_user_id ON ai_summaries(user_id);
CREATE INDEX idx_ai_summaries_document_id ON ai_summaries(document_id);
CREATE INDEX idx_ai_summaries_type ON ai_summaries(summary_type);

-- ============================================
-- Knowledge Graphs Table
-- Stores extracted knowledge structures
-- ============================================
CREATE TABLE IF NOT EXISTS knowledge_graphs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Graph Structure (stored as JSONB for flexibility)
    nodes JSONB NOT NULL DEFAULT '[]', -- Array of {id, label, type, metadata}
    edges JSONB NOT NULL DEFAULT '[]', -- Array of {source, target, type, weight}
    root_nodes TEXT[], -- IDs of top-level concepts
    
    -- Metrics
    node_count INTEGER DEFAULT 0,
    edge_count INTEGER DEFAULT 0,
    max_depth INTEGER DEFAULT 0,
    
    -- Learning Paths (derived from graph)
    learning_paths JSONB DEFAULT '[]', -- Array of ordered concept sequences
    concept_clusters JSONB DEFAULT '[]', -- Related concept groups
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint: one graph per document
    CONSTRAINT unique_knowledge_graph UNIQUE (document_id)
);

-- RLS for knowledge_graphs
ALTER TABLE knowledge_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own knowledge graphs" ON knowledge_graphs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own knowledge graphs" ON knowledge_graphs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own knowledge graphs" ON knowledge_graphs
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own knowledge graphs" ON knowledge_graphs
    FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_knowledge_graphs_user_id ON knowledge_graphs(user_id);
CREATE INDEX idx_knowledge_graphs_document_id ON knowledge_graphs(document_id);

-- ============================================
-- Processing Queue Table
-- Tracks documents waiting for AI processing
-- ============================================
CREATE TABLE IF NOT EXISTS processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Processing Request
    requested_modes TEXT[] NOT NULL DEFAULT ARRAY['summary'], -- What to generate
    priority INTEGER DEFAULT 5, -- 1 (highest) to 10 (lowest)
    language TEXT DEFAULT 'en',
    
    -- Status
    status TEXT DEFAULT 'queued', -- 'queued', 'processing', 'complete', 'error'
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Timestamps
    queued_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Unique constraint: one queue entry per document (prevents duplicates)
    CONSTRAINT unique_queue_entry UNIQUE (document_id)
);

-- RLS for processing_queue
ALTER TABLE processing_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own queue" ON processing_queue
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queue" ON processing_queue
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queue" ON processing_queue
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own queue" ON processing_queue
    FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_processing_queue_status ON processing_queue(status);
CREATE INDEX idx_processing_queue_priority ON processing_queue(priority, queued_at);

-- ============================================
-- Function to auto-queue document for processing
-- Called after document insert
-- ============================================
CREATE OR REPLACE FUNCTION queue_document_for_processing()
RETURNS TRIGGER AS $$
BEGIN
    -- Only queue if document has content
    IF NEW.content IS NOT NULL AND LENGTH(NEW.content) > 100 THEN
        INSERT INTO processing_queue (user_id, document_id, requested_modes)
        VALUES (NEW.user_id, NEW.id, ARRAY['summary', 'quiz', 'flashcards'])
        ON CONFLICT (document_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-queue new documents
DROP TRIGGER IF EXISTS trigger_queue_document ON documents;
CREATE TRIGGER trigger_queue_document
    AFTER INSERT ON documents
    FOR EACH ROW
    EXECUTE FUNCTION queue_document_for_processing();

-- ============================================
-- Function to update document analysis timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_analysis_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update timestamp triggers
CREATE TRIGGER trigger_update_document_analysis_timestamp
    BEFORE UPDATE ON document_analysis
    FOR EACH ROW
    EXECUTE FUNCTION update_analysis_timestamp();

CREATE TRIGGER trigger_update_ai_summaries_timestamp
    BEFORE UPDATE ON ai_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_analysis_timestamp();

CREATE TRIGGER trigger_update_knowledge_graphs_timestamp
    BEFORE UPDATE ON knowledge_graphs
    FOR EACH ROW
    EXECUTE FUNCTION update_analysis_timestamp();
