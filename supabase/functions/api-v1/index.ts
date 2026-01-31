/// <reference lib="deno.ns" />

import { withCors, jsonResponse, textResponse } from "./lib/http.ts";
import { logError, logInfo, logWarn } from "./lib/logger.ts";
import { chooseTool, type ChatMessage, type ToolName } from "./lib/toolRouter.ts";
import { chunkText } from "./lib/chunking.ts";

type ChatRequest = {
  messages: ChatMessage[];
  tool?: ToolName;
  webSearchEnabled?: boolean;
  stream?: boolean;
};

type ImagesGenerateRequest = {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
};

const DOC_INTELLIGENCE_URL = Deno.env.get("DOC_INTELLIGENCE_URL") ?? "";
const OPENAI_PROXY_URL = Deno.env.get("OPENAI_PROXY_URL") ?? "";

function getPath(url: URL): string {
  // supports: /api-v1/v1/... (edge functions), and direct /v1/...
  const p = url.pathname;
  const idx = p.indexOf("/v1/");
  return idx >= 0 ? p.slice(idx) : p;
}

function requestId(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

async function handleChat(req: Request): Promise<Response> {
  const rid = requestId(req);
  const started = Date.now();

  let payload: ChatRequest;
  try {
    payload = (await req.json()) as ChatRequest;
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400, headers: { "x-request-id": rid } });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const route = chooseTool(messages, payload.tool);

  // Stateless: do not store anything; do not log content.
  logInfo("/v1/chat", { rid, tool: route.tool, stream: !!payload.stream, ms: Date.now() - started });

  // For now: tool routing is metadata-only; actual chat continues through existing openai-proxy.
  if (!OPENAI_PROXY_URL) {
    return jsonResponse(
      { error: "missing_env", missing: ["OPENAI_PROXY_URL"], tool: route },
      { status: 500, headers: { "x-request-id": rid } },
    );
  }

  // Map to existing action-based gateway, but keep stateless.
  // NOTE: we do NOT include any persisted IDs.
  const action = payload.stream ? "chatMindStream" : "chatMind";

  const upstream = await fetch(OPENAI_PROXY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // pass auth through if present
      ...(req.headers.get("authorization") ? { authorization: req.headers.get("authorization")! } : {}),
    },
    body: JSON.stringify({
      action,
      messages,
      webSearchEnabled: !!payload.webSearchEnabled,
      // hint only; upstream may ignore
      tool: route.tool,
    }),
  });

  // Stream proxy if upstream is SSE
  const contentType = upstream.headers.get("content-type") ?? "";
  const headers: Record<string, string> = { "x-request-id": rid };

  if (payload.stream && contentType.includes("text/event-stream")) {
    headers["content-type"] = "text/event-stream";
    headers["cache-control"] = "no-cache";
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  // Non-stream JSON pass-through
  const text = await upstream.text();
  // do not log text
  return new Response(text, {
    status: upstream.status,
    headers: { ...headers, "content-type": contentType || "application/json; charset=utf-8" },
  });
}

async function handleImagesGenerate(req: Request): Promise<Response> {
  const rid = requestId(req);
  let payload: ImagesGenerateRequest;
  try {
    payload = (await req.json()) as ImagesGenerateRequest;
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400, headers: { "x-request-id": rid } });
  }

  if (!OPENAI_PROXY_URL) {
    return jsonResponse(
      { error: "missing_env", missing: ["OPENAI_PROXY_URL"] },
      { status: 500, headers: { "x-request-id": rid } },
    );
  }

  // Stateless: return bytes/data URL via existing proxy (must be configured upstream).
  const upstream = await fetch(OPENAI_PROXY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(req.headers.get("authorization") ? { authorization: req.headers.get("authorization")! } : {}),
    },
    body: JSON.stringify({ action: "imageGenerate", prompt: payload.prompt, size: payload.size }),
  });

  const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "x-request-id": rid, "content-type": contentType },
  });
}

async function handleFilesUpload(req: Request): Promise<Response> {
  const rid = requestId(req);

  if (!DOC_INTELLIGENCE_URL) {
    return jsonResponse(
      { error: "missing_env", missing: ["DOC_INTELLIGENCE_URL"] },
      { status: 500, headers: { "x-request-id": rid } },
    );
  }

  // Stateless: accept multipart/form-data with a "file" field, forward bytes to Cloud Run.
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse(
      { error: "expected_multipart_form_data" },
      { status: 415, headers: { "x-request-id": rid } },
    );
  }

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return jsonResponse({ error: "missing_file" }, { status: 400, headers: { "x-request-id": rid } });
  }

  // Forward as multipart
  const forward = new FormData();
  forward.set("file", file, file.name);

  const upstream = await fetch(`${DOC_INTELLIGENCE_URL.replace(/\/$/, "")}/extract`, {
    method: "POST",
    body: forward,
  });

  const json = await upstream.text();
  // do not log json (contains extracted content)

  // Optional: add lightweight chunking metadata without persisting.
  // This runs in-memory only.
  try {
    const parsed = JSON.parse(json) as any;
    const fullText: string | undefined = parsed?.content?.full_text ?? parsed?.canonical?.content?.full_text;
    if (typeof fullText === "string") {
      const chunks = chunkText(fullText, { maxChars: 1600, overlapChars: 200 });
      parsed.chunks = chunks;
      parsed.chunking = { maxChars: 1600, overlapChars: 200, count: chunks.length };
      return jsonResponse(parsed, { status: upstream.status, headers: { "x-request-id": rid } });
    }
  } catch {
    // fall through to raw response
  }

  return new Response(json, {
    status: upstream.status,
    headers: { "x-request-id": rid, "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "*";

  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), origin);
  }

  const url = new URL(req.url);
  const path = getPath(url);

  try {
    if (req.method === "POST" && path === "/v1/chat") {
      return withCors(await handleChat(req), origin);
    }

    if (req.method === "POST" && path === "/v1/images/generate") {
      return withCors(await handleImagesGenerate(req), origin);
    }

    if (req.method === "POST" && path === "/v1/files/upload") {
      return withCors(await handleFilesUpload(req), origin);
    }

    if (req.method === "GET" && path === "/v1/health") {
      return withCors(textResponse("ok"), origin);
    }

    return withCors(jsonResponse({ error: "not_found", path }, { status: 404 }), origin);
  } catch (err) {
    logError("api-v1_unhandled", {
      name: err instanceof Error ? err.name : "unknown",
      // message can be safe; ensure it doesn't contain user content (we never pass bodies here)
      message: err instanceof Error ? err.message : String(err),
    });

    return withCors(jsonResponse({ error: "internal" }, { status: 500 }), origin);
  } finally {
    // Explicitly do nothing with request data to preserve statelessness.
    // Deno GC will reclaim memory.
    logWarn("api-v1_complete", { path, method: req.method });
  }
});
