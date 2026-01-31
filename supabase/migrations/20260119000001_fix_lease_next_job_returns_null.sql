-- Fix lease_next_job to return NULL when no job is available.
--
-- Without this, PostgREST/Supabase RPC returns an object with all-null fields,
-- causing the worker to attempt updates with id = "null".

BEGIN;

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

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN leased_job;
END;
$$;

COMMIT;
