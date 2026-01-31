-- Deep Explain upgrades: pgvector embeddings retrieval + section cache

BEGIN;

-- 1) Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Store embeddings for document extraction chunks
CREATE TABLE IF NOT EXISTS document_chunk_embeddings (
  chunk_id UUID PRIMARY KEY REFERENCES document_extraction_chunks(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_chunk_embeddings_document_id
  ON document_chunk_embeddings(document_id);

-- Vector index for similarity search. NOTE: building this index may take time depending on table size.
CREATE INDEX IF NOT EXISTS idx_document_chunk_embeddings_embedding_ivfflat
  ON document_chunk_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE document_chunk_embeddings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE document_chunk_embeddings FROM anon;
REVOKE ALL ON TABLE document_chunk_embeddings FROM authenticated;
GRANT ALL ON TABLE document_chunk_embeddings TO service_role;

DROP POLICY IF EXISTS "service_manage_document_chunk_embeddings" ON document_chunk_embeddings;
CREATE POLICY "service_manage_document_chunk_embeddings" ON document_chunk_embeddings
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Keep updated_at fresh (function may already exist; safe)
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_document_chunk_embeddings_timestamp ON document_chunk_embeddings;
CREATE TRIGGER trigger_update_document_chunk_embeddings_timestamp
  BEFORE UPDATE ON document_chunk_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_timestamp();

-- 3) Similarity search RPC (service-role only)
CREATE OR REPLACE FUNCTION match_document_chunks(
  p_document_id UUID,
  p_query_embedding TEXT,
  p_match_count INT DEFAULT 5
)
RETURNS TABLE(
  chunk_id UUID,
  chunk_start_page INT,
  chunk_end_page INT,
  content JSONB,
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.chunk_start_page,
    c.chunk_end_page,
    c.content,
    1 - (e.embedding <=> (p_query_embedding)::vector) AS similarity
  FROM document_chunk_embeddings e
  JOIN document_extraction_chunks c ON c.id = e.chunk_id
  WHERE e.document_id = p_document_id
  ORDER BY e.embedding <=> (p_query_embedding)::vector
  LIMIT LEAST(GREATEST(p_match_count, 1), 20);
END;
$$;

REVOKE ALL ON FUNCTION match_document_chunks(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_document_chunks(UUID, TEXT, INT) TO service_role;

-- 4) Cache Deep Explain sections (internal)
CREATE TABLE IF NOT EXISTS deep_explain_section_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_updated_at TIMESTAMPTZ NOT NULL,
  topic TEXT NOT NULL,
  chunk_ids UUID[] NOT NULL,
  chunk_ids_hash TEXT NOT NULL,
  section_json JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deep_explain_section_cache_key
  ON deep_explain_section_cache(document_id, document_updated_at, topic, chunk_ids_hash);

CREATE INDEX IF NOT EXISTS idx_deep_explain_section_cache_document
  ON deep_explain_section_cache(document_id);

ALTER TABLE deep_explain_section_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE deep_explain_section_cache FROM anon;
REVOKE ALL ON TABLE deep_explain_section_cache FROM authenticated;
GRANT ALL ON TABLE deep_explain_section_cache TO service_role;

DROP POLICY IF EXISTS "service_manage_deep_explain_section_cache" ON deep_explain_section_cache;
CREATE POLICY "service_manage_deep_explain_section_cache" ON deep_explain_section_cache
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
