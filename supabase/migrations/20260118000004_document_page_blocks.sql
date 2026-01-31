-- Per-page block inventory so nothing is silently dropped (tables/figures/diagrams/equations).

-- 1) document_page_blocks table
CREATE TABLE IF NOT EXISTS document_page_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index integer NOT NULL,
  block_index integer NOT NULL,
  block_type text NOT NULL,
  bbox jsonb NOT NULL DEFAULT '{"x":0,"y":0,"w":1,"h":1}'::jsonb,
  text text NULL,
  data jsonb NULL,
  confidence double precision NULL,
  status text NOT NULL DEFAULT 'detected',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT document_page_blocks_page_index_check CHECK (page_index >= 1),
  CONSTRAINT document_page_blocks_block_index_check CHECK (block_index >= 1),
  CONSTRAINT document_page_blocks_type_check CHECK (block_type IN (
    'paragraph','heading','list','table','figure','diagram','equation','unknown'
  )),
  CONSTRAINT document_page_blocks_status_check CHECK (status IN (
    'detected','extracted','vision_pending','failed'
  )),
  CONSTRAINT document_page_blocks_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

-- Uniqueness and access patterns
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_page_blocks_page_block
  ON document_page_blocks(document_id, page_index, block_index);

CREATE INDEX IF NOT EXISTS idx_document_page_blocks_document_page
  ON document_page_blocks(document_id, page_index);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_document_page_blocks_updated_at ON document_page_blocks;
CREATE TRIGGER set_document_page_blocks_updated_at
BEFORE UPDATE ON document_page_blocks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- RLS: users can read blocks for their own documents; only service_role writes
ALTER TABLE document_page_blocks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE document_page_blocks FROM anon;
REVOKE ALL ON TABLE document_page_blocks FROM authenticated;
GRANT SELECT ON TABLE document_page_blocks TO authenticated;
GRANT ALL ON TABLE document_page_blocks TO service_role;

DROP POLICY IF EXISTS "users_select_own_document_page_blocks" ON document_page_blocks;
CREATE POLICY "users_select_own_document_page_blocks" ON document_page_blocks
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM documents d
    WHERE d.id = document_page_blocks.document_id
      AND d.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "service_manage_document_page_blocks" ON document_page_blocks;
CREATE POLICY "service_manage_document_page_blocks" ON document_page_blocks
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- 2) Storage bucket for rendered page assets
-- Bucket: doc_assets (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'doc_assets',
  'doc_assets',
  false,
  1073741824, -- 1GB
  ARRAY['image/png']
) ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = EXCLUDED.public;

-- Users can read assets for documents they own.
-- Object name format: {documentId}/page_{NNN}.png
DROP POLICY IF EXISTS "Users can read doc assets for own documents" ON storage.objects;
CREATE POLICY "Users can read doc assets for own documents" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'doc_assets'
  AND EXISTS (
    SELECT 1
    FROM documents d
    WHERE d.id::text = (storage.foldername(name))[1]
      AND d.user_id = auth.uid()
  )
);

-- Only service role writes assets
DROP POLICY IF EXISTS "Service role full access to doc_assets" ON storage.objects;
CREATE POLICY "Service role full access to doc_assets" ON storage.objects
FOR ALL TO service_role
USING (bucket_id = 'doc_assets')
WITH CHECK (bucket_id = 'doc_assets');
