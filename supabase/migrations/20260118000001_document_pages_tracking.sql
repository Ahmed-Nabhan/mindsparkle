-- Add page-level extraction tracking to prevent silent misses
--
-- Introduces:
-- - document_pages table (RLS: users read own via documents; only service_role writes)
-- - document_coverage_v view for coverage reporting
-- - updated_at trigger
-- - extraction_status standardization ('failed' not 'error')

BEGIN;

-- ============================================
-- 1) document_pages table
-- ============================================

CREATE TABLE IF NOT EXISTS document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index INT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'pending',
  method TEXT,
  confidence DOUBLE PRECISION,
  text_length INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT document_pages_page_index_check CHECK (page_index >= 1),
  CONSTRAINT document_pages_kind_check CHECK (kind IN ('text', 'scanned', 'blank', 'unknown')),
  CONSTRAINT document_pages_status_check CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  CONSTRAINT document_pages_method_check CHECK (method IS NULL OR method IN ('pdf_text', 'ocr', 'doc_ai', 'fallback')),
  CONSTRAINT document_pages_text_length_check CHECK (text_length >= 0),
  CONSTRAINT document_pages_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  UNIQUE (document_id, page_index)
);

CREATE INDEX IF NOT EXISTS idx_document_pages_document_id ON document_pages(document_id);
CREATE INDEX IF NOT EXISTS idx_document_pages_status ON document_pages(status);

-- ============================================
-- 3) Trigger to maintain updated_at
-- ============================================

-- Keep updated_at fresh (safe to re-define; already used in other migrations)
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_document_pages_updated_at ON document_pages;
CREATE TRIGGER set_document_pages_updated_at
BEFORE UPDATE ON document_pages
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- ============================================
-- 4) RLS (users read own via documents, only service_role can write)
-- ============================================

ALTER TABLE document_pages ENABLE ROW LEVEL SECURITY;

-- Ensure explicit grants match policy intent
REVOKE ALL ON TABLE document_pages FROM anon;
REVOKE ALL ON TABLE document_pages FROM authenticated;
GRANT SELECT ON TABLE document_pages TO authenticated;
GRANT ALL ON TABLE document_pages TO service_role;

DROP POLICY IF EXISTS "users_select_own_document_pages" ON document_pages;
CREATE POLICY "users_select_own_document_pages" ON document_pages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = document_pages.document_id
        AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_manage_document_pages" ON document_pages;
CREATE POLICY "service_manage_document_pages" ON document_pages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 2) Coverage view
-- ============================================

DROP VIEW IF EXISTS document_coverage_v;

-- Use security_invoker so RLS is evaluated for the caller, not the view owner.
CREATE VIEW document_coverage_v
WITH (security_invoker = true)
AS
WITH per_doc AS (
  SELECT
    d.id AS document_id,
    COALESCE(d.page_count, MAX(dp.page_index), 0) AS page_count,
    COUNT(*) FILTER (WHERE dp.status = 'done') AS done_pages,
    COUNT(*) FILTER (WHERE dp.status = 'failed') AS failed_pages,
    COUNT(*) FILTER (WHERE dp.status = 'skipped') AS skipped_pages
  FROM documents d
  LEFT JOIN document_pages dp ON dp.document_id = d.id
  GROUP BY d.id, d.page_count
)
SELECT
  document_id,
  page_count,
  done_pages,
  failed_pages,
  skipped_pages,
  CASE
    WHEN page_count > 0 THEN (done_pages::DOUBLE PRECISION / page_count::DOUBLE PRECISION)
    ELSE 0::DOUBLE PRECISION
  END AS coverage_ratio
FROM per_doc;

REVOKE ALL ON TABLE document_coverage_v FROM anon;
REVOKE ALL ON TABLE document_coverage_v FROM authenticated;
GRANT SELECT ON TABLE document_coverage_v TO authenticated;
GRANT SELECT ON TABLE document_coverage_v TO service_role;

-- ============================================
-- 5) Standardize documents.extraction_status ('failed' not 'error')
-- ============================================

UPDATE documents
SET extraction_status = 'failed'
WHERE extraction_status = 'error';

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_extraction_status_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_extraction_status_check
  CHECK (
    extraction_status IN (
      'uploaded',
      'processing',
      'extracted',
      'analyzed',
      'failed',
      'pending',
      'completed'
    )
  );

COMMIT;
