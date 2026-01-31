-- Unify processing_queue into a single canonical job queue and add leasing function
--
-- Supports statuses: queued/leased/running/succeeded/failed/dead
-- Adds idempotency_key, attempts/max_attempts, next_run_at, lease fields, payload

BEGIN;

-- Preserve any existing processing_queue under a legacy name (so we remove the conflicting shape)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'processing_queue'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'processing_queue_legacy_20260118'
  ) THEN
    ALTER TABLE processing_queue RENAME TO processing_queue_legacy_20260118;
  END IF;
END $$;

-- Canonical processing_queue
CREATE TABLE IF NOT EXISTS processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'dead')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT processing_queue_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT processing_queue_lease_consistency_check CHECK (
    (status IN ('leased', 'running') AND lease_owner IS NOT NULL)
    OR (status NOT IN ('leased', 'running'))
  )
);

CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_processing_queue_next_run_at ON processing_queue(next_run_at);
CREATE INDEX IF NOT EXISTS idx_processing_queue_status_next_run_at ON processing_queue(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_processing_queue_document_id ON processing_queue(document_id);
CREATE INDEX IF NOT EXISTS idx_processing_queue_lease_expires_at ON processing_queue(lease_expires_at);

-- updated_at trigger (re-usable helper)
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_processing_queue_updated_at ON processing_queue;
CREATE TRIGGER set_processing_queue_updated_at
BEFORE UPDATE ON processing_queue
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- RLS: users can select jobs for their own documents; service_role can manage
ALTER TABLE processing_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_queue" ON processing_queue;
CREATE POLICY "users_select_queue" ON processing_queue
  FOR SELECT
  USING (
    document_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = processing_queue.document_id
        AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "users_insert_queue" ON processing_queue;
CREATE POLICY "users_insert_queue" ON processing_queue
  FOR INSERT
  WITH CHECK (
    document_id IS NOT NULL
    AND status = 'queued'
    AND attempts = 0
    AND lease_owner IS NULL
    AND lease_expires_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = processing_queue.document_id
        AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_manage_processing_queue" ON processing_queue;
CREATE POLICY "service_manage_processing_queue" ON processing_queue
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Lease next job (worker will call this later)
CREATE OR REPLACE FUNCTION lease_next_job(p_owner TEXT, p_lease_seconds INT)
RETURNS processing_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  leased_job processing_queue;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'owner is required';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RAISE EXCEPTION 'lease_seconds must be > 0';
  END IF;

  UPDATE processing_queue pq
  SET
    status = 'leased',
    lease_owner = p_owner,
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
    attempts = pq.attempts + 1,
    updated_at = NOW()
  WHERE pq.id = (
    SELECT id
    FROM processing_queue
    WHERE
      next_run_at <= NOW()
      AND attempts < max_attempts
      AND (
        status = 'queued'
        OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW()))
      )
    ORDER BY next_run_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO leased_job;

  RETURN leased_job;
END;
$$;

GRANT EXECUTE ON FUNCTION lease_next_job(TEXT, INT) TO service_role;

COMMIT;
