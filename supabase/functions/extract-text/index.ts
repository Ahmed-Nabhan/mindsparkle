// Orchestration-only extraction trigger.
//
// This Edge Function enqueues a job into the canonical processing_queue and marks
// documents.extraction_status as 'processing'. No parsing/OCR is performed inline.

// @ts-nocheck - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EnqueueRequest = { documentId: string };

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function getSupabaseClients(userJwt: string) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const anon = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userJwt}`,
      },
    },
  });

  const service = createClient(url, serviceKey);

  return { anon, service };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hashBytes = new Uint8Array(hash);
  return Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => null)) as EnqueueRequest | null;
    const documentId = body?.documentId;
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { anon, service } = getSupabaseClients(token);

    // Validate access via RLS using anon client
    const { data: accessibleDoc, error: accessError } = await anon
      .from("documents")
      .select("id")
      .eq("id", documentId)
      .single();

    if (accessError || !accessibleDoc) {
      return new Response(JSON.stringify({ error: "Not authorized to access document" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load document row using service role.
    // Use select('*') for schema compatibility (older projects may not have storage_path, extraction_status, etc).
    const { data: doc, error: docError } = await service
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !doc) {
      throw new Error(`Failed to load document: ${docError?.message || "unknown"}`);
    }

    const storagePath = (doc as any)?.storage_path || (doc as any)?.file_uri;
    if (!storagePath) {
      throw new Error("Document is missing storage_path/file_uri");
    }

    // Best-effort backfill so downstream services can rely on storage_path.
    if (!(doc as any)?.storage_path && (doc as any)?.file_uri) {
      const { error: backfillErr } = await service
        .from("documents")
        .update({ storage_path: (doc as any).file_uri })
        .eq("id", documentId);

      if (backfillErr) {
        const msg = String(backfillErr.message || "");
        if (!msg.toLowerCase().includes("storage_path")) {
          throw new Error(`Failed to backfill storage_path: ${backfillErr.message}`);
        }
      }
    }

    // Mark as processing (best-effort; some schemas may not have extraction_status)
    if ((doc as any)?.extraction_status !== "processing") {
      const { error: statusErr } = await service
        .from("documents")
        .update({ extraction_status: "processing" })
        .eq("id", documentId);

      if (statusErr) {
        // If the column doesn't exist, continue anyway; extraction can still run.
        const msg = String(statusErr.message || "");
        if (!msg.toLowerCase().includes("extraction_status")) {
          throw new Error(`Failed to update extraction status: ${statusErr.message}`);
        }
      }
    }

    // Reload for idempotency seed (includes updated_at)
    const { data: docAfter, error: docAfterErr } = await service
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docAfterErr || !docAfter) {
      throw new Error(`Failed to reload document: ${docAfterErr?.message || "unknown"}`);
    }

    const resolvedStoragePath = (docAfter as any)?.storage_path || (docAfter as any)?.file_uri || storagePath;
    if (!resolvedStoragePath) {
      throw new Error("Document is missing storage_path/file_uri after reload");
    }

    const payload = {
      storagePath: resolvedStoragePath,
      mimeType: (docAfter as any)?.file_type || (doc as any)?.file_type || "application/octet-stream",
      fileSize: (docAfter as any)?.file_size || (doc as any)?.file_size || 0,
    };

    const idempotencySeed = [
      documentId,
      String(resolvedStoragePath || ""),
      String((docAfter as any)?.file_size || (doc as any)?.file_size || 0),
      String((docAfter as any)?.updated_at || (doc as any)?.updated_at || ""),
    ].join("|");

    const idempotencyKey = await sha256Hex(idempotencySeed);

    const { data: job, error: jobErr } = await service
      .from("processing_queue")
      .upsert(
        {
          document_id: documentId,
          job_type: "extract_text",
          status: "queued",
          next_run_at: new Date().toISOString(),
          payload,
          idempotency_key: idempotencyKey,
        },
        { onConflict: "idempotency_key" }
      )
      .select("id")
      .single();

    if (jobErr || !job) {
      await service.from("documents").update({ extraction_status: "failed" }).eq("id", documentId);
      throw new Error(`Failed to enqueue job: ${jobErr?.message || "unknown"}`);
    }

    return new Response(JSON.stringify({ success: true, jobId: job.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
