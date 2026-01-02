/**
 * Text Extraction Edge Function for MindSparkle
 * PRODUCTION-READY VERSION
 * 
 * Features:
 * - Robust error handling with detailed error messages
 * - UUID validation before DB operations
 * - Large file handling with chunked processing
 * - OCR fallback for scanned/image-based PDFs
 * - Proper timeout management
 * - Status reporting to cloud_documents table
 * 
 * Supported formats:
 * - PDF (native text + OCR fallback)
 * - PPTX (PowerPoint)
 * - DOCX (Word)
 */

// @ts-nocheck - This file runs in Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("[extract-text] Module loaded successfully");

// Safe base64 encoding for large files - Deno native implementation
function encodeBase64(data: Uint8Array): string {
  // Use Deno's built-in base64 encoding which handles large arrays
  const binString = Array.from(data, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration
const CONFIG = {
  MAX_FILE_SIZE_MB: 500,  // Max 500MB files (chunked processing)
  CHUNK_SIZE_MB: 50,      // Process in 50MB chunks
  MAX_TEXT_LENGTH: 2 * 1024 * 1024,  // 2MB text limit
  MIN_TEXT_QUALITY_CHARS: 100,  // Minimum chars before OCR fallback
  OCR_ENABLED: true,
  TIMEOUT_MS: 55000,  // 55 seconds (Edge Function limit is 60s)
  DIAGRAM_ANALYSIS_ENABLED: true,  // Enable GPT-4 Vision for network diagrams
  PDF_PAGE_CHUNK_SIZE: 50,  // Process PDFs in chunks of 50 pages for >20MB files
  PRESERVE_CLI_FORMATTING: true,  // Post-process to preserve CLI/code formatting
};

/**
 * Validate UUID format
 */
function isValidUUID(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Create a response with proper CORS headers
 */
function createResponse(data: object, status: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    { 
      status, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    }
  );
}

/**
 * Update document status in cloud_documents table
 */
async function updateDocumentStatus(
  supabase: any,
  documentId: string,
  status: string,
  data: {
    extractedText?: string;
    pageCount?: number;
    processingError?: string;
    textQuality?: string;
  } = {}
): Promise<void> {
  const updateData: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (data.extractedText !== undefined) {
    updateData.extracted_text = data.extractedText;
  }
  if (data.pageCount !== undefined) {
    updateData.page_count = data.pageCount;
  }
  if (data.processingError !== undefined) {
    updateData.processing_error = data.processingError;
  }
  if (status === 'ready') {
    updateData.processed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("cloud_documents")
    .update(updateData)
    .eq("id", documentId);

  if (error) {
    console.error(`[extract-text] Failed to update status: ${error.message}`);
  }
}

/**
 * Deduplicate text from multiple chunks
 * Removes repeated sentences/paragraphs that might occur at chunk boundaries
 */
function deduplicateText(text: string): string {
  if (!text || text.length < 100) return text;
  
  // Split into sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const uniqueSentences: string[] = [];
  
  for (const sentence of sentences) {
    // Normalize for comparison (lowercase, trim, remove extra spaces)
    const normalized = sentence.toLowerCase().trim().replace(/\s+/g, ' ');
    
    // Skip very short sentences or already seen ones
    if (normalized.length < 20) {
      uniqueSentences.push(sentence);
      continue;
    }
    
    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueSentences.push(sentence);
    }
  }
  
  return uniqueSentences.join(' ');
}

/**
 * Assess text quality to determine if OCR is needed
 */
function assessTextQuality(text: string): {
  quality: 'good' | 'poor' | 'garbage';
  letterRatio: number;
  commonWordCount: number;
} {
  if (!text || text.length === 0) {
    return { quality: 'garbage', letterRatio: 0, commonWordCount: 0 };
  }

  // Calculate letter ratio
  let letterCount = 0;
  let symbolCount = 0;
  for (let i = 0; i < Math.min(text.length, 5000); i++) {
    const code = text.charCodeAt(i);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      letterCount++;
    } else if (code > 127 || (code < 32 && code !== 10 && code !== 13)) {
      symbolCount++;
    }
  }
  const letterRatio = letterCount / Math.min(text.length, 5000);

  // Check for common English words
  const commonWords = ['the', 'and', 'is', 'in', 'to', 'of', 'a', 'for', 'on', 'with', 'as', 'by', 'an', 'be', 'this'];
  const textLower = text.toLowerCase();
  let commonWordCount = 0;
  for (const word of commonWords) {
    if (textLower.includes(` ${word} `)) {
      commonWordCount++;
    }
  }

  // Determine quality
  let quality: 'good' | 'poor' | 'garbage';
  if (letterRatio > 0.5 && commonWordCount >= 5) {
    quality = 'good';
  } else if (letterRatio > 0.3 && commonWordCount >= 2) {
    quality = 'poor';
  } else {
    quality = 'garbage';
  }

  return { quality, letterRatio, commonWordCount };
}

/**
 * Extract text from PDF bytes using multiple methods
 */
async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  console.log(`[extract-text] Extracting PDF text from ${bytes.length} bytes`);
  
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes.slice(0, Math.min(bytes.length, 50 * 1024 * 1024))));
  
  let text = "";
  let pageCount = 0;

  // Count pages
  const pageMatches = binaryString.match(/\/Type\s*\/Page[^s]/g);
  pageCount = pageMatches ? pageMatches.length : 1;
  console.log(`[extract-text] Detected ${pageCount} pages`);

  // Method 1: Extract text from parentheses (PDF literal strings)
  const parenTexts: string[] = [];
  let inText = false;
  let currentText = "";
  let escapeNext = false;
  
  for (let i = 0; i < binaryString.length; i++) {
    const char = binaryString[i];
    
    if (escapeNext) {
      if (inText) currentText += char;
      escapeNext = false;
      continue;
    }
    
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    
    if (char === "(") {
      if (inText) {
        currentText += char;
      } else {
        inText = true;
        currentText = "";
      }
    } else if (char === ")" && inText) {
      inText = false;
      if (currentText.length > 1) {
        // Filter to readable ASCII
        let readable = "";
        for (let j = 0; j < currentText.length; j++) {
          const c = currentText.charCodeAt(j);
          if (c >= 32 && c <= 126) {
            readable += currentText[j];
          }
        }
        if (readable.length > 1 && /[a-zA-Z]/.test(readable)) {
          parenTexts.push(readable);
        }
      }
    } else if (inText) {
      currentText += char;
    }
  }
  
  text = parenTexts.join(" ");
  console.log(`[extract-text] Method 1 (parentheses): ${text.length} chars`);

  // Method 2: Extract hex-encoded text
  if (text.length < 500) {
    const hexMatches = binaryString.match(/<[0-9A-Fa-f]{8,}>/g) || [];
    let hexText = "";
    for (let h = 0; h < Math.min(hexMatches.length, 5000); h++) {
      const hex = hexMatches[h].slice(1, -1);
      let decoded = "";
      for (let k = 0; k < hex.length - 3; k += 4) {
        const codePoint = parseInt(hex.substr(k, 4), 16);
        if (codePoint >= 32 && codePoint <= 126) {
          decoded += String.fromCharCode(codePoint);
        }
      }
      if (decoded.length > 2 && /[a-zA-Z]{2,}/.test(decoded)) {
        hexText += decoded + " ";
      }
    }
    if (hexText.length > text.length) {
      text = hexText;
      console.log(`[extract-text] Method 2 (hex): ${text.length} chars`);
    }
  }

  // Method 3: Extract from BT/ET text blocks
  if (text.length < 500) {
    let btText = "";
    const btMatches = binaryString.matchAll(/BT\s*([\s\S]{1,10000}?)\s*ET/g);
    for (const match of btMatches) {
      const block = match[1];
      const tjMatches = block.matchAll(/\(([^)]*)\)\s*Tj/g);
      for (const tj of tjMatches) {
        const tjText = tj[1].replace(/[^\x20-\x7E]/g, " ").trim();
        if (tjText.length > 0) {
          btText += tjText + " ";
        }
      }
    }
    if (btText.length > text.length) {
      text = btText;
      console.log(`[extract-text] Method 3 (BT/ET): ${text.length} chars`);
    }
  }

  // Method 4: Extract readable word sequences
  if (text.length < 500) {
    const wordMatches = binaryString.match(/[A-Za-z][a-z]{2,15}(?:\s+[A-Za-z][a-z]{2,15}){2,}/g) || [];
    let wordText = wordMatches.slice(0, 2000).join(" ");
    if (wordText.length > text.length) {
      text = wordText;
      console.log(`[extract-text] Method 4 (word sequences): ${text.length} chars`);
    }
  }

  return { text: text.trim(), pageCount };
}

/**
 * Extract text from PPTX bytes
 */
async function extractPptxText(bytes: Uint8Array): Promise<string> {
  console.log(`[extract-text] Extracting PPTX text from ${bytes.length} bytes`);
  
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes.slice(0, Math.min(bytes.length, 30 * 1024 * 1024))));
  
  let text = "";
  const maxMatches = 20000;
  let matchCount = 0;

  // Extract <a:t> tags (PowerPoint text elements)
  for (let i = 0; i < binaryString.length && matchCount < maxMatches; i++) {
    if (binaryString[i] === "<" && binaryString.substring(i, i + 4) === "<a:t") {
      const startTagEnd = binaryString.indexOf(">", i);
      if (startTagEnd === -1 || startTagEnd > i + 50) continue;
      
      const closeTag = "</a:t>";
      const endIdx = binaryString.indexOf(closeTag, startTagEnd + 1);
      if (endIdx === -1 || endIdx > startTagEnd + 1000) continue;
      
      const tagText = binaryString.substring(startTagEnd + 1, endIdx);
      if (tagText && tagText.length > 0 && tagText.length < 500) {
        let cleanedText = "";
        for (let c = 0; c < tagText.length; c++) {
          const code = tagText.charCodeAt(c);
          if (code >= 32 && code <= 126) cleanedText += tagText[c];
        }
        if (cleanedText.length > 0) {
          text += cleanedText + " ";
          matchCount++;
        }
      }
      i = endIdx + closeTag.length - 1;
    }
  }

  console.log(`[extract-text] PPTX extracted ${text.length} chars from ${matchCount} text elements`);
  return text.trim();
}

/**
 * Extract text from DOCX bytes
 */
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  console.log(`[extract-text] Extracting DOCX text from ${bytes.length} bytes`);
  
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes.slice(0, Math.min(bytes.length, 30 * 1024 * 1024))));
  
  let text = "";
  
  // Extract <w:t> tags
  const wtMatches = binaryString.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  for (const match of wtMatches) {
    const content = match[1];
    if (content && content.length > 0) {
      let cleanedText = "";
      for (let c = 0; c < content.length; c++) {
        const code = content.charCodeAt(c);
        if (code >= 32 && code <= 126) cleanedText += content[c];
      }
      if (cleanedText.length > 0) {
        text += cleanedText + " ";
      }
    }
  }

  // Fallback: general XML text extraction
  if (text.length < 100) {
    text = binaryString.replace(/<[^>]+>/g, " ");
    text = text.replace(/[^\x20-\x7E\n]/g, " ");
  }

  console.log(`[extract-text] DOCX extracted ${text.length} chars`);
  return text.trim();
}

/**
 * Clean extracted text
 */
function cleanText(text: string): string {
  if (!text) return "";
  
  let cleaned = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
      cleaned += text[i];
    } else {
      cleaned += " ";
    }
  }
  
  // Collapse multiple spaces (limit to avoid memory issues)
  if (cleaned.length < 1000000) {
    cleaned = cleaned.replace(/  +/g, " ").replace(/\n\n+/g, "\n\n").trim();
  }
  
  return cleaned;
}

/**
 * Perform OCR using multiple providers in priority order
 * OPTIMIZED FOR MILLIONS OF USERS - Document AI first (enterprise-grade)
 * 
 * Priority: Document AI > Cloud Vision > Google Docs OCR (fallback) > OpenAI Vision
 * 
 * Document AI advantages:
 * - No storage limits (processes in memory)
 * - Auto-scales to handle thousands of concurrent requests
 * - 99.9% SLA - enterprise reliability
 * - ~$1.50 per 1,000 pages - predictable pricing
 * - Handles custom fonts, scanned documents, complex layouts
 */
async function performOCR(
  supabase: any,
  storagePath: string,
  documentId: string,
  pdfBytes?: Uint8Array,
  onProgress?: (progress: string) => Promise<void>,
  fileSize?: number
): Promise<string> {
  console.log(`[extract-text] Attempting OCR for document: ${documentId}, fileSize: ${fileSize ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : 'unknown'}`);
  
  // Priority 1: Google Document AI (ENTERPRISE-GRADE - scales to millions)
  // ~$1.50/1000 pages, no storage limits, auto-scales
  const googleKey = Deno.env.get("GOOGLE_CLOUD_API_KEY") || Deno.env.get("GOOGLE_AI_KEY");
  const projectId = Deno.env.get("GOOGLE_PROJECT_ID") || "mindsparkle";
  const processorId = Deno.env.get("GOOGLE_DOCUMENT_AI_PROCESSOR_ID");
  
  if (googleKey && pdfBytes && processorId) {
    try {
      console.log(`[extract-text] Trying Google Document AI OCR (enterprise-grade, processor: ${processorId})...`);
      
      const fileSizeMB = pdfBytes.length / (1024 * 1024);
      
      if (fileSizeMB <= 15) {
        // Single request for smaller files (<15MB)
        const text = await processWithDocumentAI(pdfBytes, googleKey, projectId, processorId);
        if (text && text.length > 100) {
          console.log(`[extract-text] Document AI OCR extracted ${text.length} chars`);
          return text;
        }
      } else {
        // For larger files (>15MB), use chunked processing
        console.log(`[extract-text] Large file (${fileSizeMB.toFixed(1)}MB), using chunked Document AI processing...`);
        const text = await processLargePdfWithDocumentAI(
          pdfBytes, 
          googleKey, 
          projectId, 
          processorId,
          onProgress
        );
        if (text && text.length > 100) {
          console.log(`[extract-text] Document AI chunked OCR extracted ${text.length} chars`);
          return text;
        }
      }
    } catch (docAiError: any) {
      console.error("[extract-text] Google Document AI OCR failed:", docAiError.message);
    }
  } else {
    console.log(`[extract-text] Document AI not configured: key=${!!googleKey}, bytes=${!!pdfBytes}, processor=${!!processorId}`);
  }
  
  // Priority 2: Google Cloud Vision API (fallback - less accurate for PDFs)
  if (googleKey && pdfBytes) {
    try {
      console.log("[extract-text] Trying Google Cloud Vision OCR (fallback)...");
      const text = await processWithCloudVision(pdfBytes, googleKey);
      if (text && text.length > 100) {
        console.log(`[extract-text] Cloud Vision OCR extracted ${text.length} chars`);
        return text;
      }
    } catch (visionError: any) {
      console.error("[extract-text] Google Cloud Vision OCR failed:", visionError.message);
    }
  }
  
  // Priority 3 (FALLBACK): Google Docs OCR - NOT scalable but works for some cases
  // WARNING: Service Accounts have limited Drive storage, may fail at scale
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (serviceAccountJson && storagePath && fileSize) {
    try {
      console.log("[extract-text] Trying Google Docs OCR with streaming (fallback for problematic PDFs)...");
      const credentials = JSON.parse(serviceAccountJson);
      
      // Create a signed URL for the file
      const { data: signedUrlData } = await supabase.storage
        .from("documents")
        .createSignedUrl(storagePath, 600); // 10 minute expiry
      
      if (signedUrlData?.signedUrl) {
        const text = await processWithGoogleDocsOCRFromUrl(signedUrlData.signedUrl, fileSize, credentials);
        if (text && text.length > 100) {
          console.log(`[extract-text] Google Docs OCR (streaming) extracted ${text.length} chars`);
          return text;
        }
      }
    } catch (docsError: any) {
      console.error("[extract-text] Google Docs OCR streaming failed:", docsError.message);
    }
  }
  
  // Priority 3b: Google Docs OCR with bytes (last fallback before OpenAI)
  if (serviceAccountJson && pdfBytes) {
    try {
      console.log("[extract-text] Trying Google Docs OCR with bytes (fallback)...");
      const credentials = JSON.parse(serviceAccountJson);
      const text = await processWithGoogleDocsOCR(pdfBytes, credentials);
      if (text && text.length > 100) {
        console.log(`[extract-text] Google Docs OCR extracted ${text.length} chars`);
        return text;
      }
    } catch (docsError: any) {
      console.error("[extract-text] Google Docs OCR failed:", docsError.message);
    }
  }
  
  // Priority 4: OpenAI Vision (most expensive fallback)
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    console.log("[extract-text] OCR exhausted: No more API keys to try");
    return "";
  }

  try {
    const { data: signedUrl } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 300);

    if (!signedUrl?.signedUrl) {
      console.log("[extract-text] OCR skipped: Could not create signed URL");
      return "";
    }

    console.log("[extract-text] Trying OpenAI Vision OCR (last resort)...");
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an OCR assistant. Extract ALL text from the document image. Maintain original structure, paragraphs, and formatting. Output only the extracted text, nothing else."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all text from this document. Preserve the structure and formatting."
              },
              {
                type: "image_url",
                image_url: { url: signedUrl.signedUrl }
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("[extract-text] OpenAI Vision OCR error:", data.error);
      return "";
    }

    const ocrText = data.choices?.[0]?.message?.content || "";
    console.log(`[extract-text] OpenAI Vision OCR extracted ${ocrText.length} chars`);
    
    return ocrText;

  } catch (error: any) {
    console.error("[extract-text] All OCR attempts failed:", error.message);
    return "";
  }
}

/**
 * Get OAuth access token from service account credentials
 */
async function getServiceAccountToken(credentials: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  // Create JWT header and claim
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: expiry,
  };

  // Base64url encode
  const b64url = (str: string) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const headerB64 = b64url(JSON.stringify(header));
  const claimB64 = b64url(JSON.stringify(claim));
  const unsignedToken = `${headerB64}.${claimB64}`;

  // Sign with RSA-SHA256
  const privateKey = credentials.private_key.replace(/\\n/g, '\n');
  const encoder = new TextEncoder();
  
  // Import the private key
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = privateKey.substring(
    privateKey.indexOf(pemHeader) + pemHeader.length,
    privateKey.indexOf(pemFooter)
  ).replace(/\s/g, '');
  
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken)
  );
  
  const signatureB64 = b64url(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${unsignedToken}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  if (tokenData.error) {
    throw new Error(`Token error: ${tokenData.error_description || tokenData.error}`);
  }
  
  return tokenData.access_token;
}

/**
 * Process PDF with Google Docs OCR using a signed URL (memory-efficient streaming)
 * Uses chunked upload to handle large files without loading entire file into memory
 */
async function processWithGoogleDocsOCRFromUrl(
  signedUrl: string,
  fileSize: number,
  credentials: { client_email: string; private_key: string }
): Promise<string> {
  console.log(`[extract-text] Starting Google Docs OCR from URL (${(fileSize / 1024 / 1024).toFixed(2)}MB)...`);
  
  // Get OAuth token
  const accessToken = await getServiceAccountToken(credentials);
  console.log("[extract-text] Got service account access token");
  
  // Initiate resumable upload
  const initResponse = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/pdf",
        "X-Upload-Content-Length": fileSize.toString(),
      },
      body: JSON.stringify({
        name: `ocr_temp_${Date.now()}.pdf`,
        mimeType: "application/pdf",
      }),
    }
  );
  
  if (!initResponse.ok) {
    const err = await initResponse.text();
    throw new Error(`Resumable upload init failed: ${initResponse.status} - ${err}`);
  }
  
  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("No upload URL returned from resumable init");
  }
  
  console.log("[extract-text] Got resumable upload URL, starting chunked upload...");
  
  // Fetch PDF and upload in chunks
  const pdfResponse = await fetch(signedUrl);
  if (!pdfResponse.ok || !pdfResponse.body) {
    throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
  }
  
  // Read and upload in 5MB chunks to stay within memory limits
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
  const reader = pdfResponse.body.getReader();
  let uploadedBytes = 0;
  let buffer = new Uint8Array(0);
  
  while (true) {
    const { done, value } = await reader.read();
    
    if (value) {
      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;
    }
    
    // Upload when we have enough data or reached the end
    const shouldUpload = buffer.length >= CHUNK_SIZE || (done && buffer.length > 0);
    
    if (shouldUpload) {
      const chunkToUpload = done ? buffer : buffer.slice(0, CHUNK_SIZE);
      const isLastChunk = done;
      const rangeStart = uploadedBytes;
      const rangeEnd = uploadedBytes + chunkToUpload.length - 1;
      
      console.log(`[extract-text] Uploading chunk: bytes ${rangeStart}-${rangeEnd}/${isLastChunk ? fileSize : '*'}`);
      
      const chunkResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": chunkToUpload.length.toString(),
          "Content-Range": `bytes ${rangeStart}-${rangeEnd}/${isLastChunk ? fileSize : '*'}`,
          "Content-Type": "application/pdf",
        },
        body: chunkToUpload,
      });
      
      // 308 Resume Incomplete means more chunks expected
      // 200/201 means upload complete
      if (chunkResponse.status !== 308 && chunkResponse.status !== 200 && chunkResponse.status !== 201) {
        const err = await chunkResponse.text();
        throw new Error(`Chunk upload failed: ${chunkResponse.status} - ${err}`);
      }
      
      uploadedBytes += chunkToUpload.length;
      
      // Keep remaining data in buffer
      if (!done) {
        buffer = buffer.slice(CHUNK_SIZE);
      }
      
      // If upload complete, get the file ID
      if (chunkResponse.status === 200 || chunkResponse.status === 201) {
        const uploadData = await chunkResponse.json();
        const fileId = uploadData.id;
        console.log(`[extract-text] Chunked upload complete, fileId: ${fileId}`);
        
        // Convert to Google Docs and extract text
        return await convertAndExtractText(fileId, accessToken);
      }
    }
    
    if (done) break;
  }
  
  throw new Error("Upload did not complete properly");
}

/**
 * Convert uploaded PDF to Google Docs and extract text
 */
async function convertAndExtractText(fileId: string, accessToken: string): Promise<string> {
  // Convert to Google Docs format (triggers OCR)
  console.log("[extract-text] Converting to Google Docs (OCR)...");
  const copyResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `ocr_converted_${Date.now()}`,
        mimeType: "application/vnd.google-apps.document",
      }),
    }
  );
  
  const copyData = await copyResponse.json();
  if (copyData.error) {
    // Clean up original file
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    throw new Error(`Copy/convert error: ${copyData.error.message}`);
  }
  
  const docId = copyData.id;
  console.log(`[extract-text] Converted to Google Doc, docId: ${docId}`);
  
  // Export as plain text
  console.log("[extract-text] Exporting Google Doc as text...");
  const exportResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    {
      headers: { "Authorization": `Bearer ${accessToken}` },
    }
  );
  
  if (!exportResponse.ok) {
    throw new Error(`Export error: ${exportResponse.statusText}`);
  }
  
  const extractedText = await exportResponse.text();
  console.log(`[extract-text] Google Docs OCR extracted ${extractedText.length} chars`);
  
  // Clean up: Delete both files from Drive
  console.log("[extract-text] Cleaning up temp files from Drive...");
  await Promise.all([
    fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    }),
    fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    }),
  ]);
  
  return extractedText;
}

/**
 * Upload PDF to Google Drive and convert to text via Google Docs
 * Uses resumable upload for large files
 */
async function uploadAndConvertWithGoogleDrive(
  pdfBytes: Uint8Array,
  accessToken: string
): Promise<string> {
  const fileSizeMB = pdfBytes.length / (1024 * 1024);
  console.log(`[extract-text] Uploading ${fileSizeMB.toFixed(2)}MB to Google Drive...`);
  
  // Use resumable upload for all sizes to handle larger files
  const initResponse = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/pdf",
        "X-Upload-Content-Length": pdfBytes.length.toString(),
      },
      body: JSON.stringify({
        name: `ocr_temp_${Date.now()}.pdf`,
        mimeType: "application/pdf",
      }),
    }
  );
  
  if (!initResponse.ok) {
    const err = await initResponse.text();
    throw new Error(`Resumable upload init failed: ${initResponse.status} - ${err}`);
  }
  
  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("No upload URL returned from resumable init");
  }
  
  console.log("[extract-text] Got resumable upload URL, uploading file...");
  
  // Upload the file data
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": pdfBytes.length.toString(),
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  
  if (!uploadResponse.ok) {
    const err = await uploadResponse.text();
    throw new Error(`File upload failed: ${uploadResponse.status} - ${err}`);
  }
  
  const uploadData = await uploadResponse.json();
  const fileId = uploadData.id;
  console.log(`[extract-text] Uploaded PDF, fileId: ${fileId}`);
  
  // Convert to Google Docs format (triggers OCR)
  console.log("[extract-text] Converting to Google Docs (OCR)...");
  const copyResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `ocr_converted_${Date.now()}`,
        mimeType: "application/vnd.google-apps.document",
      }),
    }
  );
  
  const copyData = await copyResponse.json();
  if (copyData.error) {
    // Clean up original file
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    throw new Error(`Copy/convert error: ${copyData.error.message}`);
  }
  
  const docId = copyData.id;
  console.log(`[extract-text] Converted to Google Doc, docId: ${docId}`);
  
  // Export as plain text
  console.log("[extract-text] Exporting Google Doc as text...");
  const exportResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    {
      headers: { "Authorization": `Bearer ${accessToken}` },
    }
  );
  
  if (!exportResponse.ok) {
    throw new Error(`Export error: ${exportResponse.statusText}`);
  }
  
  const extractedText = await exportResponse.text();
  console.log(`[extract-text] Google Docs OCR extracted ${extractedText.length} chars`);
  
  // Clean up: Delete both files from Drive
  console.log("[extract-text] Cleaning up temp files from Drive...");
  await Promise.all([
    fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    }),
    fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    }),
  ]);
  
  return extractedText;
}

/**
 * Process PDF with Google Docs OCR
 * This uploads the PDF to Google Drive, converts it to Google Docs (triggering OCR),
 * then exports the text. Works excellently with custom font PDFs!
 */
async function processWithGoogleDocsOCR(
  pdfBytes: Uint8Array,
  credentials: { client_email: string; private_key: string }
): Promise<string> {
  console.log(`[extract-text] Starting Google Docs OCR for ${(pdfBytes.length / 1024 / 1024).toFixed(1)}MB file...`);
  
  // Get OAuth token
  const accessToken = await getServiceAccountToken(credentials);
  console.log("[extract-text] Got service account access token");
  
  // For large files (>5MB), use resumable upload
  const fileSizeMB = pdfBytes.length / (1024 * 1024);
  let fileId: string;
  
  if (fileSizeMB > 5) {
    // Use resumable upload for large files
    console.log("[extract-text] Using resumable upload for large file...");
    
    // Step 1: Initiate resumable upload
    const initResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "application/pdf",
          "X-Upload-Content-Length": pdfBytes.length.toString(),
        },
        body: JSON.stringify({
          name: `ocr_temp_${Date.now()}.pdf`,
          mimeType: "application/pdf",
        }),
      }
    );
    
    if (!initResponse.ok) {
      const err = await initResponse.text();
      throw new Error(`Resumable upload init failed: ${initResponse.status} - ${err}`);
    }
    
    const uploadUrl = initResponse.headers.get("Location");
    if (!uploadUrl) {
      throw new Error("No upload URL returned from resumable init");
    }
    
    console.log("[extract-text] Got resumable upload URL, uploading file...");
    
    // Step 2: Upload the file data
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": pdfBytes.length.toString(),
        "Content-Type": "application/pdf",
      },
      body: pdfBytes,
    });
    
    if (!uploadResponse.ok) {
      const err = await uploadResponse.text();
      throw new Error(`File upload failed: ${uploadResponse.status} - ${err}`);
    }
    
    const uploadData = await uploadResponse.json();
    fileId = uploadData.id;
  } else {
    // Simple multipart upload for smaller files
    const boundary = "===BOUNDARY===";
    const metadata = {
      name: `ocr_temp_${Date.now()}.pdf`,
      mimeType: "application/pdf",
    };
    
    const metadataPart = JSON.stringify(metadata);
    const encoder = new TextEncoder();
    
    const parts = [
      `--${boundary}\r\n`,
      `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
      `${metadataPart}\r\n`,
      `--${boundary}\r\n`,
      `Content-Type: application/pdf\r\n\r\n`,
    ];
    const endPart = `\r\n--${boundary}--`;
    
    const textParts = parts.join('');
    const textBytes = encoder.encode(textParts);
    const endBytes = encoder.encode(endPart);
    
    const body = new Uint8Array(textBytes.length + pdfBytes.length + endBytes.length);
    body.set(textBytes, 0);
    body.set(pdfBytes, textBytes.length);
    body.set(endBytes, textBytes.length + pdfBytes.length);
    
    console.log("[extract-text] Uploading PDF to Google Drive...");
    const uploadResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: body,
      }
    );
    
    const uploadData = await uploadResponse.json();
    if (uploadData.error) {
      throw new Error(`Upload error: ${uploadData.error.message}`);
    }
    fileId = uploadData.id;
  }
  
  console.log(`[extract-text] Uploaded PDF, fileId: ${fileId}`);
  
  // Now we need to copy/convert to Google Docs format to trigger OCR
  // The direct upload doesn't OCR, we need to use the copy endpoint with mimeType conversion
  const copyResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `ocr_converted_${Date.now()}`,
        mimeType: "application/vnd.google-apps.document",
      }),
    }
  );
  
  const copyData = await copyResponse.json();
  if (copyData.error) {
    // Clean up original file
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    throw new Error(`Copy/convert error: ${copyData.error.message}`);
  }
  
  const docId = copyData.id;
  console.log(`[extract-text] Converted to Google Doc, docId: ${docId}`);
  
  // Export as plain text
  console.log("[extract-text] Exporting Google Doc as text...");
  const exportResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    {
      headers: { "Authorization": `Bearer ${accessToken}` },
    }
  );
  
  if (!exportResponse.ok) {
    throw new Error(`Export error: ${exportResponse.statusText}`);
  }
  
  const extractedText = await exportResponse.text();
  console.log(`[extract-text] Google Docs OCR extracted ${extractedText.length} chars`);
  
  // Clean up: Delete both files from Drive
  console.log("[extract-text] Cleaning up temp files from Drive...");
  await Promise.all([
    fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    }),
    fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    }),
  ]);
  
  return extractedText;
}

/**
 * Process PDF with Google Document AI
 * Uses the OCR_PROCESSOR for best text extraction from PDFs with custom fonts
 */
async function processWithDocumentAI(
  pdfBytes: Uint8Array,
  apiKey: string,
  projectId: string,
  processorId: string
): Promise<string> {
  // Convert to base64 safely (works for large files)
  const base64Content = encodeBase64(pdfBytes);
  
  // Call Document AI process endpoint
  const endpoint = `https://us-documentai.googleapis.com/v1/projects/${projectId}/locations/us/processors/${processorId}:process?key=${apiKey}`;
  
  console.log(`[extract-text] Calling Document AI: ${endpoint.split('?')[0]}`);
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawDocument: {
        content: base64Content,
        mimeType: "application/pdf"
      }
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || "Document AI error");
  }
  
  // Extract text from Document AI response
  if (data.document?.text) {
    return data.document.text;
  }
  
  // Try to extract from pages if text not directly available
  if (data.document?.pages) {
    let allText = "";
    for (const page of data.document.pages) {
      if (page.paragraphs) {
        for (const para of page.paragraphs) {
          if (para.layout?.textAnchor?.textSegments) {
            for (const segment of para.layout.textAnchor.textSegments) {
              if (segment.startIndex !== undefined && segment.endIndex !== undefined) {
                allText += data.document.text.substring(segment.startIndex, segment.endIndex);
              }
            }
          }
        }
      }
    }
    if (allText.length > 0) return allText;
  }
  
  return "";
}

/**
 * Fallback: Process with Google Cloud Vision API
 */
async function processWithCloudVision(
  pdfBytes: Uint8Array,
  apiKey: string
): Promise<string> {
  // Vision API has smaller limits, use first 10MB
  const maxBytes = Math.min(pdfBytes.length, 10 * 1024 * 1024);
  const base64Content = encodeBase64(pdfBytes.slice(0, maxBytes));
  
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Content },
          features: [
            { type: "DOCUMENT_TEXT_DETECTION", maxResults: 50 }
          ],
          imageContext: {
            languageHints: ["en"]
          }
        }]
      }),
    }
  );

  const data = await response.json();
  
  if (data.responses?.[0]?.fullTextAnnotation?.text) {
    return data.responses[0].fullTextAnnotation.text;
  }
  
  if (data.responses?.[0]?.textAnnotations?.[0]?.description) {
    return data.responses[0].textAnnotations[0].description;
  }
  
  if (data.responses?.[0]?.error) {
    throw new Error(data.responses[0].error.message);
  }
  
  return "";
}

/**
 * Analyze network diagrams using GPT-4 Vision
 * Extracts topology information that OCR misses (connections, flow, relationships)
 */
async function analyzeNetworkDiagrams(
  supabase: any,
  storagePath: string,
  extractedText: string
): Promise<string> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey || !CONFIG.DIAGRAM_ANALYSIS_ENABLED) {
    return "";
  }

  // Check if document likely contains network diagrams
  const diagramIndicators = [
    /network\s+diagram/i,
    /topology/i,
    /router|switch|firewall/i,
    /interface\s+(fa|gi|eth)/i,
    /vlan\s+\d+/i,
    /ospf|eigrp|bgp/i,
    /figure\s+\d+/i,
    /diagram\s+\d+/i,
  ];
  
  const hasDiagramIndicators = diagramIndicators.some(pattern => pattern.test(extractedText));
  if (!hasDiagramIndicators) {
    console.log("[extract-text] No diagram indicators found, skipping diagram analysis");
    return "";
  }

  console.log("[extract-text] Diagram indicators detected, analyzing with GPT-4 Vision...");

  try {
    const { data: signedUrl } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 300);

    if (!signedUrl?.signedUrl) {
      console.log("[extract-text] Could not create signed URL for diagram analysis");
      return "";
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a network topology analyzer. Your task is to identify and describe network diagrams in technical documents.

For each diagram you find:
1. List all devices (routers, switches, servers, firewalls, etc.) with their labels/names
2. Describe connections between devices (which interface connects to which)
3. Note any IP addresses, subnet masks, VLAN IDs visible
4. Describe the network topology type (star, mesh, hierarchical, etc.)
5. Note any protocols or technologies indicated (OSPF, BGP, VLANs, etc.)

Output format:
[NETWORK DIAGRAM: Page X or Figure Y]
Devices: [list]
Connections: [list with format: Device1 (interface) <-> Device2 (interface)]
IP Addressing: [if visible]
Topology Type: [type]
Technologies: [list]
Description: [brief description of what the diagram shows]

If no network diagrams are present, respond with "NO_DIAGRAMS_FOUND".`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this document for network diagrams and extract the topology information. Focus on device connections, interfaces, and network relationships."
              },
              {
                type: "image_url",
                image_url: { url: signedUrl.signedUrl }
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("[extract-text] GPT-4 Vision diagram analysis error:", data.error);
      return "";
    }

    const diagramAnalysis = data.choices?.[0]?.message?.content || "";
    
    if (diagramAnalysis.includes("NO_DIAGRAMS_FOUND")) {
      console.log("[extract-text] No network diagrams found in document");
      return "";
    }
    
    console.log(`[extract-text] Diagram analysis extracted ${diagramAnalysis.length} chars of topology info`);
    return diagramAnalysis;

  } catch (error: any) {
    console.error("[extract-text] Diagram analysis failed:", error.message);
    return "";
  }
}

/**
 * Process large PDFs in page chunks using Document AI batch processing
 * Handles >20MB files by splitting into manageable chunks
 */
async function processLargePdfWithDocumentAI(
  pdfBytes: Uint8Array,
  googleKey: string,
  projectId: string,
  processorId: string,
  onProgress?: (progress: string) => Promise<void>
): Promise<string> {
  const fileSizeMB = pdfBytes.length / (1024 * 1024);
  console.log(`[extract-text] Processing large PDF (${fileSizeMB.toFixed(1)}MB) with Document AI chunking`);
  
  // Document AI inline processing limit is ~20MB
  // For larger files, we process in overlapping chunks
  const chunkSizeBytes = 15 * 1024 * 1024; // 15MB chunks (safe under 20MB limit)
  const overlapBytes = 500 * 1024; // 500KB overlap to catch split content
  
  const chunks: Uint8Array[] = [];
  let position = 0;
  
  while (position < pdfBytes.length) {
    const end = Math.min(position + chunkSizeBytes, pdfBytes.length);
    chunks.push(pdfBytes.slice(position, end));
    position = end - overlapBytes;
    if (position < 0) position = end;
  }
  
  console.log(`[extract-text] Split into ${chunks.length} chunks for processing`);
  
  const allTexts: string[] = [];
  let successfulChunks = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) {
      await onProgress(`Processing PDF chunk ${i + 1}/${chunks.length}...`);
    }
    
    try {
      console.log(`[extract-text] Processing chunk ${i + 1}/${chunks.length} (${(chunks[i].length/1024/1024).toFixed(1)}MB)`);
      
      const text = await processWithDocumentAI(chunks[i], googleKey, projectId, processorId);
      if (text && text.length > 50) {
        allTexts.push(text);
        successfulChunks++;
      }
    } catch (chunkError: any) {
      console.warn(`[extract-text] Chunk ${i + 1} failed: ${chunkError.message}`);
      // Continue with other chunks
    }
    
    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`[extract-text] Processed ${successfulChunks}/${chunks.length} chunks successfully`);
  
  // Combine and deduplicate text from all chunks
  const combinedText = deduplicateText(allTexts.join('\n\n'));
  
  if (chunks.length > 1) {
    return combinedText + `\n\n[Processed ${successfulChunks} of ${chunks.length} sections from ${fileSizeMB.toFixed(1)}MB document]`;
  }
  
  return combinedText;
}

/**
 * Preserve CLI/code formatting in extracted text
 * Detects CLI blocks and ensures proper spacing/indentation
 */
function preserveCliFormatting(text: string): string {
  if (!text || !CONFIG.PRESERVE_CLI_FORMATTING) return text;
  
  // Patterns that indicate CLI/code content
  const cliPatterns = [
    // Cisco CLI prompts
    /^(Router|Switch|R\d+|S\d+|[\w-]+)[>#]\s*/gm,
    // Linux/Unix prompts
    /^[\w@\-]+[:\$#]\s*/gm,
    // AWS CLI
    /^aws\s+\w+/gm,
    // Azure CLI
    /^az\s+\w+/gm,
    // Common commands
    /^(show|configure|interface|ip|no|enable|exit|end|router|network|hostname)\s+/gm,
    // Config blocks
    /^!\s*$/gm,
    /^#\s+/gm,
  ];
  
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let consecutiveCliLines = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isCliLine = cliPatterns.some(pattern => pattern.test(line));
    
    // Reset pattern lastIndex after test
    cliPatterns.forEach(p => p.lastIndex = 0);
    
    if (isCliLine) {
      consecutiveCliLines++;
      if (!inCodeBlock && consecutiveCliLines >= 2) {
        // Start a code block
        inCodeBlock = true;
        result.push('```');
        // Add any buffered lines
        result.push(...codeBlockLines);
        codeBlockLines = [];
      }
      if (inCodeBlock) {
        result.push(line);
      } else {
        codeBlockLines.push(line);
      }
    } else {
      if (inCodeBlock) {
        // Check if this looks like continuation of code
        const looksLikeCode = /^\s{2,}/.test(line) || // Indented
                             /^\s*$/.test(line) ||     // Empty line
                             /^[!#]/.test(line) ||     // Comment
                             /^\d+\.\d+\.\d+\.\d+/.test(line); // IP address
        
        if (looksLikeCode && line.length < 100) {
          result.push(line);
        } else {
          // End code block
          result.push('```');
          result.push(line);
          inCodeBlock = false;
          consecutiveCliLines = 0;
        }
      } else {
        // Not in code block, flush any buffered lines
        if (codeBlockLines.length > 0) {
          result.push(...codeBlockLines);
          codeBlockLines = [];
        }
        result.push(line);
        consecutiveCliLines = 0;
      }
    }
  }
  
  // Close any open code block
  if (inCodeBlock) {
    result.push('```');
  }
  
  // Flush remaining buffered lines
  if (codeBlockLines.length > 0) {
    result.push(...codeBlockLines);
  }
  
  return result.join('\n');
}

/**
 * Post-process extracted text to fix common OCR issues in CLI content
 */
function fixCliSpacing(text: string): string {
  if (!text || !CONFIG.PRESERVE_CLI_FORMATTING) return text;
  
  let fixed = text;
  
  // Fix common OCR misreads in network documentation
  const replacements: [RegExp, string][] = [
    // Fix split IP addresses (1 92.168.1.1 -> 192.168.1.1)
    [/(\d)\s+(\d{1,3}\.\d{1,3}\.\d{1,3})/g, '$1$2'],
    
    // Fix split subnet masks (/2 4 -> /24)
    [/\/\s*(\d)\s+(\d)/g, '/$1$2'],
    
    // Fix Cisco interface names (Gi 0/0 -> Gi0/0)
    [/(Gi|Fa|Te|Eth|Se|Po|Vl)\s*(\d)/gi, '$1$2'],
    
    // Fix show commands (show ip ro ute -> show ip route)
    [/show\s+ip\s+ro\s*u\s*te/gi, 'show ip route'],
    [/show\s+run\s*n\s*ing/gi, 'show running'],
    [/show\s+in\s*ter\s*face/gi, 'show interface'],
    
    // Fix common command splits
    [/con\s*fig\s*ure/gi, 'configure'],
    [/en\s*able/gi, 'enable'],
    [/inter\s*face/gi, 'interface'],
    [/host\s*name/gi, 'hostname'],
    
    // Fix VLAN spacing (VLAN 1 0 -> VLAN 10)
    [/VLAN\s+(\d)\s+(\d)/gi, 'VLAN $1$2'],
    
    // Fix IP address with port (10. 0.0.1 : 80 -> 10.0.0.1:80)
    [/(\d+)\.\s*(\d+)\.\s*(\d+)\.\s*(\d+)\s*:\s*(\d+)/g, '$1.$2.$3.$4:$5'],
    
    // Normalize multiple spaces in commands to single space
    [/(\w+)\s{2,}(\w+)/g, '$1 $2'],
  ];
  
  for (const [pattern, replacement] of replacements) {
    fixed = fixed.replace(pattern, replacement);
  }
  
  return fixed;
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate environment
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[extract-text] Missing environment variables");
    return createResponse({ 
      success: false, 
      error: "Server configuration error" 
    }, 500);
  }

  // Initialize Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let cloudDocumentId: string | undefined;

  try {
    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      return createResponse({ 
        success: false, 
        error: "Invalid JSON in request body" 
      }, 400);
    }

    cloudDocumentId = body.cloudDocumentId;
    const storagePath = body.storagePath;
    const fileType = body.fileType || "";

    console.log(`[extract-text] ===== START EXTRACTION =====`);
    console.log(`[extract-text] Document ID: ${cloudDocumentId}`);
    console.log(`[extract-text] Storage path: ${storagePath}`);
    console.log(`[extract-text] File type: ${fileType}`);

    // ===== VALIDATION =====
    
    // Validate UUID
    if (!cloudDocumentId || !isValidUUID(cloudDocumentId)) {
      console.error(`[extract-text] Invalid document ID: ${cloudDocumentId}`);
      return createResponse({ 
        success: false, 
        error: "Invalid document ID format. Expected UUID." 
      }, 400);
    }

    // Validate storage path
    if (!storagePath || typeof storagePath !== 'string' || storagePath.length < 5) {
      console.error(`[extract-text] Invalid storage path: ${storagePath}`);
      return createResponse({ 
        success: false, 
        error: "Invalid or missing storage path" 
      }, 400);
    }

    // ===== UPDATE STATUS: PROCESSING =====
    await updateDocumentStatus(supabase, cloudDocumentId, "processing");

    // ===== GET FILE SIZE FROM DB =====
    // For large files, we'll use streaming approach instead of downloading to memory
    const { data: docData } = await supabase
      .from("cloud_documents")
      .select("file_size, file_type")
      .eq("id", cloudDocumentId)
      .single();
    
    const fileSize = docData?.file_size || 0;
    const fileSizeMB = fileSize / (1024 * 1024);
    
    // Edge Function memory limit is 150MB, so we can only process files up to ~25MB safely
    const MAX_PROCESSABLE_SIZE_MB = 25;
    const isLargeFile = fileSizeMB > 10; // Files > 10MB use streaming
    const isTooBig = fileSizeMB > MAX_PROCESSABLE_SIZE_MB;

    console.log(`[extract-text] File size from DB: ${fileSizeMB.toFixed(2)} MB, isLargeFile: ${isLargeFile}, isTooBig: ${isTooBig}`);

    // For files too large to process in Edge Function, use Cloud Run OCR service
    if (isTooBig) {
      console.log(`[extract-text] File too large for Edge Function (${fileSizeMB.toFixed(1)}MB > ${MAX_PROCESSABLE_SIZE_MB}MB), trying Cloud Run...`);
      
      const cloudRunUrl = Deno.env.get("OCR_SERVICE_URL");
      
      if (cloudRunUrl) {
        try {
          // Create signed URL for the PDF
          const { data: signedUrlData, error: signedUrlError } = await supabase.storage
            .from("documents")
            .createSignedUrl(storagePath, 1800); // 30 minute expiry
          
          if (signedUrlError || !signedUrlData?.signedUrl) {
            throw new Error(`Failed to create signed URL: ${signedUrlError?.message || 'unknown error'}`);
          }
          
          console.log(`[extract-text] Calling Cloud Run OCR service...`);
          
          // Call Cloud Run OCR service
          const ocrResponse = await fetch(`${cloudRunUrl}/ocr`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signedUrl: signedUrlData.signedUrl,
              fileSize: fileSize,
              documentId: cloudDocumentId,
            }),
          });
          
          const ocrResult = await ocrResponse.json();
          
          if (ocrResult.success && ocrResult.text && ocrResult.text.length > 100) {
            console.log(`[extract-text] Cloud Run OCR extracted ${ocrResult.textLength} chars in ${ocrResult.duration}ms`);
            
            // Update document with extracted text
            await updateDocumentStatus(supabase, cloudDocumentId, "completed", {
              extractedText: ocrResult.text.substring(0, CONFIG.MAX_TEXT_LENGTH),
              textQuality: "good"
            });
            
            const duration = Date.now() - startTime;
            console.log(`[extract-text] ===== EXTRACTION COMPLETE (Cloud Run) in ${duration}ms =====`);
            
            return createResponse({
              success: true,
              documentId: cloudDocumentId,
              textLength: ocrResult.textLength,
              method: "cloud-run-google-docs-ocr",
              duration
            });
          } else {
            console.error(`[extract-text] Cloud Run OCR failed: ${ocrResult.error || 'no text extracted'}`);
          }
        } catch (cloudRunError: any) {
          console.error(`[extract-text] Cloud Run OCR error: ${cloudRunError.message}`);
        }
      } else {
        console.log(`[extract-text] Cloud Run OCR service not configured (OCR_SERVICE_URL not set)`);
      }
      
      // If Cloud Run fails or not configured, return error for client-side processing
      await updateDocumentStatus(supabase, cloudDocumentId, "pending_client_ocr", {
        processingError: `Large file (${fileSizeMB.toFixed(1)}MB) requires alternative OCR. Server-side processing unavailable.`
      });
      
      return createResponse({
        success: false,
        error: "file_too_large",
        requiresClientOcr: true,
        fileSize: fileSize,
        fileSizeMB: fileSizeMB,
        maxSizeMB: MAX_PROCESSABLE_SIZE_MB,
        message: `This ${fileSizeMB.toFixed(1)}MB file is too large for server-side processing. Please try a smaller file or split the PDF.`
      }, 200); // Return 200 so app knows this is expected, not an error
    }

    // Define partial download constant (not used for now but kept for future)
    const PARTIAL_DOWNLOAD_SIZE = 8 * 1024 * 1024;
    const downloadRange: { start: number; end: number } | undefined = undefined;
    const isPartialDownload = false;

    console.log(`[extract-text] File size from DB: ${fileSizeMB.toFixed(2)} MB, isLargeFile: ${isLargeFile}`);

    // ===== DETERMINE FILE TYPE =====
    const fileTypeLower = (fileType || docData?.file_type || "").toLowerCase();
    const pathLower = storagePath.toLowerCase();
    
    const isPdf = fileTypeLower.includes("pdf") || pathLower.endsWith(".pdf");
    const isPptx = fileTypeLower.includes("powerpoint") || fileTypeLower.includes("presentation") || 
                   pathLower.endsWith(".pptx") || pathLower.endsWith(".ppt");
    const isDocx = fileTypeLower.includes("word") || fileTypeLower.includes("document") ||
                   pathLower.endsWith(".docx") || pathLower.endsWith(".doc");

    console.log(`[extract-text] File type detection: PDF=${isPdf}, PPTX=${isPptx}, DOCX=${isDocx}`);

    // ===== FOR LARGE PDFs: USE STREAMING OCR (NO MEMORY DOWNLOAD) =====
    if (isPdf && isLargeFile) {
      console.log(`[extract-text] Large PDF detected (${fileSizeMB.toFixed(1)}MB), using streaming Google Docs OCR...`);
      
      // Use Google Docs OCR with streaming - no file download needed!
      const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
      if (serviceAccountJson) {
        try {
          const credentials = JSON.parse(serviceAccountJson);
          
          // Create signed URL for streaming
          const { data: signedUrlData } = await supabase.storage
            .from("documents")
            .createSignedUrl(storagePath, 600);
          
          if (signedUrlData?.signedUrl) {
            const extractedText = await processWithGoogleDocsOCRFromUrl(
              signedUrlData.signedUrl, 
              fileSize, 
              credentials
            );
            
            if (extractedText && extractedText.length > 100) {
              console.log(`[extract-text] Streaming OCR extracted ${extractedText.length} chars`);
              
              // Update document with extracted text
              await updateDocumentStatus(supabase, cloudDocumentId, "completed", {
                extractedText: extractedText.substring(0, CONFIG.MAX_TEXT_LENGTH),
                textQuality: "good"
              });
              
              const duration = Date.now() - startTime;
              console.log(`[extract-text] ===== EXTRACTION COMPLETE (streaming) in ${duration}ms =====`);
              
              return createResponse({
                success: true,
                documentId: cloudDocumentId,
                textLength: extractedText.length,
                method: "google-docs-streaming",
                duration
              });
            }
          }
        } catch (streamError: any) {
          console.error(`[extract-text] Streaming OCR failed: ${streamError.message}`);
        }
      }
      
      // If streaming failed, try downloading (might still fail due to memory)
      console.log(`[extract-text] Streaming OCR unavailable, falling back to download...`);
    }

    // ===== DOWNLOAD FILE =====
    console.log(`[extract-text] Downloading file from storage...`);
    
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(storagePath);

    if (downloadError || !fileData) {
      const errorMsg = downloadError?.message || "File not found in storage";
      console.error(`[extract-text] Download failed: ${errorMsg}`, JSON.stringify(downloadError));
      
      await updateDocumentStatus(supabase, cloudDocumentId, "error", {
        processingError: `Download failed: ${errorMsg}`
      });

      return createResponse({ 
        success: false, 
        error: "Failed to download file from storage",
        details: errorMsg,
        storagePath: storagePath,
        downloadError: JSON.stringify(downloadError)
      }, 500);
    }

    const actualFileSizeMB = fileData.size / (1024 * 1024);
    console.log(`[extract-text] Downloaded ${actualFileSizeMB.toFixed(2)} MB`);

    // Check file size limit
    if (actualFileSizeMB > CONFIG.MAX_FILE_SIZE_MB) {
      const errorMsg = `File too large: ${actualFileSizeMB.toFixed(2)}MB exceeds ${CONFIG.MAX_FILE_SIZE_MB}MB limit`;
      console.error(`[extract-text] ${errorMsg}`);
      
      await updateDocumentStatus(supabase, cloudDocumentId, "error", {
        processingError: errorMsg
      });

      return createResponse({ 
        success: false, 
        error: errorMsg
      }, 413);
    }

    // ===== EXTRACT TEXT =====
    let extractedText = "";
    let pageCount = 0;
    let textQuality: 'good' | 'poor' | 'garbage' = 'garbage';
    
    // Check if this is a very large file that needs chunked processing
    const isVeryLargeFile = actualFileSizeMB > 100;
    if (isVeryLargeFile) {
      console.log(`[extract-text] Very large file detected (${actualFileSizeMB.toFixed(1)}MB), using chunked processing...`);
      await updateDocumentStatus(supabase, cloudDocumentId, "processing", {
        processingError: `Processing large file (${actualFileSizeMB.toFixed(1)}MB) in chunks...`
      });
    }

    try {
      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      console.log(`[extract-text] File loaded into memory: ${bytes.length} bytes`);

      if (isPdf) {
        // For very large PDFs (>100MB), process in chunks
        if (isVeryLargeFile) {
          const chunkSize = CONFIG.CHUNK_SIZE_MB * 1024 * 1024; // 50MB chunks
          const totalChunks = Math.ceil(bytes.length / chunkSize);
          const allTexts: string[] = [];
          
          console.log(`[extract-text] Processing ${totalChunks} chunks of ${CONFIG.CHUNK_SIZE_MB}MB each`);
          
          for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize + 10000, bytes.length); // Overlap for continuity
            const chunk = bytes.slice(start, end);
            
            console.log(`[extract-text] Processing chunk ${i + 1}/${totalChunks} (${(chunk.length / 1024 / 1024).toFixed(1)}MB)`);
            
            await updateDocumentStatus(supabase, cloudDocumentId, "processing", {
              processingError: `Extracting text: chunk ${i + 1}/${totalChunks}...`
            });
            
            try {
              const chunkResult = await extractPdfText(chunk);
              if (chunkResult.text && chunkResult.text.length > 50) {
                allTexts.push(chunkResult.text);
              }
              if (i === 0) {
                pageCount = chunkResult.pageCount; // Page count from first chunk
              }
            } catch (chunkError: any) {
              console.warn(`[extract-text] Chunk ${i + 1} extraction failed: ${chunkError.message}`);
            }
          }
          
          // Combine all chunks and deduplicate
          extractedText = deduplicateText(allTexts.join('\n\n'));
          console.log(`[extract-text] Combined ${allTexts.length} chunks: ${extractedText.length} chars`);
          
        } else {
          const result = await extractPdfText(bytes);
          extractedText = result.text;
          pageCount = result.pageCount;
        }
        
        // Assess text quality
        const quality = assessTextQuality(extractedText);
        textQuality = quality.quality;
        console.log(`[extract-text] PDF quality: ${textQuality}, letters=${(quality.letterRatio*100).toFixed(1)}%, commonWords=${quality.commonWordCount}`);

        // OCR fallback if text quality is poor
        if (CONFIG.OCR_ENABLED && (textQuality === 'garbage' || extractedText.length < CONFIG.MIN_TEXT_QUALITY_CHARS)) {
          console.log(`[extract-text] Text quality insufficient, attempting OCR...`);
          await updateDocumentStatus(supabase, cloudDocumentId, "processing", {
            processingError: "Attempting OCR for scanned content..."
          });
          
          // Pass PDF bytes to OCR with progress callback
          const ocrText = await performOCR(
            supabase, 
            storagePath, 
            cloudDocumentId, 
            bytes,
            async (progress) => {
              await updateDocumentStatus(supabase, cloudDocumentId, "processing", {
                processingError: progress
              });
            }
          );
          if (ocrText.length > extractedText.length) {
            extractedText = ocrText;
            textQuality = assessTextQuality(extractedText).quality;
            console.log(`[extract-text] OCR improved text: ${extractedText.length} chars, quality: ${textQuality}`);
          }
        }
        
        // Analyze network diagrams if present (Cisco/network documents)
        if (CONFIG.DIAGRAM_ANALYSIS_ENABLED && extractedText.length > 500) {
          try {
            await updateDocumentStatus(supabase, cloudDocumentId, "processing", {
              processingError: "Analyzing network diagrams..."
            });
            
            const diagramAnalysis = await analyzeNetworkDiagrams(supabase, storagePath, extractedText);
            if (diagramAnalysis && diagramAnalysis.length > 100) {
              // Append diagram analysis to extracted text
              extractedText = extractedText + "\n\n" + 
                "=".repeat(50) + "\n" +
                "NETWORK TOPOLOGY ANALYSIS\n" +
                "=".repeat(50) + "\n\n" +
                diagramAnalysis;
              console.log(`[extract-text] Added ${diagramAnalysis.length} chars of diagram analysis`);
            }
          } catch (diagramError: any) {
            console.warn(`[extract-text] Diagram analysis failed (non-fatal): ${diagramError.message}`);
          }
        }
        
        // Fix CLI spacing issues from OCR
        extractedText = fixCliSpacing(extractedText);
        
        // Preserve CLI/code block formatting
        extractedText = preserveCliFormatting(extractedText);

      } else if (isPptx) {
        extractedText = await extractPptxText(bytes);
        pageCount = 1;
        textQuality = assessTextQuality(extractedText).quality;

      } else if (isDocx) {
        extractedText = await extractDocxText(bytes);
        pageCount = 1;
        textQuality = assessTextQuality(extractedText).quality;

      } else {
        // Plain text fallback
        const decoder = new TextDecoder("utf-8");
        extractedText = decoder.decode(bytes);
        textQuality = 'good';
      }

    } catch (extractError: any) {
      const errorMsg = extractError.message || "Unknown extraction error";
      console.error(`[extract-text] Extraction error: ${errorMsg}`);
      
      await updateDocumentStatus(supabase, cloudDocumentId, "error", {
        processingError: `Text extraction failed: ${errorMsg}`
      });

      return createResponse({ 
        success: false, 
        error: "Text extraction failed",
        details: errorMsg
      }, 500);
    }

    // ===== CLEAN AND TRUNCATE TEXT =====
    extractedText = cleanText(extractedText);
    
    if (extractedText.length > CONFIG.MAX_TEXT_LENGTH) {
      console.log(`[extract-text] Truncating text from ${extractedText.length} to ${CONFIG.MAX_TEXT_LENGTH}`);
      extractedText = extractedText.substring(0, CONFIG.MAX_TEXT_LENGTH) + 
        "\n\n[Note: Text truncated due to size limit. Full document is " + 
        (extractedText.length / 1024).toFixed(0) + "KB]";
    }

    console.log(`[extract-text] Final extracted text: ${extractedText.length} chars, ${pageCount} pages`);

    // ===== CHECK MINIMUM TEXT =====
    if (extractedText.length < 10) {
      const warningMsg = "Could not extract readable text. The document may be scanned, password-protected, or use custom fonts.";
      console.warn(`[extract-text] ${warningMsg}`);
      
      await updateDocumentStatus(supabase, cloudDocumentId, "ready", {
        extractedText: "",
        pageCount,
        processingError: warningMsg
      });

      return createResponse({ 
        success: true, 
        warning: warningMsg,
        textLength: 0,
        pageCount,
        textQuality: 'garbage'
      }, 200);
    }

    // ===== SAVE EXTRACTED TEXT =====
    const { error: updateError } = await supabase
      .from("cloud_documents")
      .update({
        status: "ready",
        extracted_text: extractedText,
        page_count: pageCount,
        processed_at: new Date().toISOString(),
        processing_error: null,
      })
      .eq("id", cloudDocumentId);

    if (updateError) {
      console.error(`[extract-text] Failed to save: ${updateError.message}`);
      return createResponse({ 
        success: false, 
        error: "Failed to save extracted text",
        details: updateError.message
      }, 500);
    }

    // ===== SUCCESS =====
    const elapsed = Date.now() - startTime;
    console.log(`[extract-text] ===== EXTRACTION COMPLETE =====`);
    console.log(`[extract-text] Time: ${elapsed}ms, Text: ${extractedText.length} chars, Pages: ${pageCount}, Quality: ${textQuality}`);

    return createResponse({ 
      success: true, 
      textLength: extractedText.length,
      pageCount,
      textQuality,
      processingTimeMs: elapsed
    }, 200);

  } catch (error: any) {
    const errorMsg = error.message || "Internal server error";
    console.error(`[extract-text] Unhandled error: ${errorMsg}`);
    console.error(error.stack || error);

    // Try to update document status if we have the ID
    if (cloudDocumentId && isValidUUID(cloudDocumentId)) {
      try {
        await updateDocumentStatus(supabase, cloudDocumentId, "error", {
          processingError: `Server error: ${errorMsg}`
        });
      } catch (e) {
        console.error("[extract-text] Failed to update error status");
      }
    }

    return createResponse({ 
      success: false, 
      error: errorMsg
    }, 500);
  }
});
