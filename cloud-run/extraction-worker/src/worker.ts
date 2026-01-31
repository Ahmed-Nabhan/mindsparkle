import { loadEnv } from "./env";
import { createServiceClient } from "./supabase";
import { logError, logInfo, logWarn } from "./logger";
import { processExtractTextJob } from "./extractTextJob";
import { processDeepExplainJob } from "./deepExplainJob";
import http from "node:http";

type JobRow = {
  id: string;
  document_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: any;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_run_at: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function computeBackoffSeconds(attempts: number): number {
  // Exponential backoff with cap.
  const base = 5;
  const cap = 300;
  const seconds = Math.min(cap, base * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.floor(seconds);
}

async function markRunning(supabase: any, job: JobRow, owner: string): Promise<void> {
  const { error } = await supabase
    .from("processing_queue")
    .update({ status: "running" })
    .eq("id", job.id)
    .eq("lease_owner", owner)
    .eq("status", "leased");

  if (error) throw new Error(`Failed to mark job running: ${error.message}`);
}

async function markSucceeded(supabase: any, jobId: string, owner: string) {
  const { error } = await supabase
    .from("processing_queue")
    .update({
      status: "succeeded",
      lease_owner: null,
      lease_expires_at: null,
      last_error: null,
    })
    .eq("id", jobId)
    .eq("lease_owner", owner);

  if (error) throw new Error(`Failed to mark job succeeded: ${error.message}`);
}

async function markFailedOrRetry(supabase: any, job: JobRow, owner: string, errorMessage: string) {
  const attempts = job.attempts;
  const maxAttempts = job.max_attempts;

  if (attempts >= maxAttempts) {
    const { error } = await supabase
      .from("processing_queue")
      .update({
        status: "dead",
        last_error: errorMessage,
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", job.id)
      .eq("lease_owner", owner);

    if (error) throw new Error(`Failed to mark job dead: ${error.message}`);
    return;
  }

  const backoffSeconds = computeBackoffSeconds(attempts);
  const next = new Date(Date.now() + backoffSeconds * 1000).toISOString();

  const { error } = await supabase
    .from("processing_queue")
    .update({
      status: "queued",
      next_run_at: next,
      last_error: errorMessage,
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq("id", job.id)
    .eq("lease_owner", owner);

  if (error) throw new Error(`Failed to reschedule job: ${error.message}`);
}

async function leaseNextJob(supabase: any, owner: string, leaseSeconds: number): Promise<JobRow | null> {
  const { data, error } = await supabase.rpc("lease_next_job", {
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
  });

  if (error) throw new Error(`lease_next_job failed: ${error.message}`);
  if (!data) return null;

  // PostgREST can return a null-filled composite record instead of NULL.
  // Treat that as "no job" to avoid attempting updates with id = "null".
  if (!data.id || !data.job_type) return null;

  return data as JobRow;
}

async function main() {
  const env = loadEnv();
  const supabase = createServiceClient({
    supabaseUrl: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });

  // Cloud Run *services* require a listening HTTP server on $PORT.
  // This worker runs as a service with a simple health endpoint.
  const port = Number(process.env.PORT || 8080);
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(port, () => {
    logInfo({ msg: "http_listening", owner: env.owner, port });
  });

  logInfo({ msg: "worker_started", owner: env.owner, leaseSeconds: env.leaseSeconds, pollIntervalMs: env.pollIntervalMs });

  // Simple polling loop (Cloud Run jobs or always-on service)
  // Cloud Run will restart on failure; keep loop resilient.
  while (true) {
    let job: JobRow | null = null;

    try {
      job = await leaseNextJob(supabase, env.owner, env.leaseSeconds);
    } catch (e: any) {
      logError({ msg: "lease_failed", owner: env.owner, error: e?.message || String(e) });
      await sleep(env.pollIntervalMs);
      continue;
    }

    if (!job) {
      await sleep(env.pollIntervalMs);
      continue;
    }

    const ctx = { jobId: job.id, jobType: job.job_type, documentId: job.document_id || undefined, owner: env.owner };

    try {
      await markRunning(supabase, job, env.owner);
      logInfo({ msg: "job_running", ...ctx, attempts: job.attempts, maxAttempts: job.max_attempts });

      if (job.job_type === "extract_text") {
        const result = await processExtractTextJob({
          supabase,
          bucket: env.bucket,
          job,
          ocrServiceUrl: env.ocrServiceUrl,
          signedUrlSeconds: env.signedUrlSeconds,
          batchSize: env.batchSize,
          documentIntelligenceUrl: env.documentIntelligenceUrl,
        });

        logInfo({ msg: "job_extract_text_done", ...ctx, ...result });
      } else if (job.job_type === "deep_explain") {
        const result = await processDeepExplainJob({
          supabase,
          job,
          openAiApiKey: env.openAiApiKey,
        });

        logInfo({ msg: "job_deep_explain_done", ...ctx, ...result });
      } else {
        logWarn({ msg: "job_type_unsupported", ...ctx });
        throw new Error(`Unsupported job_type: ${job.job_type}`);
      }

      await markSucceeded(supabase, job.id, env.owner);
      logInfo({ msg: "job_succeeded", ...ctx });
    } catch (e: any) {
      const errorMessage = e?.message || String(e);
      logError({ msg: "job_failed", ...ctx, error: errorMessage });

      try {
        await markFailedOrRetry(supabase, job, env.owner, errorMessage);
      } catch (e2: any) {
        logError({ msg: "job_failure_update_failed", ...ctx, error: e2?.message || String(e2) });
      }
    }
  }
}

main().catch((e) => {
  logError({ msg: "worker_fatal", error: e?.message || String(e) });
  process.exit(1);
});
