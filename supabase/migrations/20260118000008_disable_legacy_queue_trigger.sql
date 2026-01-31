-- Disable legacy auto-queue trigger that targets the old processing_queue schema.
-- The canonical processing_queue schema (20260118000002) no longer includes user_id/requested_modes,
-- so the old trigger function can break document inserts.

BEGIN;

-- From 20260102000001_ai_processing.sql
DROP TRIGGER IF EXISTS trigger_queue_document ON public.documents;
DROP FUNCTION IF EXISTS public.queue_document_for_processing();

COMMIT;
