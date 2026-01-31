-- Store chunked extraction outputs (pages/tables/layout) without bloating documents.canonical_content

CREATE TABLE IF NOT EXISTS document_extraction_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  chunk_start_page INTEGER NOT NULL CHECK (chunk_start_page >= 1),
  chunk_end_page   INTEGER NOT NULL CHECK (chunk_end_page >= chunk_start_page),

  provider TEXT NOT NULL CHECK (provider IN ('azure_di', 'google_document_ai', 'fallback')),

  -- Structured output for this chunk (canonical-ish)
  content JSONB NOT NULL,

  text_length INTEGER DEFAULT 0,
  confidence DOUBLE PRECISION,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_document_chunk_provider UNIQUE (document_id, chunk_start_page, chunk_end_page, provider)
);

CREATE INDEX IF NOT EXISTS idx_document_extraction_chunks_document_id ON document_extraction_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_extraction_chunks_provider ON document_extraction_chunks(provider);

ALTER TABLE document_extraction_chunks ENABLE ROW LEVEL SECURITY;

-- Users can read chunks for their own documents
CREATE POLICY "users_select_own_document_extraction_chunks" ON document_extraction_chunks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_id
      AND d.user_id = auth.uid()
      AND d.deleted_at IS NULL
    )
  );

-- Service role can manage chunks (Edge Functions)
CREATE POLICY "service_manage_document_extraction_chunks" ON document_extraction_chunks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_document_extraction_chunks_timestamp ON document_extraction_chunks;
CREATE TRIGGER trigger_update_document_extraction_chunks_timestamp
  BEFORE UPDATE ON document_extraction_chunks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_timestamp();
