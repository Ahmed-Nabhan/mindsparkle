/**
 * Text Extraction Edge Function for MindSparkle
 * Extracts text from large documents stored in Supabase Storage
 * 
 * Supported formats:
 * - PDF (using pdf-parse)
 * - PPTX (PowerPoint)
 * - DOCX (Word)
 */

// @ts-nocheck - This file runs in Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractRequest {
  cloudDocumentId: string;
  storagePath: string;
  fileType: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get request body
    const { cloudDocumentId, storagePath, fileType }: ExtractRequest = await req.json();

    if (!cloudDocumentId || !storagePath) {
      return new Response(
        JSON.stringify({ error: "Missing cloudDocumentId or storagePath" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[extract-text] Processing document: ${cloudDocumentId}, path: ${storagePath}`);

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(storagePath);

    if (downloadError || !fileData) {
      console.error("[extract-text] Download error:", downloadError);
      
      await supabase
        .from("cloud_documents")
        .update({ 
          status: "error", 
          processing_error: "Failed to download file from storage" 
        })
        .eq("id", cloudDocumentId);

      return new Response(
        JSON.stringify({ error: "Failed to download file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[extract-text] Downloaded ${fileData.size} bytes`);

    // Extract text based on file type
    let extractedText = "";
    let pageCount = 0;

    const fileTypeLower = (fileType || "").toLowerCase();
    const pathLower = storagePath.toLowerCase();
    
    const isPdf = fileTypeLower.includes("pdf") || pathLower.endsWith(".pdf");
    const isPptx = fileTypeLower.includes("powerpoint") || fileTypeLower.includes("presentation") || 
                   pathLower.endsWith(".pptx") || pathLower.endsWith(".ppt");
    const isDocx = fileTypeLower.includes("word") || fileTypeLower.includes("document") ||
                   pathLower.endsWith(".docx") || pathLower.endsWith(".doc");

    try {
      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      if (isPdf) {
        // Extract from PDF
        const result = await extractPdfText(bytes);
        extractedText = result.text;
        pageCount = result.pageCount;
      } else if (isPptx) {
        // Extract from PowerPoint
        extractedText = await extractPptxText(bytes);
        pageCount = 1; // PPTX doesn't have traditional pages
      } else if (isDocx) {
        // Extract from Word
        extractedText = await extractDocxText(bytes);
        pageCount = 1;
      } else {
        // Try to read as plain text
        const decoder = new TextDecoder("utf-8");
        extractedText = decoder.decode(bytes);
      }
    } catch (extractError: any) {
      console.error("[extract-text] Extraction error:", extractError);
      
      await supabase
        .from("cloud_documents")
        .update({ 
          status: "error", 
          processing_error: `Text extraction failed: ${extractError.message}` 
        })
        .eq("id", cloudDocumentId);

      return new Response(
        JSON.stringify({ error: "Text extraction failed", details: extractError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean up extracted text
    extractedText = cleanText(extractedText);

    // Truncate if too long (max 2MB of text)
    const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
    if (extractedText.length > MAX_TEXT_LENGTH) {
      extractedText = extractedText.substring(0, MAX_TEXT_LENGTH) + 
        "\n\n[Note: Text truncated due to size limit]";
    }

    console.log(`[extract-text] Extracted ${extractedText.length} characters, ${pageCount} pages`);

    // Update cloud document with extracted text
    const { error: updateError } = await supabase
      .from("cloud_documents")
      .update({
        status: "ready",
        extracted_text: extractedText,
        page_count: pageCount,
        processed_at: new Date().toISOString(),
      })
      .eq("id", cloudDocumentId);

    if (updateError) {
      console.error("[extract-text] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to save extracted text" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        textLength: extractedText.length,
        pageCount 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[extract-text] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Extract text from PDF bytes
 */
async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  // Simple PDF text extraction (similar to client-side but more robust)
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes));
  
  let text = "";
  let pageCount = 0;

  // Count pages
  const pageMatches = binaryString.match(/\/Type\s*\/Page[^s]/g);
  pageCount = pageMatches ? pageMatches.length : 1;

  // Extract text from PDF streams
  // Look for text within parentheses (PDF literal strings)
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
        // Filter readable ASCII
        let readable = "";
        for (let j = 0; j < currentText.length; j++) {
          const c = currentText.charCodeAt(j);
          if (c >= 32 && c <= 126) {
            readable += currentText[j];
          }
        }
        if (readable.length > 1 && /[a-zA-Z]/.test(readable)) {
          text += readable + " ";
        }
      }
    } else if (inText) {
      currentText += char;
    }
  }

  // Also try to extract from BT/ET text blocks
  const btMatches = binaryString.matchAll(/BT\s*([\s\S]*?)\s*ET/g);
  for (const match of btMatches) {
    const block = match[1];
    // Extract Tj and TJ strings
    const tjMatches = block.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const tj of tjMatches) {
      const tjText = tj[1].replace(/[^\x20-\x7E]/g, " ").trim();
      if (tjText.length > 0) {
        text += tjText + " ";
      }
    }
  }

  return { text: text.trim(), pageCount };
}

/**
 * Extract text from PPTX bytes
 */
async function extractPptxText(bytes: Uint8Array): Promise<string> {
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes));
  
  let text = "";
  const maxMatches = 5000;
  let matchCount = 0;

  // Extract <a:t> tags (PowerPoint text elements)
  for (let i = 0; i < binaryString.length && matchCount < maxMatches; i++) {
    if (binaryString[i] === "<" && binaryString.substring(i, i + 4) === "<a:t") {
      const startTagEnd = binaryString.indexOf(">", i);
      if (startTagEnd === -1 || startTagEnd > i + 50) continue;
      
      const closeTag = "</a:t>";
      const endIdx = binaryString.indexOf(closeTag, startTagEnd + 1);
      if (endIdx === -1 || endIdx > startTagEnd + 500) continue;
      
      const tagText = binaryString.substring(startTagEnd + 1, endIdx);
      if (tagText && tagText.length > 0 && tagText.length < 200) {
        // Clean text
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

  return text.trim();
}

/**
 * Extract text from DOCX bytes
 */
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes));
  
  let text = "";
  
  // Remove XML tags and keep content
  // DOCX stores content in <w:t> tags
  const wtMatches = binaryString.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  for (const match of wtMatches) {
    const content = match[1];
    if (content && content.length > 0) {
      // Clean text
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

  // If no w:t tags found, try general XML text extraction
  if (text.length < 50) {
    // Remove all XML tags
    text = binaryString.replace(/<[^>]+>/g, " ");
    // Keep only printable characters
    text = text.replace(/[^\x20-\x7E\n]/g, " ");
  }

  return text.trim();
}

/**
 * Clean extracted text
 */
function cleanText(text: string): string {
  // Remove non-printable characters
  let cleaned = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 32 && code <= 126) || code === 10 || code === 13) {
      cleaned += text[i];
    } else {
      cleaned += " ";
    }
  }
  
  // Collapse multiple spaces
  if (cleaned.length < 1000000) {
    cleaned = cleaned.replace(/  +/g, " ").trim();
  }
  
  return cleaned;
}
