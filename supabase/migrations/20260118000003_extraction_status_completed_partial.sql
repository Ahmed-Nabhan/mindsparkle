-- Allow partial extraction status for coverage < 0.95

BEGIN;

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
      'completed',
      'completed_partial'
    )
  );

COMMIT;
