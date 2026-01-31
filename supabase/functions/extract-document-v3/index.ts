/**
 * Document Extraction Edge Function v3
 * 
 * Uses Google Document AI for high-quality OCR + layout extraction.
 * All extraction happens server-side - client just uploads and polls.
 * 
 * FLOW:
 * 1. Receive documentId
 * 2. Download file from Supabase Storage
 * 3. Call Google Document AI
 * 4. Build Canonical Document Model
 * 5. Store results in database
 * 6. Trigger AI summarization queue
 * 
 * @module functions/extract-document-v3
 */

// @ts-nocheck - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================
// TYPES
// ============================================

interface ExtractRequest {
  documentId: string;
  // Optional chunking controls (used internally for large PDFs)
  chunkStartPage?: number;
  chunkSize?: number;
}

interface CanonicalContent {
  fullText: string;
  pages: Array<{
    pageNumber: number;
    text: string;
    blocks: Array<{
      type: string;
      text: string;
      confidence: number;
    }>;
  }>;
  tables: Array<{
    id: string;
    pageNumber: number;
    headers: string[];
    rows: Array<{ cells: Array<{ text: string }> }>;
  }>;
  figures: Array<{
    id: string;
    pageNumber: number;
    type: string;
    caption?: string;
  }>;
}

interface ExtractionResult {
  success: boolean;
  content: CanonicalContent;
  metadata: {
    method: string;
    processingTimeMs: number;
    ocrUsed: boolean;
    pageCount: number;
    characterCount: number;
    languages: string[];
  };
  quality: {
    overallScore: number;
    textConfidence: number;
    isScanned: boolean;
    hasText: boolean;
    wordCount: number;
  };
  vendor: {
    vendorId: string | null;
    vendorName: string | null;
    confidence: number;
    domain: string;
    topics: string[];
  } | null;
  error?: string;
}

// ============================================
// VENDOR DETECTION PATTERNS
// ============================================

const VENDOR_PATTERNS = {
  cisco: {
    patterns: [
      /\bCCNA\b/i, /\bCCNP\b/i, /\bCCIE\b/i, /\bCisco\b/i,
      /Router[>#]/i, /Switch[>#]/i,
      /show\s+(ip\s+)?route/i, /show\s+running-config/i,
      /interface\s+(gigabit|fast)?ethernet/i,
      /\bOSPF\b/i, /\bEIGRP\b/i, /\bBGP\b/i,
    ],
    certifications: ['CCNA', 'CCNP', 'CCIE', 'DevNet'],
    domain: 'networking',
  },
  aws: {
    patterns: [
      /\bAWS\b/, /Amazon Web Services/i,
      /\bEC2\b/, /\bS3\b/, /\bLambda\b/, /\bDynamoDB\b/,
      /\bCloudFormation\b/i, /\bCloudWatch\b/i,
      /\baws\s+\w+/i, /\biam\b/i,
    ],
    certifications: ['SAA-C03', 'SAP-C02', 'DVA-C02', 'CLF-C02'],
    domain: 'cloud',
  },
  azure: {
    patterns: [
      /\bAzure\b/i, /Microsoft Azure/i,
      /\bAZ-\d{3}\b/i,
      /\baz\s+\w+/i,
      /Azure Active Directory/i, /\bEntra\b/i,
      /\bARM template/i,
    ],
    certifications: ['AZ-104', 'AZ-305', 'AZ-400', 'AZ-900'],
    domain: 'cloud',
  },
  gcp: {
    patterns: [
      /Google Cloud/i, /\bGCP\b/,
      /\bBigQuery\b/i, /\bCompute Engine\b/i,
      /\bgcloud\s+\w+/i,
    ],
    certifications: ['ACE', 'PCA', 'PDE'],
    domain: 'cloud',
  },
  comptia: {
    patterns: [
      /\bCompTIA\b/i,
      /\bA\+\b/, /\bNetwork\+\b/, /\bSecurity\+\b/,
      /\b220-\d{4}\b/, /\bN10-\d{3}\b/, /\bSY0-\d{3}\b/,
    ],
    certifications: ['A+', 'Network+', 'Security+', 'CySA+'],
    domain: 'general_it',
  },
};

// ============================================
// SUPABASE CLIENT
// ============================================

function getSupabaseClient(serviceRole = false) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const key = serviceRole 
    ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    : Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(supabaseUrl, key);
}

// ============================================
// GOOGLE DOCUMENT AI
// ============================================

async function callDocumentAI(
  fileBytes: Uint8Array,
  mimeType: string
): Promise<{
  text: string;
  pages: any[];
  tables: any[];
  confidence: number;
}> {
  // Optional: Azure Document Intelligence (preferred for scanned PDFs + tables)
  // Uses REST API (async analyze + polling) so we don't need an SDK in Deno.
  const azureEndpoint = Deno.env.get("AZURE_DI_ENDPOINT") || Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
  const azureKey = Deno.env.get("AZURE_DI_KEY") || Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_KEY");
  const azurePrefer = (Deno.env.get("AZURE_DI_PREFER") || "true").toLowerCase() !== "false";

  // Optional size guard to avoid surprise cost/latency on very large PDFs.
  // If unset or invalid, no size-based skip happens.
  const azureMaxBytesRaw = Deno.env.get("AZURE_DI_MAX_BYTES") || "";
  const azureMaxBytes = Number(azureMaxBytesRaw);

  // Optional page-count guard for huge PDFs.
  // If set and we can estimate page count, skip Azure DI when the document is too large.
  const azureMaxPagesRaw = Deno.env.get("AZURE_DI_MAX_PAGES") || "";
  const azureMaxPages = Number(azureMaxPagesRaw);

  // Optional cost guard: disable Azure DI entirely above this page count (prefer Google).
  const azureDisableAbovePagesRaw = Deno.env.get("AZURE_DI_DISABLE_ABOVE_PAGES") || "";
  const azureDisableAbovePages = Number(azureDisableAbovePagesRaw);

  const isPdf = String(mimeType || '').toLowerCase().includes('pdf');

  let estimatedPdfPages: number | null = null;
  if (isPdf && Number.isFinite(azureMaxPages) && azureMaxPages > 0) {
    estimatedPdfPages = estimatePdfPageCount(fileBytes);
  } else if (isPdf && Number.isFinite(azureDisableAbovePages) && azureDisableAbovePages > 0) {
    estimatedPdfPages = estimatePdfPageCount(fileBytes);
  }

  // Keep Azure DI limited to PDFs to avoid unnecessary cost/latency on other formats.
  // Also allow an optional max-bytes guard for very large files.
  const allowAzureBySize = !(Number.isFinite(azureMaxBytes) && azureMaxBytes > 0 && fileBytes.byteLength > azureMaxBytes);
  const allowAzureByPages = !(
    Number.isFinite(azureMaxPages) &&
    azureMaxPages > 0 &&
    typeof estimatedPdfPages === 'number' &&
    estimatedPdfPages > azureMaxPages
  );

  const allowAzureByDisableAbove = !(
    Number.isFinite(azureDisableAbovePages) &&
    azureDisableAbovePages > 0 &&
    typeof estimatedPdfPages === 'number' &&
    estimatedPdfPages > azureDisableAbovePages
  );

  if (isPdf && azurePrefer && azureEndpoint && azureKey && mimeType && allowAzureBySize && allowAzureByPages && allowAzureByDisableAbove) {
    try {
      const azure = await callAzureDocumentIntelligence(fileBytes, mimeType, azureEndpoint, azureKey);
      if (azure?.text && azure.text.length > 50) {
        return azure;
      }
    } catch (error) {
      console.error("[extract-v3] Azure Document Intelligence failed, falling back:", error);
    }
  } else if (isPdf && azurePrefer && azureEndpoint && azureKey && mimeType && !allowAzureBySize) {
    console.log(
      `[extract-v3] Skipping Azure DI due to AZURE_DI_MAX_BYTES (${azureMaxBytes}) > file size (${fileBytes.byteLength})`
    );
  } else if (isPdf && azurePrefer && azureEndpoint && azureKey && mimeType && !allowAzureByPages) {
    console.log(
      `[extract-v3] Skipping Azure DI due to AZURE_DI_MAX_PAGES (${azureMaxPages}) < estimated pages (${estimatedPdfPages})`
    );
  } else if (isPdf && azurePrefer && azureEndpoint && azureKey && mimeType && !allowAzureByDisableAbove) {
    console.log(
      `[extract-v3] Skipping Azure DI due to AZURE_DI_DISABLE_ABOVE_PAGES (${azureDisableAbovePages}) < estimated pages (${estimatedPdfPages})`
    );
  }

  const projectId = Deno.env.get("GCP_PROJECT_ID");
  const location = Deno.env.get("GCP_LOCATION") || "us";
  const processorId = Deno.env.get("GCP_PROCESSOR_ID");
  
  if (!projectId || !processorId) {
    console.log("[extract-v3] Document AI not configured, using fallback extraction");
    return fallbackExtraction(fileBytes, mimeType);
  }
  
  try {
    // Get Google credentials
    const credentialsResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/get-google-credentials`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
      }
    );
    
    if (!credentialsResponse.ok) {
      throw new Error("Failed to get Google credentials");
    }
    
    const { accessToken } = await credentialsResponse.json();
    
    // Call Document AI
    const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;
    
    // Avoid `String.fromCharCode(...bytes)` which can crash on large files.
    const base64Content = encodeBase64(fileBytes);
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rawDocument: {
          content: base64Content,
          mimeType: mimeType,
        },
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error("[extract-v3] Document AI error:", error);
      throw new Error(`Document AI failed: ${response.status}`);
    }
    
    const result = await response.json();
    const document = result.document;
    
    // Parse Document AI response
    const pages = (document.pages || []).map((page: any, idx: number) => ({
      pageNumber: idx + 1,
      text: extractPageText(page, document.text),
      blocks: extractBlocks(page, document.text),
      width: page.dimension?.width,
      height: page.dimension?.height,
    }));
    
    const tables = extractTables(document);
    
    return {
      text: document.text || "",
      pages,
      tables,
      confidence: calculateConfidence(document),
    };
    
  } catch (error) {
    console.error("[extract-v3] Document AI failed, using fallback:", error);
    return fallbackExtraction(fileBytes, mimeType);
  }
}

async function callDocumentAIForPageRange(
  fileBytes: Uint8Array,
  mimeType: string,
  pageStart: number,
  pageEnd: number
): Promise<{
  text: string;
  pages: any[];
  tables: any[];
  confidence: number;
  provider: 'azure_di' | 'google_document_ai' | 'fallback';
}> {
  return callDocumentAIForPageRangeWithOptions(fileBytes, mimeType, pageStart, pageEnd);
}

async function callDocumentAIForPageRangeWithOptions(
  fileBytes: Uint8Array,
  mimeType: string,
  pageStart: number,
  pageEnd: number,
  options?: { estimatedTotalPages?: number }
): Promise<{
  text: string;
  pages: any[];
  tables: any[];
  confidence: number;
  provider: 'azure_di' | 'google_document_ai' | 'fallback';
}> {
  const pageRange = `${pageStart}-${pageEnd}`;

  const azureEndpoint = Deno.env.get("AZURE_DI_ENDPOINT") || Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
  const azureKey = Deno.env.get("AZURE_DI_KEY") || Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_KEY");
  const azurePrefer = (Deno.env.get("AZURE_DI_PREFER") || "true").toLowerCase() !== "false";

  const azureMaxBytesRaw = Deno.env.get("AZURE_DI_MAX_BYTES") || "";
  const azureMaxBytes = Number(azureMaxBytesRaw);
  const azureMaxPagesRaw = Deno.env.get("AZURE_DI_MAX_PAGES") || "";
  const azureMaxPages = Number(azureMaxPagesRaw);
  const azureDisableAbovePagesRaw = Deno.env.get("AZURE_DI_DISABLE_ABOVE_PAGES") || "";
  const azureDisableAbovePages = Number(azureDisableAbovePagesRaw);

  const isPdf = String(mimeType || '').toLowerCase().includes('pdf');

  const allowAzureBySize = !(Number.isFinite(azureMaxBytes) && azureMaxBytes > 0 && fileBytes.byteLength > azureMaxBytes);
  const allowAzureByPages = !(
    Number.isFinite(azureMaxPages) &&
    azureMaxPages > 0 &&
    typeof options?.estimatedTotalPages === 'number' &&
    options.estimatedTotalPages > azureMaxPages
  );
  const allowAzureByDisableAbove = !(
    Number.isFinite(azureDisableAbovePages) &&
    azureDisableAbovePages > 0 &&
    typeof options?.estimatedTotalPages === 'number' &&
    options.estimatedTotalPages > azureDisableAbovePages
  );

  if (isPdf && azurePrefer && azureEndpoint && azureKey && allowAzureBySize && allowAzureByPages && allowAzureByDisableAbove) {
    try {
      const azure = await callAzureDocumentIntelligence(fileBytes, mimeType, azureEndpoint, azureKey, { pages: pageRange });
      if (azure?.text && azure.text.length > 20) {
        return { ...azure, provider: 'azure_di' };
      }
    } catch (error) {
      console.error(`[extract-v3] Azure DI failed for pages ${pageRange}, falling back to Google:`, error);
    }
  }

  // Google Document AI fallback for this range
  try {
    const google = await callGoogleDocumentAI(fileBytes, mimeType, { pageStart, pageEnd });
    return { ...google, provider: 'google_document_ai' };
  } catch (error) {
    console.error(`[extract-v3] Google Document AI failed for pages ${pageRange}, using empty fallback:`, error);
    return { text: `\n\n--- Pages ${pageRange} (extraction failed) ---\n\n`, pages: [], tables: [], confidence: 0.2, provider: 'fallback' };
  }
}

// ============================================
// PDF PAGE COUNT ESTIMATION (LIGHTWEIGHT)
// ============================================

function estimatePdfPageCount(fileBytes: Uint8Array): number | null {
  try {
    // Heuristic: count occurrences of the page object marker.
    // Most PDFs contain repeated tokens like "/Type /Page" or "/Type/Page".
    // We scan raw bytes to avoid allocating a huge string.
    const TYPE = [47, 84, 121, 112, 101]; // "/Type"
    const PAGE = [47, 80, 97, 103, 101]; // "/Page"

    let count = 0;
    for (let i = 0; i < fileBytes.length - 10; i++) {
      // Match "/Type"
      if (
        fileBytes[i] === TYPE[0] &&
        fileBytes[i + 1] === TYPE[1] &&
        fileBytes[i + 2] === TYPE[2] &&
        fileBytes[i + 3] === TYPE[3] &&
        fileBytes[i + 4] === TYPE[4]
      ) {
        // Skip optional whitespace
        let j = i + 5;
        while (j < fileBytes.length && (fileBytes[j] === 0x20 || fileBytes[j] === 0x0a || fileBytes[j] === 0x0d || fileBytes[j] === 0x09)) {
          j++;
        }

        // Match "/Page" (but not "/Pages")
        if (
          j + 4 < fileBytes.length &&
          fileBytes[j] === PAGE[0] &&
          fileBytes[j + 1] === PAGE[1] &&
          fileBytes[j + 2] === PAGE[2] &&
          fileBytes[j + 3] === PAGE[3] &&
          fileBytes[j + 4] === PAGE[4] &&
          fileBytes[j + 5] !== 0x73 // 's'
        ) {
          count++;
          i = j + 4;
        }
      }
    }

    // If we found nothing, we can't reliably estimate.
    return count > 0 ? count : null;
  } catch {
    return null;
  }
}

async function callAzureDocumentIntelligence(
  fileBytes: Uint8Array,
  mimeType: string,
  endpoint: string,
  apiKey: string,
  options?: { pages?: string }
): Promise<{
  text: string;
  pages: any[];
  tables: any[];
  confidence: number;
}> {
  const base = endpoint.replace(/\/$/, "");
  const modelId = Deno.env.get("AZURE_DI_MODEL") || "prebuilt-layout";
  const apiVersion = Deno.env.get("AZURE_DI_API_VERSION") || "2023-07-31";
  const timeoutMs = Math.max(10_000, Number(Deno.env.get("AZURE_DI_TIMEOUT_MS") || "120000"));
  const pollIntervalMs = Math.max(500, Number(Deno.env.get("AZURE_DI_POLL_INTERVAL_MS") || "1000"));

  // This is the standard Document Intelligence REST endpoint shape.
  const pagesParam = options?.pages ? `&pages=${encodeURIComponent(options.pages)}` : "";
  const analyzeUrl = `${base}/formrecognizer/documentModels/${encodeURIComponent(modelId)}:analyze?api-version=${encodeURIComponent(apiVersion)}${pagesParam}`;

  const analyzeResp = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": mimeType,
    },
    body: fileBytes,
  });

  if (analyzeResp.status !== 202) {
    const errText = await analyzeResp.text().catch(() => "");
    throw new Error(`Azure DI analyze failed: HTTP ${analyzeResp.status} ${errText?.slice(0, 500)}`);
  }

  const operationLocation = analyzeResp.headers.get("operation-location") || analyzeResp.headers.get("Operation-Location");
  if (!operationLocation) {
    throw new Error("Azure DI analyze returned 202 but missing operation-location header");
  }

  const startedAt = Date.now();
  let lastStatus = "unknown";
  let lastBody: any = null;

  while (Date.now() - startedAt < timeoutMs) {
    const pollResp = await fetch(operationLocation, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    });

    const bodyText = await pollResp.text().catch(() => "");
    if (!pollResp.ok) {
      throw new Error(`Azure DI poll failed: HTTP ${pollResp.status} ${bodyText?.slice(0, 500)}`);
    }

    const body = bodyText ? JSON.parse(bodyText) : {};
    lastBody = body;
    lastStatus = String(body?.status || "").toLowerCase();

    if (lastStatus === "succeeded") {
      const analyzeResult = body?.analyzeResult || {};
      return parseAzureAnalyzeResult(analyzeResult);
    }

    if (lastStatus === "failed") {
      const msg = body?.error?.message || body?.error?.code || "Azure DI failed";
      throw new Error(String(msg));
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Azure DI timed out after ${timeoutMs}ms (last status: ${lastStatus})`);
}

async function callGoogleDocumentAI(
  fileBytes: Uint8Array,
  mimeType: string,
  options?: { pageStart?: number; pageEnd?: number }
): Promise<{ text: string; pages: any[]; tables: any[]; confidence: number }> {
  const projectId = Deno.env.get("GCP_PROJECT_ID");
  const location = Deno.env.get("GCP_LOCATION") || "us";
  const processorId = Deno.env.get("GCP_PROCESSOR_ID");

  if (!projectId || !processorId) {
    return fallbackExtraction(fileBytes, mimeType);
  }

  // Get Google credentials (service function)
  const credentialsResponse = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/get-google-credentials`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!credentialsResponse.ok) {
    throw new Error("Failed to get Google credentials");
  }

  const { accessToken } = await credentialsResponse.json();

  const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;
  const base64Content = encodeBase64(fileBytes);

  let processOptions: any = undefined;
  const pageStart = options?.pageStart;
  const pageEnd = options?.pageEnd;
  if (
    typeof pageStart === "number" &&
    typeof pageEnd === "number" &&
    isFinite(pageStart) &&
    isFinite(pageEnd) &&
    pageStart >= 1 &&
    pageEnd >= pageStart
  ) {
    // Document AI supports selecting individual pages via processOptions.
    const pages: number[] = [];
    for (let p = pageStart; p <= pageEnd; p++) pages.push(p);
    processOptions = { individualPageSelector: { pages } };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawDocument: {
        content: base64Content,
        mimeType: mimeType,
      },
      ...(processOptions ? { processOptions } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Document AI failed: ${response.status} ${error?.slice(0, 500)}`);
  }

  const result = await response.json();
  const document = result.document;

  const pages = (document.pages || []).map((page: any, idx: number) => ({
    pageNumber: page.pageNumber || idx + 1,
    text: extractPageText(page, document.text),
    blocks: extractBlocks(page, document.text),
    width: page.dimension?.width,
    height: page.dimension?.height,
  }));

  const tables = extractTables(document);
  return {
    text: document.text || "",
    pages,
    tables,
    confidence: calculateConfidence(document),
  };
}

function parseAzureAnalyzeResult(analyzeResult: any): {
  text: string;
  pages: any[];
  tables: any[];
  confidence: number;
} {
  const fullText = String(analyzeResult?.content || "");

  const pages = (analyzeResult?.pages || []).map((p: any) => {
    const pageNumber = Number(p?.pageNumber || 1);
    const lineTexts = (p?.lines || []).map((l: any) => String(l?.content || "").trim()).filter(Boolean);
    const pageText = cleanText(lineTexts.join("\n")) || "";
    const blocks = lineTexts
      .map((t: string) => ({
        type: detectBlockType(t),
        text: t,
        confidence: 0.85,
      }))
      .filter((b: any) => b.text && b.text.length > 0);
    return { pageNumber, text: pageText, blocks };
  });

  const tables = parseAzureTables(analyzeResult?.tables || []);

  // Confidence: average word confidence if available, otherwise a conservative default.
  let total = 0;
  let count = 0;
  for (const p of analyzeResult?.pages || []) {
    for (const w of p?.words || []) {
      const c = w?.confidence;
      if (typeof c === "number" && isFinite(c)) {
        total += c;
        count++;
      }
    }
  }
  const confidence = count > 0 ? total / count : (fullText ? 0.85 : 0.5);

  return {
    text: cleanText(fullText) || cleanText(pages.map((p: any) => p.text).join("\n\n")) || "",
    pages,
    tables,
    confidence,
  };
}

function parseAzureTables(tablesIn: any[]): any[] {
  const out: any[] = [];

  for (const t of tablesIn || []) {
    const pageNumber = Number(t?.boundingRegions?.[0]?.pageNumber || 1);
    const rowCount = Number(t?.rowCount || 0);
    const columnCount = Number(t?.columnCount || 0);
    const cells = Array.isArray(t?.cells) ? t.cells : [];

    // Build a row/col matrix of strings.
    const grid: string[][] = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
    for (const c of cells) {
      const r = Number(c?.rowIndex || 0);
      const col = Number(c?.columnIndex || 0);
      if (r >= 0 && r < rowCount && col >= 0 && col < columnCount) {
        grid[r][col] = String(c?.content || "").trim();
      }
    }

    // Heuristic header detection: use cells marked as columnHeader, else first row.
    const headerRows = new Set<number>();
    for (const c of cells) {
      const kind = String(c?.kind || "").toLowerCase();
      if (kind === "columnheader") {
        headerRows.add(Number(c?.rowIndex || 0));
      }
    }

    let headers: string[] = [];
    let bodyStartRow = 0;

    if (headerRows.size > 0) {
      const headerRowIndex = Math.min(...Array.from(headerRows));
      headers = (grid[headerRowIndex] || []).map((s) => (s || "").trim());
      bodyStartRow = headerRowIndex + 1;
    } else if (grid.length > 0) {
      headers = (grid[0] || []).map((s) => (s || "").trim());
      bodyStartRow = 1;
    }

    const rows = [] as any[];
    for (let r = bodyStartRow; r < grid.length; r++) {
      const rowCells = (grid[r] || []).map((text) => ({ text: (text || "").trim() }));
      // Skip completely empty rows.
      if (rowCells.some((c: any) => c.text)) {
        rows.push({ cells: rowCells });
      }
    }

    out.push({
      id: `table-${out.length + 1}`,
      pageNumber,
      headers,
      rows,
    });
  }

  return out;
}

function extractPageText(page: any, fullText: string): string {
  if (!page.layout?.textAnchor?.textSegments) return "";
  
  let text = "";
  for (const segment of page.layout.textAnchor.textSegments) {
    const start = parseInt(segment.startIndex || "0");
    const end = parseInt(segment.endIndex || "0");
    text += fullText.substring(start, end);
  }
  return text;
}

function extractBlocks(page: any, fullText: string): any[] {
  const blocks: any[] = [];
  
  for (const block of page.blocks || []) {
    if (!block.layout?.textAnchor?.textSegments) continue;
    
    let blockText = "";
    for (const segment of block.layout.textAnchor.textSegments) {
      const start = parseInt(segment.startIndex || "0");
      const end = parseInt(segment.endIndex || "0");
      blockText += fullText.substring(start, end);
    }
    
    blocks.push({
      type: detectBlockType(blockText),
      text: blockText.trim(),
      confidence: block.layout.confidence || 0,
    });
  }
  
  return blocks;
}

function detectBlockType(text: string): string {
  if (/^#{1,6}\s/.test(text) || /^[A-Z][A-Z\s]{5,}$/.test(text.trim())) {
    return "heading";
  }
  if (/^[\-\*\•]\s/.test(text) || /^\d+\.\s/.test(text)) {
    return "list_item";
  }
  if (/```|^\s{4,}\S/.test(text)) {
    return "code";
  }
  return "paragraph";
}

function extractTables(document: any): any[] {
  const tables: any[] = [];
  
  for (const page of document.pages || []) {
    for (const table of page.tables || []) {
      const headers: string[] = [];
      const rows: any[] = [];
      
      // Extract header row
      if (table.headerRows?.[0]) {
        for (const cell of table.headerRows[0].cells || []) {
          headers.push(extractCellText(cell, document.text));
        }
      }
      
      // Extract body rows
      for (const row of table.bodyRows || []) {
        const cells: any[] = [];
        for (const cell of row.cells || []) {
          cells.push({ text: extractCellText(cell, document.text) });
        }
        rows.push({ cells });
      }
      
      tables.push({
        id: `table-${tables.length + 1}`,
        pageNumber: (document.pages || []).indexOf(page) + 1,
        headers,
        rows,
      });
    }
  }
  
  return tables;
}

function extractCellText(cell: any, fullText: string): string {
  if (!cell.layout?.textAnchor?.textSegments) return "";
  
  let text = "";
  for (const segment of cell.layout.textAnchor.textSegments) {
    const start = parseInt(segment.startIndex || "0");
    const end = parseInt(segment.endIndex || "0");
    text += fullText.substring(start, end);
  }
  return text.trim();
}

function calculateConfidence(document: any): number {
  let totalConfidence = 0;
  let count = 0;
  
  for (const page of document.pages || []) {
    for (const block of page.blocks || []) {
      if (block.layout?.confidence) {
        totalConfidence += block.layout.confidence;
        count++;
      }
    }
  }
  
  return count > 0 ? totalConfidence / count : 0.5;
}

// ============================================
// FALLBACK EXTRACTION (No Document AI)
// ============================================

async function fallbackExtraction(
  fileBytes: Uint8Array,
  mimeType: string
): Promise<{
  text: string;
  pages: any[];
  tables: any[];
  confidence: number;
}> {
  let text = "";
  
  if (mimeType.includes("pdf")) {
    text = extractPdfTextSimple(fileBytes);
  } else if (mimeType.includes("word") || mimeType.includes("document")) {
    text = extractDocxTextSimple(fileBytes);
  } else if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) {
    text = extractPptxTextSimple(fileBytes);
  } else if (mimeType.includes("text")) {
    text = new TextDecoder().decode(fileBytes);
  }
  
  return {
    text: cleanText(text),
    pages: [{ pageNumber: 1, text: cleanText(text), blocks: [] }],
    tables: [],
    confidence: 0.6,
  };
}

function extractPdfTextSimple(bytes: Uint8Array): string {
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes.slice(0, 5 * 1024 * 1024)));
  let text = "";
  
  // Extract from parentheses
  let inText = false;
  let currentText = "";
  
  for (let i = 0; i < binaryString.length; i++) {
    const char = binaryString[i];
    if (char === "(") {
      inText = true;
      currentText = "";
    } else if (char === ")" && inText) {
      inText = false;
      if (currentText.length > 1) {
        let readable = "";
        for (let j = 0; j < currentText.length; j++) {
          const c = currentText.charCodeAt(j);
          if (c >= 32 && c <= 126) readable += currentText[j];
        }
        if (readable.length > 1 && /[a-zA-Z]/.test(readable)) {
          text += readable + " ";
        }
      }
    } else if (inText) {
      currentText += char;
    }
  }
  
  return text;
}

function extractDocxTextSimple(bytes: Uint8Array): string {
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes));
  let text = "";
  
  const tagRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match;
  while ((match = tagRegex.exec(binaryString)) !== null) {
    if (match[1]) text += match[1] + " ";
  }
  
  return text;
}

function extractPptxTextSimple(bytes: Uint8Array): string {
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes));
  let text = "";
  
  const tagRegex = /<a:t>([^<]*)<\/a:t>/g;
  let match;
  while ((match = tagRegex.exec(binaryString)) !== null) {
    if (match[1]) text += match[1] + " ";
  }
  
  return text;
}

function cleanText(text: string): string {
  return text
    .replace(/[\r\n]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

// ============================================
// VENDOR DETECTION
// ============================================

function detectVendor(text: string): {
  vendorId: string | null;
  vendorName: string | null;
  confidence: number;
  domain: string;
  certification?: string;
  topics: string[];
} {
  const results: { vendor: string; score: number; cert?: string }[] = [];
  const textLower = text.toLowerCase();
  const topics: string[] = [];
  
  for (const [vendorId, config] of Object.entries(VENDOR_PATTERNS)) {
    let score = 0;
    let detectedCert: string | undefined;
    
    for (const pattern of config.patterns) {
      const matches = text.match(pattern);
      if (matches) {
        score += matches.length;
      }
    }
    
    // Check for certifications
    for (const cert of config.certifications) {
      if (text.includes(cert)) {
        score += 5;
        detectedCert = cert;
      }
    }
    
    if (score > 0) {
      results.push({ vendor: vendorId, score, cert: detectedCert });
    }
  }
  
  // Extract topics
  const topicPatterns = [
    /routing|switching|firewall|vpn|network/gi,
    /cloud|container|kubernetes|docker/gi,
    /security|encryption|authentication/gi,
    /database|sql|nosql/gi,
    /programming|code|api/gi,
  ];
  
  for (const pattern of topicPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      topics.push(...new Set(matches.map(m => m.toLowerCase())));
    }
  }
  
  if (results.length === 0) {
    return {
      vendorId: null,
      vendorName: null,
      confidence: 0,
      domain: 'other',
      topics: topics.slice(0, 10),
    };
  }
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  const config = VENDOR_PATTERNS[best.vendor as keyof typeof VENDOR_PATTERNS];
  
  return {
    vendorId: best.vendor,
    vendorName: best.vendor.charAt(0).toUpperCase() + best.vendor.slice(1),
    confidence: Math.min(best.score / 20, 1),
    domain: config.domain,
    certification: best.cert,
    topics: topics.slice(0, 10),
  };
}

// ============================================
// QUALITY SCORING
// ============================================

function calculateQuality(
  text: string,
  confidence: number,
  mimeType: string
): {
  overallScore: number;
  textConfidence: number;
  isScanned: boolean;
  hasText: boolean;
  wordCount: number;
  estimatedReadingTime: number;
} {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const hasText = wordCount > 50;
  const isScanned = confidence < 0.7 && mimeType.includes("pdf");
  
  let overallScore = confidence * 100;
  if (wordCount > 1000) overallScore = Math.min(overallScore + 10, 100);
  if (wordCount < 100) overallScore = Math.max(overallScore - 20, 0);
  
  return {
    overallScore: Math.round(overallScore),
    textConfidence: confidence,
    isScanned,
    hasText,
    wordCount,
    estimatedReadingTime: Math.ceil(wordCount / 200), // ~200 words per minute
  };
}

// ============================================
// UPDATE STATUS
// ============================================

async function updateDocumentStatus(
  supabase: any,
  documentId: string,
  status: string,
  data?: Record<string, any>
) {
  const updateData: Record<string, any> = {
    extraction_status: status,
    updated_at: new Date().toISOString(),
    ...data,
  };
  
  const { error } = await supabase
    .from('documents')
    .update(updateData)
    .eq('id', documentId);
  
  if (error) {
    console.error("[extract-v3] Failed to update status:", error);
  }
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  
  const startTime = Date.now();
  
  try {
    const { documentId, chunkStartPage, chunkSize } = await req.json() as ExtractRequest;
    
    if (!documentId) {
      return new Response(
        JSON.stringify({ error: "documentId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[extract-v3] Starting extraction for document: ${documentId}`);
    
    const supabase = getSupabaseClient(true); // Use service role
    
    // 1. Get document metadata
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();
    
    if (docError || !doc) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // 2. Update status to processing
    await updateDocumentStatus(supabase, documentId, 'processing');
    
    // 3. Download file from storage
    const storagePath = doc.file_uri || doc.storage_path;
    if (!storagePath) {
      await updateDocumentStatus(supabase, documentId, 'failed', {
        processing_error: 'No storage path found',
      });
      return new Response(
        JSON.stringify({ error: "No storage path found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[extract-v3] Downloading from storage: ${storagePath}`);
    
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(storagePath);
    
    if (downloadError || !fileData) {
      await updateDocumentStatus(supabase, documentId, 'failed', {
        processing_error: `Download failed: ${downloadError?.message}`,
      });
      return new Response(
        JSON.stringify({ error: "Failed to download file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    const mimeType = doc.file_type || 'application/pdf';
    
    console.log(`[extract-v3] File downloaded: ${fileBytes.length} bytes, type: ${mimeType}`);

    // ============================================
    // CHUNKED EXTRACTION (for huge PDFs)
    // ============================================
    const isPdf = String(mimeType || '').toLowerCase().includes('pdf');
    const chunkPagesDefault = Number(Deno.env.get('PDF_CHUNK_PAGES') || '0'); // 0 disables chunking
    const chunkingMinPages = Number(Deno.env.get('PDF_CHUNKING_MIN_PAGES') || '800');

    const estimatedTotalPages = isPdf ? estimatePdfPageCount(fileBytes) : null;
    const effectiveChunkSize = Number.isFinite(Number(chunkSize)) && Number(chunkSize) > 0 ? Number(chunkSize) : chunkPagesDefault;
    const shouldChunk =
      isPdf &&
      Number.isFinite(effectiveChunkSize) &&
      effectiveChunkSize > 0 &&
      typeof estimatedTotalPages === 'number' &&
      estimatedTotalPages >= Math.max(chunkingMinPages, effectiveChunkSize + 1);

    if (shouldChunk) {
      const startPage = Number.isFinite(Number(chunkStartPage)) && Number(chunkStartPage) > 0
        ? Number(chunkStartPage)
        : 1;
      const endPage = Math.min(startPage + effectiveChunkSize - 1, estimatedTotalPages!);

      console.log(`[extract-v3] Chunk mode: pages ${startPage}-${endPage} of ~${estimatedTotalPages} (chunkSize=${effectiveChunkSize})`);

      // Extract this chunk (Azure preferred, Google fallback)
      const chunkExtraction = await callDocumentAIForPageRangeWithOptions(fileBytes, mimeType, startPage, endPage, {
        estimatedTotalPages,
      });

      // Persist structured layout output for this chunk so we don't lose tables/pages.
      // This avoids bloating documents.canonical_content for very large documents.
      try {
        const chunkContent = {
          pageRange: { start: startPage, end: endPage },
          pages: chunkExtraction.pages || [],
          tables: chunkExtraction.tables || [],
          text: chunkExtraction.text || '',
          confidence: chunkExtraction.confidence,
          mimeType,
        };

        await supabase
          .from('document_extraction_chunks')
          .upsert(
            {
              document_id: documentId,
              chunk_start_page: startPage,
              chunk_end_page: endPage,
              provider: chunkExtraction.provider,
              content: chunkContent,
              text_length: (chunkExtraction.text || '').length,
              confidence: chunkExtraction.confidence,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'document_id,chunk_start_page,chunk_end_page,provider' }
          );
      } catch (e) {
        console.error('[extract-v3] Failed to persist document_extraction_chunks (non-fatal):', e);
      }

      // Append extracted text without truncation (no-drop goal).
      const previousText = String(doc.extracted_text || doc.content || '');
      const chunkHeader = `\n\n--- Pages ${startPage}-${endPage} ---\n\n`;
      const nextText = previousText + chunkHeader + (chunkExtraction.text || '');

      const progress = Math.min(99, Math.floor((endPage / estimatedTotalPages!) * 100));
      const nextStartPage = endPage + 1;

      await updateDocumentStatus(supabase, documentId, nextStartPage > estimatedTotalPages! ? 'processing' : 'processing', {
        extracted_text: nextText,
        has_text: nextText.length > 50,
        text_length: nextText.length,
        page_count: estimatedTotalPages,
        extraction_metadata: JSON.stringify({
          method: 'chunked',
          providerPreference: (Deno.env.get('AZURE_DI_PREFER') || 'true').toLowerCase() !== 'false' ? 'azure_then_google' : 'google_then_fallback',
          chunking: {
            enabled: true,
            chunkSize: effectiveChunkSize,
            estimatedTotalPages,
            completedThroughPage: endPage,
            progress,
          },
          updatedAt: new Date().toISOString(),
        }),
      });

      if (nextStartPage <= estimatedTotalPages!) {
        // Schedule the next chunk by calling this function again.
        // Use the service-role JWT so this works even when verify_jwt=true.
        const invokeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-document-v3`;
        const serviceJwt = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

        // Fire-and-forget (best effort)
        fetch(invokeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceJwt}`,
            'apikey': anonKey,
          },
          body: JSON.stringify({
            documentId,
            chunkStartPage: nextStartPage,
            chunkSize: effectiveChunkSize,
          }),
        }).catch((e) => console.error('[extract-v3] Failed to schedule next chunk:', e));

        return new Response(
          JSON.stringify({
            success: true,
            status: 'processing',
            message: `Chunk processed: pages ${startPage}-${endPage}. Continuing...`,
            progress,
          }),
          { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Finalize after last chunk
      const vendor = detectVendor(nextText);
      const quality = calculateQuality(nextText, 0.85, mimeType);
      const processingTimeMs = Date.now() - startTime;

      // Keep canonical_content minimal for huge docs; client will use extracted_text as fullText fallback.
      const canonicalContent: any = {
        pages: [],
        tables: [],
        figures: [],
      };

      await updateDocumentStatus(supabase, documentId, 'extracted', {
        content: nextText.substring(0, 500000),
        has_text: quality.hasText,
        text_length: nextText.length,
        word_count: quality.wordCount,
        vendor_id: vendor.vendorId,
        vendor_name: vendor.vendorName,
        vendor_confidence: vendor.confidence,
        domain: vendor.domain,
        quality_score: quality.overallScore,
        is_scanned: quality.isScanned,
        canonical_content: JSON.stringify(canonicalContent),
        extraction_metadata: JSON.stringify({
          method: 'chunked',
          processingTimeMs,
          ocrUsed: quality.isScanned,
          pageCount: estimatedTotalPages,
          characterCount: nextText.length,
          languages: ['en'],
          chunking: {
            enabled: true,
            chunkSize: effectiveChunkSize,
            estimatedTotalPages,
            completedThroughPage: estimatedTotalPages,
            progress: 100,
          },
        }),
        extracted_at: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          status: 'extracted',
          message: 'Chunked extraction complete',
          metadata: { method: 'chunked', processingTimeMs, pageCount: estimatedTotalPages },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // 4. Call Document AI (or fallback)
    const extraction = await callDocumentAI(fileBytes, mimeType);
    
    console.log(`[extract-v3] Extraction complete: ${extraction.text.length} chars`);
    
    // 5. Detect vendor
    const vendor = detectVendor(extraction.text);
    
    console.log(`[extract-v3] Vendor detected: ${vendor.vendorName || 'none'} (${(vendor.confidence * 100).toFixed(0)}%)`);
    
    // 6. Calculate quality metrics
    const quality = calculateQuality(extraction.text, extraction.confidence, mimeType);
    
    // 7. Build canonical content
    const canonicalContent: CanonicalContent = {
      fullText: extraction.text,
      pages: extraction.pages,
      tables: extraction.tables,
      figures: [],
    };
    
    const processingTimeMs = Date.now() - startTime;
    
    // 8. Update document with results
    await updateDocumentStatus(supabase, documentId, 'extracted', {
      content: extraction.text.substring(0, 500000), // Limit for DB
      extracted_text: extraction.text.substring(0, 500000),
      has_text: quality.hasText,
      text_length: extraction.text.length,
      page_count: extraction.pages.length,
      word_count: quality.wordCount,
      vendor_id: vendor.vendorId,
      vendor_name: vendor.vendorName,
      vendor_confidence: vendor.confidence,
      domain: vendor.domain,
      quality_score: quality.overallScore,
      is_scanned: quality.isScanned,
      canonical_content: JSON.stringify(canonicalContent),
      extraction_metadata: JSON.stringify({
        method: extraction.confidence > 0.8 ? 'document_ai' : 'fallback',
        processingTimeMs,
        ocrUsed: quality.isScanned,
        pageCount: extraction.pages.length,
        characterCount: extraction.text.length,
        languages: ['en'], // TODO: detect language
      }),
      extracted_at: new Date().toISOString(),
    });
    
    console.log(`[extract-v3] Document updated successfully in ${processingTimeMs}ms`);
    
    // 9. Return result
    const result: ExtractionResult = {
      success: true,
      content: canonicalContent,
      metadata: {
        method: extraction.confidence > 0.8 ? 'document_ai' : 'fallback',
        processingTimeMs,
        ocrUsed: quality.isScanned,
        pageCount: extraction.pages.length,
        characterCount: extraction.text.length,
        languages: ['en'],
      },
      quality,
      vendor,
    };
    
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("[extract-v3] Error:", error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || "Extraction failed",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
