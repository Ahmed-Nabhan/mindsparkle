-- Document outputs for background-generated results (e.g., deep_explain)

BEGIN;

CREATE TABLE IF NOT EXISTS document_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  output_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  content jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT document_outputs_status_check CHECK (status IN ('queued','processing','completed','failed'))
);

-- Keep one "current" output per type per document
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_outputs_doc_type
  ON document_outputs(document_id, output_type);

CREATE INDEX IF NOT EXISTS idx_document_outputs_user_id
  ON document_outputs(user_id);

CREATE INDEX IF NOT EXISTS idx_document_outputs_document_id
  ON document_outputs(document_id);

-- updated_at trigger helper (may already exist; safe to replace)
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_document_outputs_updated_at ON document_outputs;
CREATE TRIGGER set_document_outputs_updated_at
BEFORE UPDATE ON document_outputs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- RLS: users can select their outputs; service_role manages writes
ALTER TABLE document_outputs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE document_outputs FROM anon;
REVOKE ALL ON TABLE document_outputs FROM authenticated;
GRANT SELECT ON TABLE document_outputs TO authenticated;
GRANT ALL ON TABLE document_outputs TO service_role;

DROP POLICY IF EXISTS "users_select_own_document_outputs" ON document_outputs;
CREATE POLICY "users_select_own_document_outputs" ON document_outputs
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service_manage_document_outputs" ON document_outputs;
CREATE POLICY "service_manage_document_outputs" ON document_outputs
FOR ALL TO service_role
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Helper view: "best" chunks for a document (top 8 by confidence/text_length)
DROP VIEW IF EXISTS document_best_chunks_v;
CREATE VIEW document_best_chunks_v AS
SELECT * FROM (
  SELECT
    c.*, 
    row_number() OVER (
      PARTITION BY c.document_id
      ORDER BY c.confidence DESC NULLS LAST, c.text_length DESC, c.chunk_start_page ASC
    ) AS rn
  FROM document_extraction_chunks c
) ranked
WHERE rn <= 8;

REVOKE ALL ON TABLE document_best_chunks_v FROM anon;
REVOKE ALL ON TABLE document_best_chunks_v FROM authenticated;
GRANT SELECT ON TABLE document_best_chunks_v TO authenticated;
GRANT SELECT ON TABLE document_best_chunks_v TO service_role;

COMMIT;
