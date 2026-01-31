import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { logInfo, logWarn } from "./logger";

type ProcessingJobRow = {
  id: string;
  document_id: string | null;
  job_type: string;
  payload: any;
  attempts: number;
  max_attempts: number;
};

function normalizeDocAssetsPath(imagePath: string): string {
  // We sometimes store as "doc_assets/<docId>/page_001.png".
  // Supabase storage APIs expect just "<docId>/page_001.png".
  const p = String(imagePath || "").trim();
  if (!p) return p;
  return p.startsWith("doc_assets/") ? p.slice("doc_assets/".length) : p;
}

function chunkText(s: string, maxChars: number): string {
  const t = String(s || "");
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\n…(truncated)";
}

function parseOptionalBoolEnv(name: string): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function vectorToPg(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function openAiEmbed(params: {
  apiKey: string;
  model: string;
  inputs: string[];
}): Promise<number[][]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      input: params.inputs,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI embeddings failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const json: any = await resp.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  const out = data
    .map((d: any) => (Array.isArray(d?.embedding) ? d.embedding.map((n: any) => Number(n)) : null))
    .filter((e: any) => Array.isArray(e));
  return out as number[][];
}

function extractChunkPlainText(content: any): string {
  const ocrText = content?.ocr?.text;
  if (typeof ocrText === "string" && ocrText.trim().length > 0) return ocrText;

  const pages = Array.isArray(content?.pages) ? content.pages : [];
  const pageTexts = pages
    .map((p: any) => String(p?.text || "").trim())
    .filter((t: string) => t.length > 0);
  if (pageTexts.length > 0) return pageTexts.join("\n\n");

  const fallback = typeof content === "string" ? content : JSON.stringify(content || {});
  return String(fallback || "");
}

function topicKeywords(topic: string): string[] {
  const t = String(topic || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const stop = new Set([
    "the",
    "and",
    "or",
    "of",
    "to",
    "in",
    "for",
    "with",
    "on",
    "at",
    "by",
    "from",
    "a",
    "an",
    "is",
    "are",
    "this",
    "that",
    "these",
    "those",
  ]);

  return Array.from(new Set(t.filter((w) => w.length >= 3 && !stop.has(w)))).slice(0, 10);
}

function scoreChunkForTopic(chunkTextLower: string, keywords: string[]): number {
  if (!chunkTextLower || keywords.length === 0) return 0;
  let score = 0;
  for (const kw of keywords) {
    const idx = chunkTextLower.indexOf(kw);
    if (idx !== -1) score += 1;
  }
  return score;
}

function toNumberOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeCoverageGate(
  coverageRatio: number | null | undefined,
  pageCount: number | null | undefined,
  failedPages: any[] | null | undefined
) {
  const pc = Number(pageCount ?? 0);
  const ratio = Number(coverageRatio);
  const missingPages = (Array.isArray(failedPages) ? failedPages : [])
    .map((p: any) => Number(p?.page_index))
    .filter((n) => Number.isFinite(n));

  // If we don't know total pages yet, coverage is unknown; don't show a 0% warning.
  if (!Number.isFinite(pc) || pc <= 0) {
    return { warning: null as string | null, missingPages };
  }

  if (!Number.isFinite(ratio) || ratio >= 0.95) {
    return { warning: null as string | null, missingPages };
  }

  const pct = Math.round(ratio * 100);
  return {
    warning: `⚠️ Extraction coverage is ${pct}%. Output may be incomplete; do not claim completeness.`,
    missingPages,
  };
}

async function openAiChatJson(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<any> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 1600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI request failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const json: any = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("OpenAI did not return valid JSON");
  }
}

async function classifyDocument(params: {
  apiKey: string;
  model: string;
  groundingBundle: any;
  coverageWarning: string | null;
  vendorConfidence: number | null;
}): Promise<{
  document_type: string | null;
  topics: string[];
  vendor_candidates: Array<{ name: string; confidence?: number; evidence_terms?: string[] }>;
  confidence: number | null;
  evidence_terms: string[];
}> {
  const system =
    "You are classifying a document using ONLY the provided extracted content.\n" +
    "Use ONLY provided extracted content.\n" +
    "If not present, say 'not found in the document'.\n" +
    "Return ONLY valid JSON.";

  const user =
    "Return JSON with:\n" +
    "{\n" +
    "  \"document_type\": string|null,\n" +
    "  \"topics\": string[],\n" +
    "  \"vendor_candidates\": [ { \"name\": string, \"confidence\": number, \"evidence_terms\": string[] } ],\n" +
    "  \"confidence\": number|null,\n" +
    "  \"evidence_terms\": string[]\n" +
    "}\n\n" +
    "Rules:\n" +
    "- Topics MUST be multi-label (5-20 items).\n" +
    "- evidence_terms MUST be literal terms that appear in the provided content.\n" +
    "- If coverage warning exists, include it as uncertainty: do not claim completeness.\n" +
    "- If vendorConfidence < 0.85, do NOT pick a single vendor; list possible vendors instead.\n\n" +
    `vendorConfidence: ${params.vendorConfidence ?? "null"}\n` +
    `coverageWarning: ${params.coverageWarning ?? "null"}\n\n` +
    "EXTRACTED CONTENT (ground truth):\n" +
    JSON.stringify(params.groundingBundle);

  const raw = await openAiChatJson({
    apiKey: params.apiKey,
    model: params.model,
    system,
    user,
    temperature: 0.2,
    maxTokens: 800,
  });

  const topics = Array.isArray(raw?.topics) ? raw.topics.map((t: any) => String(t)).filter(Boolean) : [];
  const vendorCandidates = Array.isArray(raw?.vendor_candidates)
    ? raw.vendor_candidates
        .map((v: any) => ({
          name: String(v?.name || "").trim(),
          confidence: toNumberOrNull(v?.confidence) ?? undefined,
          evidence_terms: Array.isArray(v?.evidence_terms) ? v.evidence_terms.map((e: any) => String(e)).filter(Boolean) : undefined,
        }))
        .filter((v: any) => v.name)
    : [];

  const evidenceTerms = Array.isArray(raw?.evidence_terms)
    ? raw.evidence_terms.map((e: any) => String(e)).filter(Boolean)
    : [];

  return {
    document_type: raw?.document_type ? String(raw.document_type) : null,
    topics: topics.slice(0, 20),
    vendor_candidates: vendorCandidates.slice(0, 8),
    confidence: toNumberOrNull(raw?.confidence),
    evidence_terms: evidenceTerms.slice(0, 30),
  };
}

async function openAiVisionSummary(params: {
  apiKey: string;
  model: string;
  imageBase64: string;
  imageMime?: string;
  prompt: string;
}): Promise<string> {
  const imageMime = params.imageMime || "image/png";
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: params.prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${imageMime};base64,${params.imageBase64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI vision request failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const json: any = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  return String(content || "").trim();
}

function detectImageMimeFromBytes(buf: Buffer): string {
  if (!buf || buf.length < 4) return "application/octet-stream";

  // PNG
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  return "application/octet-stream";
}

export async function processDeepExplainJob(params: {
  supabase: SupabaseClient;
  job: ProcessingJobRow;
  openAiApiKey?: string;
}): Promise<{ outputId: string; coverageRatio: number | null; figuresVisioned: number }> {
  const { supabase, job } = params;

  const documentId = job.document_id || job.payload?.document_id;
  const outputId = job.payload?.output_id;
  const requestId = job.payload?.request_id;

  if (!documentId) throw new Error("deep_explain job missing document_id");
  if (!outputId) throw new Error("deep_explain job missing output_id");
  if (!requestId) throw new Error("deep_explain job missing request_id");

  // Mark output processing only if it's still the current request.
  const { data: updated, error: markErr } = await supabase
    .from("document_outputs")
    .update({ status: "processing" })
    .eq("id", outputId)
    .filter("input_snapshot->>request_id", "eq", requestId)
    .select("id")
    .maybeSingle();

  if (markErr) throw new Error(`Failed to mark document_outputs processing: ${markErr.message}`);
  if (!updated) {
    // Stale job; don't overwrite newer output.
    logWarn({ msg: "deep_explain_stale_job", jobId: job.id, documentId, outputId, requestId });
    return { outputId, coverageRatio: 0, figuresVisioned: 0 };
  }

  const { data: coverageRow } = await supabase
    .from("document_coverage_v")
    .select("coverage_ratio,page_count,done_pages")
    .eq("document_id", documentId)
    .maybeSingle();

  const pageCount = Number(coverageRow?.page_count ?? 0);
  const coverageRatio = pageCount > 0 ? Number(coverageRow?.coverage_ratio ?? 0) : null;

  const { data: docMeta } = await supabase
    .from("documents")
    .select("vendor_name,vendor_confidence")
    .eq("id", documentId)
    .maybeSingle();

  const vendorConfidence = toNumberOrNull(docMeta?.vendor_confidence);

  const { data: failedPages } = await supabase
    .from("document_pages")
    .select("page_index,status,kind,method,error")
    .eq("document_id", documentId)
    .in("status", ["failed", "missing"])
    .order("page_index", { ascending: true });

  const coverageGate = computeCoverageGate(coverageRatio, pageCount, failedPages);

  const maxChunksForRag = Math.max(8, Math.min(120, Number(process.env.DEEP_EXPLAIN_MAX_CHUNKS_FOR_RAG || 40)));
  const { data: chunks } = await supabase
    .from("document_extraction_chunks")
    .select("id,chunk_start_page,chunk_end_page,confidence,text_length,content")
    .eq("document_id", documentId)
    .order("chunk_start_page", { ascending: true })
    .limit(maxChunksForRag);

  const { data: blocks } = await supabase
    .from("document_page_blocks")
    .select("id,page_index,block_index,block_type,text,data,confidence,status")
    .eq("document_id", documentId)
    .order("page_index", { ascending: true })
    .order("block_index", { ascending: true });

  const openAiApiKey = params.openAiApiKey || process.env.OPENAI_API_KEY;
  const canUseAi = !!openAiApiKey;

  const enableEmbeddings = parseOptionalBoolEnv('ENABLE_DEEP_EXPLAIN_EMBEDDINGS');
  const enableCache = parseOptionalBoolEnv('ENABLE_DEEP_EXPLAIN_CACHE');
  const enableModelRouting = parseOptionalBoolEnv('ENABLE_DEEP_EXPLAIN_MODEL_ROUTING');

  const outlineModel = (enableModelRouting ? String(process.env.DEEP_EXPLAIN_OUTLINE_MODEL || '').trim() : '') || 'gpt-4o-mini';
  const sectionModel = (enableModelRouting ? String(process.env.DEEP_EXPLAIN_SECTION_MODEL || '').trim() : '') || 'gpt-4o-mini';
  const embeddingModel = String(process.env.DEEP_EXPLAIN_EMBEDDING_MODEL || 'text-embedding-3-small').trim();
  const embeddingMaxChunks = Math.max(10, Math.min(120, Number(process.env.DEEP_EXPLAIN_EMBED_MAX_CHUNKS_PER_DOC || 80)));
  const embeddingMaxChars = Math.max(400, Math.min(3000, Number(process.env.DEEP_EXPLAIN_EMBED_MAX_CHARS || 2000)));

  let documentUpdatedAt: string | null = null;
  if (enableCache) {
    try {
      const { data: docRow } = await supabase
        .from('documents')
        .select('updated_at')
        .eq('id', documentId)
        .maybeSingle();
      documentUpdatedAt = docRow?.updated_at ? String(docRow.updated_at) : null;
    } catch {
      documentUpdatedAt = null;
    }
  }

  // Optional vision follow-up for figure blocks with images.
  let figuresVisioned = 0;
  if (canUseAi && Array.isArray(blocks)) {
    const pendingFigures = blocks
      .filter((b: any) => b.block_type === "figure" && b.status === "vision_pending")
      .slice(0, 4); // keep bounded

    for (const fig of pendingFigures) {
      const imagePathRaw = fig?.data?.image_path;
      const imagePath = imagePathRaw ? normalizeDocAssetsPath(String(imagePathRaw)) : "";
      if (!imagePath) continue;

      try {
        const dl = await supabase.storage.from("doc_assets").download(imagePath);
        if (dl.error || !dl.data) {
          logWarn({ msg: "deep_explain_figure_download_failed", jobId: job.id, documentId, outputId, imagePath, error: dl.error?.message });
          continue;
        }

        const arrayBuffer = await dl.data.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        const base64 = buf.toString("base64");
        const mime = detectImageMimeFromBytes(buf);

        const summary = await openAiVisionSummary({
          apiKey: openAiApiKey!,
          model: "gpt-4o-mini",
          imageBase64: base64,
          imageMime: mime,
          prompt:
            "Summarize ONLY what is visible in this document figure/diagram image.\n" +
            "Rules:\n" +
            "- Do not guess missing context.\n" +
            "- If text is unreadable, say so.\n" +
            "- Return 3-7 bullet points in plain text.",
        });

        const nextData = { ...(fig.data || {}), figure_summary: summary };
        const { error: upErr } = await supabase
          .from("document_page_blocks")
          .update({ status: "extracted", data: nextData })
          .eq("id", fig.id);

        if (upErr) {
          logWarn({ msg: "deep_explain_figure_update_failed", jobId: job.id, documentId, outputId, blockId: fig.id, error: upErr.message });
        } else {
          figuresVisioned += 1;
        }
      } catch (e: any) {
        logWarn({ msg: "deep_explain_figure_vision_failed", jobId: job.id, documentId, outputId, blockId: fig.id, error: e?.message || String(e) });
      }
    }
  }

  // Refresh blocks after vision updates (only used for prompt context).
  const { data: blocks2 } = await supabase
    .from("document_page_blocks")
    .select("id,page_index,block_index,block_type,text,data,confidence,status")
    .eq("document_id", documentId)
    .order("page_index", { ascending: true })
    .order("block_index", { ascending: true });

  const figures = (blocks2 || [])
    .filter((b: any) => b.block_type === "figure")
    .slice(0, 8)
    .map((b: any) => ({
      block_id: b.id,
      page_index: b.page_index,
      status: b.status,
      image_path: b?.data?.image_path ?? null,
      figure_summary: b?.data?.figure_summary ?? null,
    }));

  const tables = (blocks2 || [])
    .filter((b: any) => b.block_type === "table")
    .slice(0, 8)
    .map((b: any) => ({
      block_id: b.id,
      page_index: b.page_index,
      status: b.status,
      text_preview: b.text ? chunkText(b.text, 1200) : null,
    }));

  const chunkSummaries = (chunks || []).map((c: any) => {
    const content = c?.content || {};
    const ocrText = content?.ocr?.text;

    let contentPreview: string | null = null;
    if (typeof ocrText === "string" && ocrText.trim().length > 0) {
      contentPreview = chunkText(ocrText, 5000);
    } else {
      const pages = Array.isArray(content?.pages) ? content.pages : [];
      const pageTexts = pages
        .map((p: any) => String(p?.text || "").trim())
        .filter((t: string) => t.length > 0);
      if (pageTexts.length > 0) {
        contentPreview = chunkText(pageTexts.join("\n\n"), 5000);
      } else {
        contentPreview = chunkText(JSON.stringify(content), 5000);
      }
    }

    return {
      chunk_id: c.id,
      page_start: c.chunk_start_page,
      page_end: c.chunk_end_page,
      confidence: c.confidence,
      text_length: c.text_length,
      content_preview: contentPreview,
    };
  });

  const groundingBundle = {
    document_id: documentId,
    coverage: {
      ratio: coverageRatio,
      total_pages: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : null,
      done_pages: coverageRow?.done_pages ?? null,
      failed_pages: failedPages || [],
      warning: coverageGate.warning,
    },
    vendor: {
      vendor_name: docMeta?.vendor_name ?? null,
      vendor_confidence: vendorConfidence,
    },
    chunks: chunkSummaries,
    figures,
    tables,
  };

  // Classification (multi-label topics) stored in document_insights
  let classification: any = null;
  if (canUseAi) {
    try {
      classification = await classifyDocument({
        apiKey: openAiApiKey!,
        model: outlineModel,
        groundingBundle,
        coverageWarning: coverageGate.warning,
        vendorConfidence,
      });

      const warnings: string[] = [];
      if (coverageGate.warning) warnings.push(coverageGate.warning);

      await supabase
        .from("document_insights")
        .upsert(
          {
            document_id: documentId,
            user_id: job.payload?.user_id,
            document_type: classification.document_type,
            topics: classification.topics,
            vendor_candidates: classification.vendor_candidates,
            confidence: classification.confidence,
            evidence_terms: classification.evidence_terms,
            warnings,
          },
          { onConflict: "document_id" }
        );
    } catch (e: any) {
      logWarn({ msg: "deep_explain_classification_failed", jobId: job.id, documentId, outputId, error: e?.message || String(e) });
    }
  }
  let content: any = null;
  if (!canUseAi) {
    content = {
      outputType: "deep_explain",
      coverage: {
        ratio: coverageRatio,
        warning: coverageGate.warning || "OPENAI_API_KEY is not configured for the worker; cannot generate Deep Explain.",
        missingPages: Array.isArray(failedPages) ? failedPages.map((p: any) => p.page_index) : [],
      },
      classification: null,
      sections: [],
      diagrams: [],
      equationsLatex: [],
      tables: [],
      figures,
    };
  } else {
    const enableRag = parseOptionalBoolEnv('ENABLE_DEEP_EXPLAIN_RAG');

    // RAG-style, evidence-per-topic section builder.
    if (enableRag && Array.isArray(chunks) && chunks.length > 0) {
      const maxSections = Math.max(3, Math.min(8, Number(process.env.DEEP_EXPLAIN_MAX_SECTIONS || 7)));
      const maxChunksPerSection = Math.max(2, Math.min(5, Number(process.env.DEEP_EXPLAIN_MAX_CHUNKS_PER_SECTION || 3)));
      const maxChunkExcerptChars = Math.max(600, Math.min(2000, Number(process.env.DEEP_EXPLAIN_CHUNK_EXCERPT_CHARS || 1200)));

      const baseTopics: any[] = Array.isArray(classification?.topics) ? classification.topics : [];
      const topics: string[] = baseTopics
        .map((t: any) => String(t || '').trim())
        .filter(Boolean)
        .slice(0, 20);

      const topicsDeduped: string[] = Array.from(new Set(topics));
      const finalTopics: string[] = topicsDeduped.length > 0 ? topicsDeduped.slice(0, maxSections) : ['Overview'];

      const chunkIndex = (chunks || []).map((c: any) => {
        const plain = extractChunkPlainText(c?.content || {});
        const plainLower = plain.toLowerCase();
        return {
          id: String(c.id),
          pageStart: Number(c.chunk_start_page ?? 0),
          pageEnd: Number(c.chunk_end_page ?? 0),
          confidence: toNumberOrNull(c.confidence) ?? null,
          textLength: toNumberOrNull(c.text_length) ?? null,
          plain,
          plainLower,
        };
      });

      // Best-effort embeddings upsert for a subset of chunks.
      // If this fails for any reason, we continue with keyword-based retrieval.
      if (enableEmbeddings) {
        try {
          const sortedForEmbed = [...chunkIndex]
            .sort((a, b) => (Number(b.confidence || 0) - Number(a.confidence || 0)) || (Number(b.textLength || 0) - Number(a.textLength || 0)))
            .slice(0, embeddingMaxChunks);

          const idsToCheck = sortedForEmbed.map((c) => c.id);
          const { data: existing } = await supabase
            .from('document_chunk_embeddings')
            .select('chunk_id')
            .in('chunk_id', idsToCheck);
          const existingSet = new Set((existing || []).map((r: any) => String(r.chunk_id)));

          const missing = sortedForEmbed.filter((c) => !existingSet.has(c.id));
          if (missing.length > 0) {
            const inputs = missing.map((c) => chunkText(c.plain, embeddingMaxChars));
            const vectors = await openAiEmbed({ apiKey: openAiApiKey!, model: embeddingModel, inputs });

            const rows = missing.map((c, idx) => ({
              chunk_id: c.id,
              document_id: documentId,
              embedding: vectorToPg(vectors[idx] || []),
              model: embeddingModel,
            }));

            await supabase.from('document_chunk_embeddings').upsert(rows, { onConflict: 'chunk_id' });
            logInfo({ msg: 'deep_explain_embeddings_upserted', jobId: job.id, documentId, outputId, count: rows.length, model: embeddingModel });
          } else {
            logInfo({ msg: 'deep_explain_embeddings_upserted', jobId: job.id, documentId, outputId, count: 0, model: embeddingModel });
          }
        } catch (e: any) {
          logWarn({ msg: 'deep_explain_embeddings_upsert_failed', jobId: job.id, documentId, outputId, error: e?.message || String(e) });
        }
      }

      const sections: any[] = [];
      for (const topic of finalTopics) {
        let picked: any[] = [];

        // 1) Embeddings retrieval (best-effort)
        if (enableEmbeddings) {
          try {
            logInfo({ msg: 'deep_explain_embeddings_retrieval_start', jobId: job.id, documentId, outputId, topic, matchCount: maxChunksPerSection, model: embeddingModel });
            const vec = await openAiEmbed({ apiKey: openAiApiKey!, model: embeddingModel, inputs: [topic] });
            const queryVec = vectorToPg(vec[0] || []);
            const { data: rows } = await supabase.rpc('match_document_chunks', {
              p_document_id: documentId,
              p_query_embedding: queryVec,
              p_match_count: maxChunksPerSection,
            });

            const ids = Array.isArray(rows) ? rows.map((r: any) => String(r.chunk_id)) : [];
            const byId = new Map(chunkIndex.map((c) => [String(c.id), c] as const));
            picked = ids.map((id: string) => byId.get(id)).filter(Boolean) as any[];
            logInfo({ msg: 'deep_explain_embeddings_retrieval_done', jobId: job.id, documentId, outputId, topic, picked: picked.length });
          } catch (e: any) {
            logWarn({ msg: 'deep_explain_embeddings_retrieval_failed', jobId: job.id, documentId, outputId, error: e?.message || String(e) });
            picked = [];
          }
        }

        // 2) Keyword fallback
        if (picked.length === 0) {
          const kws = topicKeywords(topic);
          const scored = chunkIndex
            .map((c) => ({
              ...c,
              score: scoreChunkForTopic(c.plainLower, kws),
            }))
            .sort((a, b) => (b.score - a.score) || (Number(b.confidence || 0) - Number(a.confidence || 0)) || (Number(b.textLength || 0) - Number(a.textLength || 0)));

          picked = scored.filter((c) => c.score > 0).slice(0, maxChunksPerSection);
          if (picked.length === 0) picked = scored.slice(0, maxChunksPerSection);
        }

        const evidence = picked.map((c) => ({
          chunkId: c.id,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          excerpt: chunkText(c.plain, maxChunkExcerptChars),
        }));

        const evidenceChunkIds = evidence.map((e) => e.chunkId);
        const evidencePages: number[] = [];
        for (const e of evidence) {
          const ps = Number(e.pageStart);
          const pe = Number(e.pageEnd);
          if (Number.isFinite(ps) && ps > 0) evidencePages.push(ps);
          if (Number.isFinite(pe) && pe > 0) evidencePages.push(pe);
        }

        const relatedFigures = (figures || [])
          .filter((f: any) => {
            const p = Number(f?.page_index);
            if (!Number.isFinite(p)) return false;
            // Keep figure if its page overlaps any evidence range.
            return evidence.some((e) => p >= Number(e.pageStart) && p <= Number(e.pageEnd));
          })
          .slice(0, 3)
          .map((f: any) => ({
            page: f.page_index,
            imagePath: f.image_path ?? null,
            summary: f.figure_summary ?? null,
            blockId: f.block_id ?? null,
          }));

        // Cache lookup (best-effort)
        const evidenceChunkIdsSorted = [...evidenceChunkIds].map(String).sort();
        const cacheKey = sha256Hex(`${topic}::${evidenceChunkIdsSorted.join(',')}`);
        if (enableCache && documentUpdatedAt) {
          try {
            const { data: cached } = await supabase
              .from('deep_explain_section_cache')
              .select('section_json')
              .eq('document_id', documentId)
              .eq('document_updated_at', documentUpdatedAt)
              .eq('topic', topic)
              .eq('chunk_ids_hash', cacheKey)
              .maybeSingle();
            if (cached?.section_json) {
              logInfo({ msg: 'deep_explain_cache_hit', jobId: job.id, documentId, outputId, topic, chunkIdsHash: cacheKey });
              sections.push(cached.section_json);
              continue;
            }
            logInfo({ msg: 'deep_explain_cache_miss', jobId: job.id, documentId, outputId, topic, chunkIdsHash: cacheKey });
          } catch {
            // ignore cache failures
          }
        }

        const sectionSystem =
          'You are generating ONE Deep Explain section grounded ONLY in the provided evidence excerpts.\n' +
          'Rules:\n' +
          '- Do NOT invent facts. If not in evidence, say "not found in the document".\n' +
          '- Keep explanation 4-10 sentences (may include newlines).\n' +
          '- Include 4-10 bullet takeaways.\n' +
          '- If you include tables/diagrams/equations, they must be supported by evidence.\n' +
          '- Mermaid diagrams must be flowchart only (graph TD / flowchart).\n' +
          '- Output MUST be valid JSON only.';

        const sectionUser =
          'Topic: ' + topic + '\n\n' +
          'Coverage warning (if any): ' + String(coverageGate.warning || 'none') + '\n\n' +
          'Evidence excerpts (ground truth):\n' +
          JSON.stringify(evidence) + '\n\n' +
          'Related figures (only if provided; do not invent):\n' +
          JSON.stringify(relatedFigures) + '\n\n' +
          'Return STRICT JSON with schema:\n' +
          '{\n' +
          '  "title": string,\n' +
          '  "explanation": string,\n' +
          '  "bullets": string[],\n' +
          '  "diagrams": [ { "title": string, "code": string, "citations": {"pages": number[], "chunkIds": string[], "blockIds": string[]} } ],\n' +
          '  "equationsLatex": string[],\n' +
          '  "tables": [ { "title": string, "headers": string[], "rows": string[][], "citations": {"pages": number[], "chunkIds": string[], "blockIds": string[]} } ],\n' +
          '  "figures": [ { "page": number, "imagePath": string|null, "summary": string|null } ],\n' +
          '  "citations": {"pages": number[], "chunkIds": string[], "blockIds": string[]}\n' +
          '}\n\n' +
          'Citation rules:\n' +
          '- citations.chunkIds MUST be a subset of: ' + JSON.stringify(evidenceChunkIds) + '\n' +
          '- citations.pages MUST be within the evidence page ranges.\n' +
          '- citations.blockIds only if you referenced relatedFigures/tables.\n';

        const section = await openAiChatJson({
          apiKey: openAiApiKey!,
          model: sectionModel,
          system: sectionSystem,
          user: sectionUser,
          temperature: 0.2,
          maxTokens: 900,
        });

        // Best-effort citations enforcement to avoid empty citations.
        if (!section.citations) section.citations = {};
        if (!Array.isArray(section.citations.chunkIds) || section.citations.chunkIds.length === 0) {
          section.citations.chunkIds = evidenceChunkIds;
        }
        if (!Array.isArray(section.citations.pages) || section.citations.pages.length === 0) {
          section.citations.pages = Array.from(new Set(evidencePages)).slice(0, 6);
        }
        if (!Array.isArray(section.citations.blockIds)) section.citations.blockIds = [];

        // Cache write (best-effort)
        if (enableCache && documentUpdatedAt) {
          try {
            await supabase
              .from('deep_explain_section_cache')
              .upsert(
                {
                  document_id: documentId,
                  document_updated_at: documentUpdatedAt,
                  topic,
                  chunk_ids: evidenceChunkIdsSorted,
                  chunk_ids_hash: cacheKey,
                  section_json: section,
                  model: sectionModel,
                },
                { onConflict: 'document_id,document_updated_at,topic,chunk_ids_hash' }
              );
          } catch {
            // ignore
          }
        }

        sections.push(section);
      }

      content = {
        outputType: 'deep_explain',
        coverage: {
          ratio: coverageRatio,
          warning: coverageGate.warning || null,
          missingPages: Array.isArray(coverageGate.missingPages) ? coverageGate.missingPages : [],
        },
        classification: classification || null,
        sections,
        diagrams: [],
        equationsLatex: [],
        tables: [],
        figures: figures.map((f: any) => ({ page: f.page_index, imagePath: f.image_path ?? null, summary: f.figure_summary ?? null })),
      };
    } else {
      // Legacy single-shot generation (fallback)
      const system =
        "You are generating a Deep Explain output for a document.\n" +
        "You MUST be strictly grounded in the provided extracted content and figure summaries.\n" +
        "Use ONLY provided extracted content.\n" +
        "If not present, say 'not found in the document'.\n" +
        "Return ONLY valid JSON (no markdown).";

      const user =
        "Generate a Deep Explain JSON object with this schema:\n" +
        "{\n" +
        "  \"outputType\": \"deep_explain\",\n" +
        "  \"coverage\": { \"ratio\": number, \"warning\": string|null, \"missingPages\": number[] },\n" +
        "  \"classification\": { \"document_type\": string|null, \"topics\": string[], \"vendor_candidates\": any[], \"confidence\": number|null, \"evidence_terms\": string[] }|null,\n" +
        "  \"sections\": [\n" +
        "    {\n" +
        "      \"title\": string,\n" +
        "      \"explanation\": string,\n" +
        "      \"bullets\": string[],\n" +
        "      \"diagrams\": [ { \"title\": string, \"code\": string, \"citations\": {\"pages\": number[], \"chunkIds\": string[], \"blockIds\": string[]} } ],\n" +
        "      \"equationsLatex\": string[],\n" +
        "      \"tables\": [ { \"title\": string, \"headers\": string[], \"rows\": string[][], \"citations\": {\"pages\": number[], \"chunkIds\": string[], \"blockIds\": string[]} } ],\n" +
        "      \"figures\": [ { \"page\": number, \"imagePath\": string|null, \"summary\": string|null } ],\n" +
        "      \"citations\": {\"pages\": number[], \"chunkIds\": string[], \"blockIds\": string[]}\n" +
        "    }\n" +
        "  ],\n" +
        "  \"diagrams\": [ { \"title\": string, \"code\": string, \"citations\": {\"pages\": number[], \"chunkIds\": string[], \"blockIds\": string[]} } ],\n" +
        "  \"equationsLatex\": string[],\n" +
        "  \"tables\": [ { \"title\": string, \"headers\": string[], \"rows\": string[][], \"citations\": {\"pages\": number[], \"chunkIds\": string[], \"blockIds\": string[]} } ],\n" +
        "  \"figures\": [ { \"page\": number, \"imagePath\": string|null, \"summary\": string|null } ]\n" +
        "}\n\n" +
        "Rules:\n" +
        "- First: detect topics from extracted content (use classification.topics if provided as hints, but you may add missing topics if they clearly appear in the extracted content).\n" +
        "- Then: produce a topic-by-topic explanation where each section corresponds to ONE topic (or a tightly related cluster).\n" +
        "- The app will show ONE section per swipeable page; write each section as a self-contained deep lesson.\n" +
        "- Keep to 5-9 sections max. If there are more than 9 topics, make the last section titled 'Other topics' and summarize remaining topics with 1-2 bullets each.\n" +
        "- Each section must be professional and easy to follow: explanation must be 4-10 sentences (multi-paragraph allowed with \\n), then bullets for key takeaways, then optional diagrams/equations/tables/figures.\n" +
        "- If the document is technical, prefer precise terminology and include equations/notation ONLY when they appear or are directly implied by the extracted content.\n" +
        "- Every section must include citations.\n" +
        "- If coverage.ratio < 0.95, set coverage.warning and include missingPages.\n" +
        "- If coverage.warning exists, you must not claim completeness anywhere.\n" +
        "- If vendorConfidence < 0.85, do not present a single vendor label; include possible vendors list in classification.vendor_candidates.\n" +
        "- Mermaid diagrams must be flowchart only (graph TD / flowchart).\n" +
        "- Diagrams: only include if the extracted content describes a process/architecture; keep diagrams simple and readable.\n" +
        "- Figures: you MUST NOT invent images. figures[] must ONLY reference image paths that exist in EXTRACTED CONTENT groundingBundle.figures[]. Use groundingBundle.figures[i].image_path as imagePath.\n" +
        "- Prefer placing figures inside the MOST relevant section (use section.figures). Use top-level figures only as a fallback.\n" +
        "- Never invent vendor/certification info.\n\n" +
        `vendorConfidence: ${vendorConfidence ?? "null"}\n` +
        "EXTRACTED CONTENT (ground truth):\n" +
        JSON.stringify(groundingBundle);

      content = await openAiChatJson({
        apiKey: openAiApiKey!,
        model: "gpt-4o-mini",
        system,
        user,
        temperature: 0.2,
        maxTokens: 1800,
      });
    }

    // Enforce gating even if model forgets.
    if (!content.coverage) content.coverage = {};
    content.coverage.ratio = coverageRatio;
    if (coverageGate.warning && !content.coverage.warning) {
      content.coverage.warning = coverageGate.warning;
    }
    if (Array.isArray(coverageGate.missingPages) && (!Array.isArray(content.coverage.missingPages))) {
      content.coverage.missingPages = coverageGate.missingPages;
    }
    if (content.classification == null && classification != null) {
      content.classification = classification;
    }
  }

  // Persist output only if still current request.
  const { data: done, error: doneErr } = await supabase
    .from("document_outputs")
    .update({
      status: canUseAi ? "completed" : "failed",
      content,
    })
    .eq("id", outputId)
    .filter("input_snapshot->>request_id", "eq", requestId)
    .select("id")
    .maybeSingle();

  if (doneErr) throw new Error(`Failed to update document_outputs: ${doneErr.message}`);
  if (!done) {
    logWarn({ msg: "deep_explain_stale_job_on_finalize", jobId: job.id, documentId, outputId, requestId });
  } else {
    logInfo({ msg: "deep_explain_completed", jobId: job.id, documentId, outputId, requestId, coverageRatio, figuresVisioned });
  }

  return { outputId, coverageRatio, figuresVisioned };
}
