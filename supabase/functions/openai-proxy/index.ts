// @ts-nocheck - This file runs in Deno runtime, not Node.js
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // narrowed at runtime
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const MAX_CONTENT_LENGTH = 150000; // mirrors client limit (increased)
const MAX_REQUESTS_PER_MIN = 200; // INSTANT RESULTS: handle ALL parallel chunks at once
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function enforceCors(req: Request) {
  if (ALLOWED_ORIGINS.length === 0) return corsHeaders;
  const origin = req.headers.get("Origin") || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    return { ...corsHeaders, "Access-Control-Allow-Origin": origin };
  }
  throw new Error("Origin not allowed");
}

function rateLimit(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = rateBuckets.get(ip) || { count: 0, windowStart: now };
  if (bucket.windowStart < windowStart) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > MAX_REQUESTS_PER_MIN) {
    const err: any = new Error("Rate limit exceeded");
    err.status = 429;
    throw err;
  }
}

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  
  // Get Supabase config
  const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("PROJECT_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseAnonKey) {
    const err: any = new Error("Supabase config missing");
    err.status = 500;
    throw err;
  }
  
  // If token is the anon key itself, allow anonymous access with a dummy user
  // This handles cases where session hasn't loaded yet but anon key is valid
  if (token === supabaseAnonKey) {
    console.log("[Auth] Using anon key - allowing anonymous access");
    return { id: "anonymous", email: "anonymous@app.local" };
  }
  
  // No token at all
  if (!token) {
    const err: any = new Error("Missing auth token");
    err.status = 401;
    throw err;
  }

  // Try to verify the user token
  const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser(token);
  
  // If token verification failed but we have a token, allow with limited access
  // This handles edge cases with token refresh timing
  if (error || !data?.user) {
    console.warn("[Auth] Token verification failed:", error?.message || "no user");
    // Allow with anonymous user ID for better UX
    return { id: "anonymous-" + Date.now(), email: "guest@app.local" };
  }
  
  return data.user;
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const GOOGLE_CLOUD_API_KEY = Deno.env.get("GOOGLE_CLOUD_API_KEY"); // For Document AI
const GOOGLE_PROJECT_ID = Deno.env.get("GOOGLE_PROJECT_ID") || "mindsparkle-app";
const GOOGLE_LOCATION = "us"; // Document AI processor location
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "admin@example.com";

// Google Document AI - Extract text from PDF (1000 pages FREE/month, then $0.001/page)
async function extractWithGoogleDocumentAI(base64Pdf: string): Promise<{ text: string; pages: { pageNum: number; text: string }[] }> {
  if (!GOOGLE_CLOUD_API_KEY) {
    throw new Error("Google Cloud API key not configured");
  }
  
  console.log("[DocumentAI] Starting extraction...");
  
  // Use the Document AI REST API with API key
  // This uses the built-in OCR processor
  const url = `https://documentai.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${GOOGLE_LOCATION}/processors/-:process?key=${GOOGLE_CLOUD_API_KEY}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawDocument: {
        content: base64Pdf,
        mimeType: "application/pdf",
      },
      skipHumanReview: true,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error("[DocumentAI] Error:", error);
    throw new Error(`Document AI failed: ${response.status}`);
  }
  
  const result = await response.json();
  
  // Extract text from response
  const document = result.document;
  const fullText = document?.text || "";
  
  // Extract pages
  const pages: { pageNum: number; text: string }[] = [];
  if (document?.pages) {
    for (let i = 0; i < document.pages.length; i++) {
      const page = document.pages[i];
      let pageText = "";
      
      // Get text from page layout
      if (page.layout?.textAnchor?.textSegments) {
        for (const segment of page.layout.textAnchor.textSegments) {
          const start = parseInt(segment.startIndex || "0");
          const end = parseInt(segment.endIndex || fullText.length.toString());
          pageText += fullText.substring(start, end);
        }
      }
      
      // Fallback: extract from paragraphs
      if (!pageText && page.paragraphs) {
        for (const para of page.paragraphs) {
          if (para.layout?.textAnchor?.textSegments) {
            for (const segment of para.layout.textAnchor.textSegments) {
              const start = parseInt(segment.startIndex || "0");
              const end = parseInt(segment.endIndex || fullText.length.toString());
              pageText += fullText.substring(start, end) + "\n";
            }
          }
        }
      }
      
      pages.push({
        pageNum: i + 1,
        text: pageText.trim() || `[Page ${i + 1}]`,
      });
    }
  }
  
  // If no pages extracted, create one from full text
  if (pages.length === 0 && fullText) {
    pages.push({ pageNum: 1, text: fullText });
  }
  
  console.log("[DocumentAI] Extracted", pages.length, "pages,", fullText.length, "chars");
  
  return { text: fullText, pages };
}

// Send email notification to admin when credits run out
async function notifyAdminCreditExhausted(errorDetails: string) {
  try {
    // Use a free email service - Resend, SendGrid, or Supabase's built-in
    // For now, log it and you can check Supabase logs
    console.error("🚨 CRITICAL: OpenAI Credits Exhausted!");
    console.error("Admin Email:", ADMIN_EMAIL);
    console.error("Error:", errorDetails);
    console.error("Action Required: Add credits at https://platform.openai.com/account/billing");
    
    // Try to send email via Resend (free tier: 100 emails/day)
    // You can add RESEND_API_KEY to Supabase secrets if you want email notifications
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "MindSparkle <notifications@resend.dev>",
          to: ADMIN_EMAIL,
          subject: "🚨 MindSparkle: OpenAI Credits Exhausted!",
          html: `
            <h2>⚠️ OpenAI API Credits Exhausted</h2>
            <p>Your MindSparkle app's OpenAI credits have run out.</p>
            <p><strong>Error:</strong> ${errorDetails}</p>
            <p><strong>Action Required:</strong></p>
            <ol>
              <li>Go to <a href="https://platform.openai.com/account/billing">OpenAI Billing</a></li>
              <li>Add credits to your account</li>
              <li>Recommended: Add $10-20 for continued service</li>
            </ol>
            <p>Users are seeing "Service temporarily unavailable" message.</p>
          `,
        }),
      });
      console.log("Email notification sent to", ADMIN_EMAIL);
    }
  } catch (e) {
    console.error("Failed to send notification:", e);
  }
}

// Helper to detect and format OpenAI billing errors
function formatOpenAIError(error: any, statusCode?: number): string {
  const errorMessage = error?.message || error?.toString() || "Unknown error";
  const errorLower = errorMessage.toLowerCase();
  
  // Check for quota/billing errors
  if (
    statusCode === 429 ||
    statusCode === 402 ||
    errorLower.includes("quota") ||
    errorLower.includes("insufficient") ||
    errorLower.includes("billing") ||
    errorLower.includes("exceeded") ||
    errorLower.includes("rate limit")
  ) {
    // Notify admin (you) about the credit issue
    notifyAdminCreditExhausted(errorMessage);
    
    // Return generic message for users
    return "QUOTA_EXCEEDED: Service temporarily unavailable. Please try again later.";
  }
  
  return errorMessage;
}

// Retry helper for rate limits
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Prompt builder: returns tuned system prompts for different actions and languages
function buildSystemPrompt(action: string, opts: any = {}, language: string | undefined = 'en', style?: string, useAnimations?: boolean) {
  const langPrefix = language && language !== 'en' ? `Respond in ${language}. ` : '';

  if (action === 'summarize') {
    if (opts.isCombine) {
      return langPrefix + `You are an expert academic summarizer. Combine the provided section summaries into a single, exam-ready STUDY GUIDE. Output a clear hierarchical summary with: (1) Executive Overview (2-3 sentences), (2) Key Topics (bullet list), (3) Detailed Breakdown by topic with short explanations and page references, (4) Critical Terms table, (5) 7 Key Takeaways, and (6) a Quick Review checklist. Use concise, precise language suitable for students; prefer numbered lists and short paragraphs. Keep tone neutral and authoritative.`;
    }

    if (opts.chunkInfo) {
      return langPrefix + `You are an expert educational writer. Summarize ${opts.chunkInfo} as a self-contained study section.
      
      Include:
      - A short section title
      - ONE relevant image at the start: ![Topic](https://source.unsplash.com/600x300/?[keyword]) where [keyword] is 1-2 words describing the main topic
      - 3–6 bullet key points
      - 2 brief examples or clarifying sentences
      - Any page references present
      
      Keep the summary concise but complete.`;
    }

    // PROFESSIONAL WHOLE DOCUMENT SUMMARY WITH IMAGES
    return langPrefix + `You are an expert academic summarizer creating a PROFESSIONAL STUDY GUIDE with visual aids.
    
    YOUR GOAL: Create a comprehensive summary of the ENTIRE document, not just the beginning.
    
    STRUCTURE:
    1. 🎯 **Executive Summary**: A professional 3-4 sentence overview of the whole document.
       - After the executive summary, add an image: ![Topic Overview](https://source.unsplash.com/800x400/?[main-topic-keyword])
    
    2. 📖 **Detailed Analysis**: Break down the document into logical sections. For EACH section:
       - **Title**: Clear section title.
       - Add a relevant image at the start: ![Section Title](https://source.unsplash.com/600x300/?[section-keyword])
       - **Core Concepts**: Explain the main ideas in depth (not just bullets).
       - **Examples**: Include examples from the text.
    
    3. 🔑 **Key Terminology**: A table of definitions.
    
    4. 🧠 **Critical Analysis**: Connect ideas and explain "Why this matters".
    
    5. ✅ **Exam Prep**: 5-7 key takeaways and a checklist.
    
    IMAGE RULES:
    - Use Unsplash source URLs: https://source.unsplash.com/WIDTHxHEIGHT/?KEYWORD
    - Replace [main-topic-keyword] and [section-keyword] with relevant search terms from the content
    - Use only 1-2 keywords, separated by commas (e.g., biology,cell or computer,network)
    - Add 3-5 images total throughout the summary (not too many)
    - Choose keywords that match educational/academic imagery
    
    TONE: Professional, academic, yet accessible.
    IMPORTANT: Ensure you cover the END of the document as thoroughly as the beginning.`;
  }

  if (action === 'studyGuide') {
    return langPrefix + `Create a comprehensive JSON study guide that ONLY uses information from the document. Return valid JSON with keys: title, sections (each with title, pageRef, keyPoints array), keyTerms (term, definition, pageRef), reviewChecklist array. Be precise; include page refs where available; do not invent facts.`;
  }

  if (action === 'videoWithSlides') {
    const animDirective = useAnimations === false ? 'Do not include animation directions.' : 'Include a `visualDirections` array for each section with concrete animation/visual cues for the AI Teacher and the Screen (e.g., "Teacher points to graph", "Screen shows equation X").';
    const styleDirective = style ? `Use this narration style: ${style}. ` : '';
    
    return langPrefix + `You are an expert educational video writer. Produce a JSON video lesson script.
    
    OUTPUT FORMAT (JSON ONLY):
    {
      "introduction": "Welcome message...",
      "sections": [
        {
          "title": "Section Title",
          "narration": "The script for the AI teacher to speak. Explain the concept clearly as if teaching a class.",
          "visualDirections": ["Teacher: gestures to screen", "Screen: displays diagram of X", "Screen: highlights key term Y"],
          "keyPoints": ["Point 1", "Point 2"],
          "pageRef": 1
        }
      ],
      "conclusion": "Closing remarks..."
    }
    
    INSTRUCTIONS:
    - The "narration" must be engaging and educational (not just reading the text).
    - "visualDirections" should describe what the AI Teacher does and what appears on the Screen.
    - Cover the WHOLE document.
    - ${styleDirective}
    - ${animDirective}`;
  }

  // default fallback
  return language && language !== 'en' ? `Respond in ${language}. Provide a clear, concise summary.` : 'Provide a clear, concise summary.';
}

// Generate image using DALL-E 3
async function generateImage(prompt: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: prompt.substring(0, 1000), // Limit prompt length
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "url",
      }),
    });

    const data = await response.json();
    if (data.error) {
      console.error("DALL-E error:", data.error);
      return null;
    }
    return data.data?.[0]?.url || null;
  } catch (e) {
    console.error("Image generation failed:", e);
    return null;
  }
}

async function callOpenAI(systemPrompt: string, userPrompt: string, maxTokens = 4096, temperature = 0.3, useGpt4o = false): Promise<string> {
  // Model fallback chain: gpt-5-mini (fastest) -> gpt-4o-mini (backup)
  const models = ["gpt-5-mini", "gpt-4o-mini"];
  const safeMaxTokens = Math.min(maxTokens, 4096);
  
  for (const model of models) {
    console.log(`[callOpenAI] Trying model: ${model}, prompt length: ${userPrompt.length}`);
    const startTime = Date.now();
    
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: safeMaxTokens,
          temperature: temperature,
        }),
      });

      const data = await response.json();
      const elapsed = Date.now() - startTime;
      console.log(`[callOpenAI] Response from ${model} in ${elapsed}ms, status: ${response.status}`);
      
      if (data.error) {
        console.warn(`[callOpenAI] ${model} failed: ${JSON.stringify(data.error)}`);
        // If model not found or similar error, try next model
        if (data.error.code === "model_not_found" || data.error.type === "invalid_request_error") {
          console.log(`[callOpenAI] Falling back to next model...`);
          continue;
        }
        // For other errors (rate limit, etc), throw immediately
        throw new Error(formatOpenAIError(data.error, response.status));
      }
      
      const result = data.choices?.[0]?.message?.content || "";
      console.log(`[callOpenAI] Success with ${model}, result length: ${result.length} chars`);
      return result;
    } catch (fetchError: any) {
      console.error(`[callOpenAI] Fetch error with ${model}:`, fetchError.message);
      // If it's a network error, try next model
      if (model !== models[models.length - 1]) {
        continue;
      }
      throw fetchError;
    }
  }
  
  throw new Error("All models failed");
}

Deno.serve(async (req) => {
  let cors = corsHeaders;

  try {
    cors = enforceCors(req);

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: cors });
    }

    rateLimit(req);
    const user = await getAuthUser(req);

    const { action, content, language, isCombine, chunkInfo, includeImages, imageUrls, questionCount, totalPages, pageCount, style, useAnimations, ...body } = await req.json();

    if (content && typeof content === 'string' && content.length > MAX_CONTENT_LENGTH) {
      return new Response(JSON.stringify({ error: 'Content too large' }), {
        status: 413,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let result;
    let systemPrompt;
    const hasImages = imageUrls && imageUrls.length > 0;
    const hasContent = content && content.length > 0;

    switch (action) {
      case 'summarize': {
        // VALIDATION: Check if content is sufficient
        if (!hasContent && !hasImages) {
          console.warn('[summarize] No content or images provided');
          return new Response(JSON.stringify({ 
            summary: 'Unable to generate summary: No content found in the document. Please ensure the document has extractable text.',
            userId: user.id 
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
  
  // Build a tuned system prompt using prompt builder
  systemPrompt = buildSystemPrompt('summarize', { isCombine, chunkInfo }, language);
        
        // If images are available and either text is small or includeImages explicitly requested,
        // use the vision-capable endpoint to produce a multimodal summary that references images.
        if (hasImages && (includeImages || !hasContent || content.length < 800)) {
          console.log('[summarize] Using Vision API for multimodal summarization');
          const visionPrompt = `Create a comprehensive STUDY SUMMARY using both the text and the images. Include references to images where relevant (e.g., "see image on page X"), and produce the same structured study-friendly format as the system prompt. Respond in ${language || 'English'}.`;
          result = await callOpenAIVision(systemPrompt, imageUrls, `Summarize this content and images:\n\n${content}\n\nInstructions: ${visionPrompt}`, 4096);
        } else {
          // Add language directive if requested
          const langPrefix = language && language !== 'en' ? `Respond in ${language}. ` : '';
          result = await callOpenAI(systemPrompt, `${langPrefix}Create a comprehensive, study-friendly summary of this content (${content.length} characters):\n\n${content}`, 4096, 0.3);
        }
        
        return new Response(JSON.stringify({ summary: result, userId: user.id }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "quiz": {
        // VALIDATION: Check if content is sufficient
        if (!hasContent || content.length < 100) {
          console.warn('[quiz] Content too short:', content?.length || 0);
          return new Response(JSON.stringify({ 
            questions: [],
            error: 'Unable to generate quiz: Document content is too short or empty.',
            userId: user.id 
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        
        const systemPrompt = `Create ${questionCount || 10} quiz questions based ONLY on the document content provided.

CRITICAL ACCURACY RULES:
- Questions must be answerable ONLY from information in the document
- Correct answers must be EXACTLY as stated in the document
- DO NOT create questions requiring external knowledge
- Wrong options should be plausible but clearly incorrect per the document
- Include page references for where EACH answer can be verified

Return ONLY valid JSON array: [{"question":"...","options":["A","B","C","D"],"correctAnswer":0,"explanation":"The document states on page X: '...'","pageRef":X}]

Create questions from different parts of the document. Every question must be verifiable from the source text.`;
        
        result = await callOpenAI(systemPrompt, `Create quiz questions using ONLY information from this document:\n\n${content}`, 4096, 0.3);
        
        try {
          const match = result.match(/\[[\s\S]*\]/);
          if (match) {
            return new Response(JSON.stringify({ questions: JSON.parse(match[0]), userId: user.id }), {
              headers: { ...cors, "Content-Type": "application/json" },
            });
          }
        } catch {}
        
        return new Response(JSON.stringify({ questions: [], userId: user.id }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "studyGuide": {
        // VALIDATION: Check if content or images are available
        if (!hasContent && !hasImages) {
          console.warn('[studyGuide] No content or images provided');
          return new Response(JSON.stringify({ 
            studyGuide: null,
            summary: 'Unable to generate study guide: No content found in the document.',
            userId: user.id 
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        
        const systemPrompt = `Create a comprehensive and ACCURATE study guide covering the ENTIRE document.

CRITICAL ACCURACY RULES:
- ONLY include terms, concepts, and facts that EXPLICITLY appear in the document
- DO NOT add external information or general knowledge
- Quote definitions exactly as they appear in the source
- Use the same terminology as the document
- Page refs must match where information actually appears

Return ONLY valid JSON in this format:
{
  "title": "Study Guide: [Document Topic]",
  "sections": [
    {
      "title": "Section Title (e.g., Chapter 1: Introduction)",
      "pageRef": 1,
      "keyPoints": [
        {"point": "Key concept or term explained", "pageRef": 1},
        {"point": "Another important point", "pageRef": 2}
      ]
    }
  ],
  "keyTerms": [
    {"term": "Term Name", "definition": "Definition from document", "pageRef": 5}
  ],
  "reviewChecklist": [
    {"item": "Understand concept X", "pageRef": 3},
    {"item": "Know how to apply Y", "pageRef": 7}
  ]
}

Create 5-10 sections covering ALL major topics with accurate page references.
Include 10-20 key terms and 5-10 review checklist items.`;
        
        // If we have images but limited text, use vision API
        if (hasImages && (!hasContent || content.length < 500)) {
          console.log("Using Vision API for study guide with", imageUrls.length, "images");
          
          const visionPrompt = `Analyze these document pages and create a comprehensive study guide. Look at all the images carefully to extract the main topics, key concepts, and important information.

Return ONLY valid JSON in this format:
{
  "title": "Study Guide: [Document Topic]",
  "sections": [
    {
      "title": "Section Title",
      "pageRef": 1,
      "keyPoints": [
        {"point": "Key concept explained", "pageRef": 1}
      ]
    }
  ],
  "keyTerms": [
    {"term": "Term", "definition": "Definition", "pageRef": 1}
  ],
  "reviewChecklist": [
    {"item": "Understand concept", "pageRef": 1}
  ]
}`;
          
          result = await callOpenAIVision(systemPrompt, imageUrls, visionPrompt, 4096);
        } else {
          // Respect language and vision options for study guides
          if (hasImages && (!hasContent || content.length < 500)) {
            console.log("Using Vision API for study guide with", imageUrls.length, "images");
            const visionPrompt = `Analyze these document pages and create a comprehensive study guide. Return ONLY valid JSON in the specified study guide format. Respond in ${language || 'English'}.`;
            result = await callOpenAIVision(systemPrompt, imageUrls, visionPrompt, 4096);
          } else {
            // Use tuned prompt builder for studyGuide
            systemPrompt = buildSystemPrompt('studyGuide', {}, language);
            const langPrefix = language && language !== 'en' ? `Respond in ${language}. ` : '';
            result = await callOpenAI(systemPrompt, `${langPrefix}Create a structured study guide with page references using ONLY information from this document:\n\n${content}`, 4096, 0.2);
          }
        }
        
        try {
          const match = result.match(/\{[\s\S]*\}/);
          if (match) {
            const studyGuide = JSON.parse(match[0]);
            return new Response(JSON.stringify({ studyGuide, summary: result, userId: user.id }), {
              headers: { ...cors, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.error("Study guide JSON parse error:", e);
        }
        
        return new Response(JSON.stringify({ summary: result, userId: user.id }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "videoWithSlides": {
        const docInfo = totalPages ? `${totalPages} page document` : (pageCount ? `${pageCount} page document` : 'document');
        
        // Use tuned prompt builder for video scripts
        systemPrompt = buildSystemPrompt('videoWithSlides', {}, language, style, useAnimations);
        // Use gpt-4o-mini for speed
        result = await callOpenAI(systemPrompt, `Create an engaging, comprehensive video lesson covering this entire ${docInfo}. Make it professional, educational, and memorable:\n\n${content}`, 4096, 0.25, false);
        
        try {
          const match = result.match(/\{[\s\S]*\}/);
          if (match) {
            const videoScript = JSON.parse(match[0]);
            return new Response(JSON.stringify({ videoScript, userId: user.id }), {
              headers: { ...cors, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.error("JSON parse error:", e);
        }
        
        return new Response(JSON.stringify({ 
          videoScript: { 
            introduction: "Welcome to this lesson.", 
            sections: [], 
            conclusion: "Thank you for learning!" 
          },
          userId: user.id,
        }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      // New: Process video chunks in parallel for large documents
      case "videoChunk": {
        const chunkInfo = body.chunkInfo || 'document section';
        const animDirective = useAnimations === false ? '' : 'Include visualDirections array with animation cues.';
        
        const chunkPrompt = `You are creating video lesson sections. Return ONLY valid JSON array of sections for ${chunkInfo}:
[
  {
    "title": "Section Title",
    "narration": "Engaging explanation of the content...",
    "keyPoints": ["Key point 1", "Key point 2"],
    "visualDirections": ["Teacher: points to diagram", "Screen: shows formula"],
    "pageRef": 1
  }
]
Create 1-2 sections per page. ${animDirective} Be educational and engaging.${language !== 'en' ? ` Respond in ${language}.` : ''}`;
        
        result = await callOpenAI(chunkPrompt, `Create video sections for this content:\n\n${content}`, 2048, 0.25, false);
        
        try {
          const match = result.match(/\[[\s\S]*\]/);
          if (match) {
            const sections = JSON.parse(match[0]);
            return new Response(JSON.stringify({ sections, userId: user.id }), {
              headers: { ...cors, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.error("Video chunk JSON parse error:", e);
        }
        
        return new Response(JSON.stringify({ sections: [], userId: user.id }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      // New: Generate intro and conclusion for parallel-processed videos
      case "videoIntroConclusion": {
        const totalSections = body.totalSections || 1;
        const introPrompt = `Create a video lesson introduction and conclusion. Return ONLY valid JSON:
{
  "introduction": "Welcome message introducing the topic (2-3 sentences, engaging)",
  "conclusion": "Closing remarks summarizing the ${totalSections} sections covered (2-3 sentences)"
}
${language !== 'en' ? `Respond in ${language}.` : ''}`;
        
        result = await callOpenAI(introPrompt, `Based on this content preview, create intro and conclusion:\n\n${content}`, 512, 0.3, false);
        
        try {
          const match = result.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            return new Response(JSON.stringify({ 
              introduction: parsed.introduction || "Welcome to this lesson!",
              conclusion: parsed.conclusion || "Thank you for learning!",
              userId: user.id 
            }), {
              headers: { ...cors, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.error("Intro/conclusion JSON parse error:", e);
        }
        
        return new Response(JSON.stringify({ 
          introduction: "Welcome to this comprehensive lesson!",
          conclusion: "Thank you for learning with me today!",
          userId: user.id 
        }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "video": {
        // Legacy support - redirect to videoWithSlides
        const systemPrompt = `Create a PROFESSIONAL, ENGAGING video lesson script. Return ONLY valid JSON:
{
  "introduction": "📚 Welcome! Today we'll master [topic]...",
  "sections": [{"title": "📖 Topic", "narration": "Let me explain this fascinating concept... [detailed, engaging explanation]", "pageRef": 1, "keyPoints": ["🔑 point1", "💡 point2"]}],
  "conclusion": "🎓 Great job! Let's recap: [comprehensive summary]..."
}
Make it engaging, educational, and memorable like a great TED talk!`;
        
        result = await callOpenAI(systemPrompt, `Create engaging video lesson:\n\n${content}`, 4096);
        
        try {
          const match = result.match(/\{[\s\S]*\]/);
          if (match) {
            return new Response(JSON.stringify({ videoScript: JSON.parse(match[0]), userId: user.id }), {
              headers: { ...cors, "Content-Type": "application/json" },
            });
          }
        } catch {}
        
        return new Response(JSON.stringify({ 
          videoScript: { introduction: "Welcome.", sections: [], conclusion: "Thank you!" },
          userId: user.id,
        }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "interview": {
        // content is already the full prompt for interview questions
        const systemPrompt = `You are an expert interview coach helping candidates prepare for job interviews. Generate interview questions based on the provided document content.`;
        
        const temperature = body.temperature || 0.3;
        result = await callOpenAI(systemPrompt, content, 4096, temperature);
        
        return new Response(JSON.stringify({ response: result, userId: user.id }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "chat": {
        const { message, context, history } = body;
        
        let systemPrompt = `You are a helpful AI study assistant. You help students understand documents and answer their questions clearly and accurately.`;
        
        if (context) {
          systemPrompt += `\n\nDocument Context:\n${context.substring(0, 8000)}`;
        }
        
        // Build messages array
        const messages: { role: string; content: string }[] = [
          { role: "system", content: systemPrompt }
        ];
        
        // Add conversation history if provided
        if (history && Array.isArray(history)) {
          for (const msg of history.slice(-10)) {
            messages.push({ role: msg.role, content: msg.content });
          }
        }
        
        // Add the current message
        messages.push({ role: "user", content: message });
        
        // Try models with fallback
        const chatModels = ["gpt-5-mini", "gpt-4o-mini"];
        let chatResult = null;
        
        for (const model of chatModels) {
          try {
            console.log(`[chat] Trying model: ${model}`);
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 4096,
                temperature: 0.7,
              }),
            });

            const data = await response.json();
            
            if (data.error) {
              console.warn(`[chat] ${model} failed:`, data.error);
              if (data.error.code === "model_not_found" || data.error.type === "invalid_request_error") {
                continue; // Try next model
              }
              throw new Error(data.error.message);
            }
            
            chatResult = data.choices?.[0]?.message?.content || "I couldn't generate a response.";
            console.log(`[chat] Success with ${model}`);
            break;
          } catch (e: any) {
            console.error(`[chat] Error with ${model}:`, e.message);
            if (model === chatModels[chatModels.length - 1]) throw e;
          }
        }
        
        return new Response(JSON.stringify({ 
          response: chatResult || "I couldn't generate a response.",
          userId: user.id,
        }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "flashcards": {
        const systemPrompt = `You are an expert educator. Generate flashcards from the provided content.
Each flashcard should have:

// Example format for flashcards:
// [
//   {"term": "Photosynthesis", "definition": "The process by which plants convert light energy into chemical energy", "difficulty": "medium"},
//   {"term": "What is the capital of France?", "definition": "Paris", "difficulty": "easy"}
// ]
// Generate 10-20 high-quality flashcards covering the most important concepts.`;
        
        result = await callOpenAI(systemPrompt, `Create flashcards from this content:\n\n${content}`, 4096);
        
        try {
          const match = result.match(/\[[\s\S]*\]/);
          if (match) {
            const flashcards = JSON.parse(match[0]);
            return new Response(JSON.stringify({ flashcards, userId: user.id }), {
              headers: { ...cors, "Content-Type": "application/json" },
            });
          }
        } catch {}
        
        return new Response(JSON.stringify({ flashcards: [], userId: user.id }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      case "ocr": {
        // OCR for scanned PDFs using GPT-4o Vision
        if (!imageUrls || imageUrls.length === 0) {
          return new Response(JSON.stringify({ 
            text: "No image provided for OCR.",
            error: "Missing imageUrls parameter" 
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        
        const ocrSystemPrompt = `You are an OCR (Optical Character Recognition) assistant. Your task is to extract ALL visible text from document images with high accuracy.

Instructions:
- Read and extract every piece of text visible in the image
- Maintain the original reading order (top to bottom, left to right)
- Preserve the document structure (paragraphs, headings, lists, etc.)
- For tables, format them clearly with | separators
- If text is partially obscured or unclear, indicate with [unclear] but still attempt to read it
- Include numbers, dates, and special characters exactly as shown
- Do NOT summarize or paraphrase - extract the actual text verbatim

Your output should be the extracted text in a readable format.`;

        const ocrUserPrompt = content || `Extract ALL text from this document image. Maintain the original structure and formatting. Output only the extracted text.`;
        
        try {
          result = await callOpenAIVision(ocrSystemPrompt, imageUrls, ocrUserPrompt, 4096);
          
          return new Response(JSON.stringify({ 
            text: result,
            success: true,
            userId: user.id,
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        } catch (ocrError) {
          console.error("OCR error:", ocrError);
          return new Response(JSON.stringify({ 
            text: "",
            error: String(ocrError),
            success: false,
            userId: user.id,
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
      }

      case "extractPdf": {
        // Extract text from PDF using Google Document AI
        // 1000 pages FREE/month, then $0.001/page
        const { pdfBase64 } = body;
        
        if (!pdfBase64) {
          return new Response(JSON.stringify({ 
            error: "Missing pdfBase64 parameter",
            text: "",
            pages: []
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        
        try {
          console.log("[extractPdf] Starting Google Document AI extraction...");
          const extraction = await extractWithGoogleDocumentAI(pdfBase64);
          
          return new Response(JSON.stringify({ 
            text: extraction.text,
            pages: extraction.pages,
            pageCount: extraction.pages.length,
            success: true,
            method: "google-document-ai",
            userId: user.id,
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        } catch (extractError: any) {
          console.error("[extractPdf] Google Document AI error:", extractError);
          
          // Fallback to OpenAI Vision OCR if Document AI fails
          if (imageUrls && imageUrls.length > 0) {
            try {
              console.log("[extractPdf] Falling back to OpenAI Vision OCR...");
              const ocrResult = await callOpenAIVision(
                "Extract ALL text from this PDF document. Maintain structure and formatting.",
                imageUrls,
                "Extract every piece of text visible. Output the text exactly as it appears.",
                4096
              );
              
              return new Response(JSON.stringify({ 
                text: ocrResult,
                pages: [{ pageNum: 1, text: ocrResult }],
                pageCount: 1,
                success: true,
                method: "openai-vision-fallback",
                userId: user.id,
              }), {
                headers: { ...cors, "Content-Type": "application/json" },
              });
            } catch (ocrFallbackError) {
              console.error("[extractPdf] OCR fallback also failed:", ocrFallbackError);
            }
          }
          
          return new Response(JSON.stringify({ 
            error: extractError.message || "PDF extraction failed",
            text: "",
            pages: [],
            success: false,
            userId: user.id,
          }), {
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error) {
    console.error("Error:", error);

    const status = (error as any)?.status || 500;
    const errorMessage = String(error);
    if (errorMessage.includes('QUOTA_EXCEEDED') || errorMessage.includes('insufficient') || errorMessage.includes('billing')) {
      return new Response(JSON.stringify({ 
        error: "AI service temporarily unavailable. Please try again in a few minutes.",
      }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      details: "Please try again. If the problem persists, contact support."
    }), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
