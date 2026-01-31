-- Multi-label document classification / insights

BEGIN;

CREATE TABLE IF NOT EXISTS document_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  document_type text NULL,
  topics text[] NOT NULL DEFAULT ARRAY[]::text[],
  vendor_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence double precision NULL,
  evidence_terms text[] NOT NULL DEFAULT ARRAY[]::text[],

  warnings text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT unique_document_insights UNIQUE (document_id),
  CONSTRAINT document_insights_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

-- updated_at trigger helper (re-usable; created in other migrations too)
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_document_insights_updated_at ON document_insights;
CREATE TRIGGER set_document_insights_updated_at
BEFORE UPDATE ON document_insights
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

ALTER TABLE document_insights ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE document_insights FROM anon;
REVOKE ALL ON TABLE document_insights FROM authenticated;
GRANT SELECT ON TABLE document_insights TO authenticated;
GRANT ALL ON TABLE document_insights TO service_role;

DROP POLICY IF EXISTS "users_select_own_document_insights" ON document_insights;
CREATE POLICY "users_select_own_document_insights" ON document_insights
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM documents d
    WHERE d.id = document_insights.document_id
      AND d.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "service_manage_document_insights" ON document_insights;
CREATE POLICY "service_manage_document_insights" ON document_insights
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

COMMIT;
