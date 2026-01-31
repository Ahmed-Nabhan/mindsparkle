// @ts-nocheck - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GenerateOutputRequest = {
  documentId: string;
  outputType?: string; // default: deep_explain
  options?: Record<string, unknown>;
};

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

    const body = (await req.json().catch(() => null)) as GenerateOutputRequest | null;
    const documentId = body?.documentId;
    const outputType = (body?.outputType || "deep_explain").trim();
    const options = (body?.options || {}) as Record<string, unknown>;

    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (outputType !== "deep_explain") {
      return new Response(JSON.stringify({ error: `Unsupported outputType: ${outputType}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { anon, service } = getSupabaseClients(token);

    // 1) Validate user + access via RLS
    const { data: userRes, error: userErr } = await anon.auth.getUser();
    const userId = userRes?.user?.id;
    if (userErr || !userId) {
      return new Response(JSON.stringify({ error: "Invalid user session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // 2) Ensure extraction is enqueued (and storage_path is present).
    // This prevents Deep Explain from running forever with 0% coverage when the document
    // was created via legacy clients that only populated file_uri.
    const { data: doc, error: docError } = await service
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !doc) {
      throw new Error(`Failed to load document: ${docError?.message || "unknown"}`);
    }

    const storagePath = (doc as any)?.storage_path || (doc as any)?.file_uri;

    // Backfill storage_path from file_uri when possible (best-effort; older schemas may not have storage_path)
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

    const { data: coverageRow } = await service
      .from("document_coverage_v")
      .select("page_count,done_pages")
      .eq("document_id", documentId)
      .maybeSingle();

    const pageCount = Number(coverageRow?.page_count ?? (doc as any)?.page_count ?? 0);
    const donePages = Number(coverageRow?.done_pages ?? 0);

    // If extraction hasn't completed (or never started), enqueue an extract_text job.
    if (pageCount > 0 && donePages < pageCount) {
      // Mark as processing (avoid bumping updated_at if already processing)
      if ((doc as any)?.extraction_status !== "processing") {
        const { error: statusErr } = await service
          .from("documents")
          .update({ extraction_status: "processing" })
          .eq("id", documentId);
        if (statusErr) {
          const msg = String(statusErr.message || "");
          if (!msg.toLowerCase().includes("extraction_status")) {
            throw new Error(`Failed to update extraction status: ${statusErr.message}`);
          }
        }
      }

      const { data: docAfter, error: docAfterErr } = await service
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .single();

      if (docAfterErr || !docAfter) {
        throw new Error(`Failed to reload document: ${docAfterErr?.message || "unknown"}`);
      }

      const storagePathAfter = (docAfter as any)?.storage_path || (docAfter as any)?.file_uri || storagePath;
      if (!storagePathAfter) {
        throw new Error("Document is missing storage_path/file_uri");
      }

      const idempotencySeed = [
        documentId,
        String(storagePathAfter || ""),
        String((docAfter as any)?.file_size || 0),
        String((docAfter as any)?.updated_at || ""),
      ].join("|");

      const extractIdempotencyKey = await sha256Hex(idempotencySeed);

      const payload = {
        storagePath: storagePathAfter,
        mimeType: (docAfter as any)?.file_type || "application/octet-stream",
        fileSize: (docAfter as any)?.file_size || 0,
      };

      await service
        .from("processing_queue")
        .upsert(
          {
            document_id: documentId,
            job_type: "extract_text",
            status: "queued",
            next_run_at: new Date().toISOString(),
            payload,
            idempotency_key: extractIdempotencyKey,
          },
          { onConflict: "idempotency_key" }
        );
    }

    // 3) Upsert the single current output row for (document_id, output_type)
    const requestId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();

    const inputSnapshot = {
      request_id: requestId,
      requested_at: requestedAt,
      options,
    };

    const { data: output, error: outputErr } = await service
      .from("document_outputs")
      .upsert(
        {
          document_id: documentId,
          user_id: userId,
          output_type: outputType,
          status: "queued",
          input_snapshot: inputSnapshot,
          content: null,
        },
        { onConflict: "document_id,output_type" }
      )
      .select("id")
      .single();

    if (outputErr || !output) {
      throw new Error(`Failed to upsert document_outputs: ${outputErr?.message || "unknown"}`);
    }

    // 4) Enqueue processing job (request-scoped idempotency so reruns are allowed)
    const idempotencyKey = await sha256Hex(["deep_explain", output.id, requestId].join("|"));

    const payload = {
      document_id: documentId,
      output_id: output.id,
      output_type: outputType,
      user_id: userId,
      request_id: requestId,
      options,
    };

    const { data: job, error: jobErr } = await service
      .from("processing_queue")
      .upsert(
        {
          document_id: documentId,
          job_type: "deep_explain",
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
      // Best-effort: mark output failed if we couldn't enqueue
      await service
        .from("document_outputs")
        .update({ status: "failed", content: { error: "enqueue_failed", message: jobErr?.message || "unknown" } })
        .eq("id", output.id);

      throw new Error(`Failed to enqueue deep_explain job: ${jobErr?.message || "unknown"}`);
    }

    // Store job id for debugging
    await service
      .from("document_outputs")
      .update({ input_snapshot: { ...inputSnapshot, job_id: job.id } })
      .eq("id", output.id);

    return new Response(JSON.stringify({ success: true, outputId: output.id, jobId: job.id, requestId }), {
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
