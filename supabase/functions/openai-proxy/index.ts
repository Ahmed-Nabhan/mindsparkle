// @ts-nocheck - This file runs in Deno runtime, not Node.js
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

async function callOpenAI(systemPrompt: string, userPrompt: string, maxTokens = 4096, temperature = 0.3): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: temperature,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

// Vision API call for analyzing images
async function callOpenAIVision(systemPrompt: string, imageUrls: string[], textPrompt: string, maxTokens = 4096): Promise<string> {
  // Build content array with images
  const content: any[] = [
    { type: "text", text: textPrompt }
  ];
  
  // Add up to 10 images (GPT-4o vision limit considerations)
  const imagesToSend = imageUrls.slice(0, 10);
  for (const url of imagesToSend) {
    content.push({
      type: "image_url",
      image_url: { url: url, detail: "low" } // Use low detail for faster processing
    });
  }
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: content },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, content, chunkInfo, isCombine, includePageRefs, questionCount, pageCount, totalPages, imageUrls } = body;

    // Check if we have content OR images to work with
    const hasContent = content && content.length >= 10;
    const hasImages = imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0;
    
    if (!hasContent && !hasImages) {
      return new Response(JSON.stringify({ 
        error: "No text content could be extracted from the document. The PDF may contain scanned images or have copy protection.",
        summary: "",
        questions: []
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    let result = "";

    switch (action) {
      case "summarize": {
        let systemPrompt: string;
        
        if (isCombine) {
          systemPrompt = `You are combining multiple section summaries into ONE comprehensive executive summary.

CRITICAL RULES FOR ACCURACY:
- ONLY include information that appears in the provided summaries
- DO NOT add any external information or assumptions
- DO NOT infer or extrapolate beyond what is stated
- If something is unclear, state it as presented in the source

Create a unified summary that:
- Covers ALL major topics from EVERY section provided
- Uses clear headings for different topic areas
- Preserves page references exactly as given (format: "concept (p. X)")
- Maintains the original meaning and intent
- Creates a logical flow connecting all sections

The final summary must be 100% faithful to the source material.`;
        } else if (includePageRefs) {
          systemPrompt = `You are a professional document summarizer focused on ACCURACY and FAITHFULNESS to the source.

CRITICAL ACCURACY RULES:
- ONLY state facts that appear EXPLICITLY in the document
- DO NOT add interpretations, opinions, or external knowledge
- DO NOT make assumptions about what the document "implies"
- Use direct quotes when possible for important points
- If information is unclear, say "the document states..." rather than interpreting

The content contains page markers like "=== PAGE X ===" - use these for accurate page references.
Cover ALL pages provided, not just the beginning.

Create a thorough summary with:
1. **Document Overview**: What the document explicitly covers (not assumptions)
2. **Major Topics**: Each major topic/chapter with its EXACT key points
3. **Key Concepts**: Terms and definitions AS DEFINED in the document (p. X)
4. **Important Details**: Critical facts with page references
5. **Key Takeaways**: Main points directly from the document

Stay 100% faithful to the source text.`;
        } else if (chunkInfo) {
          systemPrompt = `Summarize ${chunkInfo} with STRICT ACCURACY.

RULES:
- ONLY include information explicitly stated in this section
- DO NOT add external knowledge or interpretations
- Quote key terms and definitions directly
- Include page references if present
- If something is ambiguous, present it as stated

Cover:
- Key concepts and definitions (quoted accurately)
- Important facts exactly as stated
- Main ideas with supporting details from the text`;
        } else {
          systemPrompt = `Create a comprehensive and ACCURATE summary of the provided content.

STRICT ACCURACY RULES:
- ONLY include information that explicitly appears in the text
- DO NOT add any external information, opinions, or assumptions
- DO NOT interpret or infer beyond what is directly stated
- Use the same terminology as the source document
- Quote important definitions and key phrases directly

Format with:
- Overview of what the document actually covers
- Key concepts using the document's own definitions
- Important facts as stated in the source
- Clear section headings matching the document structure
- Bullet points for easy reading

Be comprehensive but 100% faithful to the source.`;
        }
        
        result = await callOpenAI(systemPrompt, `Summarize ALL of this content ACCURATELY (${content.length} characters). Only include information from this text:\n\n${content}`, 4096, 0.2);
        
        return new Response(JSON.stringify({ summary: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "quiz": {
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
            return new Response(JSON.stringify({ questions: JSON.parse(match[0]) }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch {}
        
        return new Response(JSON.stringify({ questions: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "studyGuide": {
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
          result = await callOpenAI(systemPrompt, `Create a structured study guide with page references using ONLY information from this document:\n\n${content}`, 4096, 0.2);
        }
        
        try {
          const match = result.match(/\{[\s\S]*\}/);
          if (match) {
            const studyGuide = JSON.parse(match[0]);
            return new Response(JSON.stringify({ studyGuide, summary: result }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.error("Study guide JSON parse error:", e);
        }
        
        return new Response(JSON.stringify({ summary: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "videoWithSlides": {
        const docInfo = totalPages ? `${totalPages} page document` : (pageCount ? `${pageCount} page document` : 'document');
        
        const systemPrompt = `You are creating a professional video lesson that covers an ENTIRE ${docInfo}.
The content has page markers like "=== PAGE X ===" - use these to reference which slide/page to show.

CRITICAL: Your lesson MUST cover ALL major topics from the ENTIRE document, not just the first few pages.

Create a comprehensive structured lesson. Return ONLY valid JSON:
{
  "introduction": "Welcome message and overview of what we'll learn in this lesson. Mention this is a comprehensive overview of the entire document.",
  "sections": [
    {
      "title": "Section Title",
      "narration": "Detailed explanation as if you're a teacher speaking to students. Be engaging and educational. Explain concepts clearly.",
      "pageRef": 1,
      "keyPoints": ["Key point 1", "Key point 2", "Key point 3"]
    }
  ],
  "conclusion": "Summary of ALL major topics covered and encouragement"
}

REQUIREMENTS:
- Create 6-10 sections covering ALL major topics in the document
- pageRef should match the PAGE number where content is found
- Cover content from THROUGHOUT the document (beginning, middle, and end)
- Each section should be 2-3 paragraphs of engaging narration
- Make it educational and comprehensive`;
        
        result = await callOpenAI(systemPrompt, `Create a comprehensive video lesson covering this entire ${docInfo}:\n\n${content}`, 4096);
        
        try {
          const match = result.match(/\{[\s\S]*\}/);
          if (match) {
            const videoScript = JSON.parse(match[0]);
            return new Response(JSON.stringify({ videoScript }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          } 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "video": {
        // Legacy support - redirect to videoWithSlides
        const systemPrompt = `Create a comprehensive video lesson script. Return ONLY valid JSON:
{
  "introduction": "Welcome and overview",
  "sections": [{"title": "Topic", "narration": "Explanation...", "pageRef": 1, "keyPoints": ["point1"]}],
  "conclusion": "Summary"
}`;
        
        result = await callOpenAI(systemPrompt, `Create video lesson:\n\n${content}`, 4096);
        
        try {
          const match = result.match(/\{[\s\S]*\]/);
          if (match) {
            return new Response(JSON.stringify({ videoScript: JSON.parse(match[0]) }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch {}
        
        return new Response(JSON.stringify({ 
          videoScript: { introduction: "Welcome.", sections: [], conclusion: "Thank you!" } 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "interview": {
        // content is already the full prompt for interview questions
        const systemPrompt = `You are an expert interview coach helping candidates prepare for job interviews. Generate interview questions based on the provided document content.`;
        
        const temperature = body.temperature || 0.3;
        result = await callOpenAI(systemPrompt, content, 4096, temperature);
        
        return new Response(JSON.stringify({ response: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: messages,
            max_tokens: 2048,
            temperature: 0.7,
          }),
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        
        return new Response(JSON.stringify({ 
          response: data.choices?.[0]?.message?.content || "I couldn't generate a response."
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "flashcards": {
        const systemPrompt = `You are an expert educator. Generate flashcards from the provided content.
Each flashcard should have:
- term: A key concept, term, or question
- definition: A clear, concise explanation or answer
- difficulty: "easy", "medium", or "hard"

Return a JSON array of flashcards. Example format:
[
  {"term": "Photosynthesis", "definition": "The process by which plants convert light energy into chemical energy", "difficulty": "medium"},
  {"term": "What is the capital of France?", "definition": "Paris", "difficulty": "easy"}
]

Generate 10-20 high-quality flashcards covering the most important concepts.`;
        
        result = await callOpenAI(systemPrompt, `Create flashcards from this content:\n\n${content}`, 4096);
        
        try {
          const match = result.match(/\[[\s\S]*\]/);
          if (match) {
            const flashcards = JSON.parse(match[0]);
            return new Response(JSON.stringify({ flashcards }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch {}
        
        return new Response(JSON.stringify({ flashcards: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
