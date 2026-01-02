/**
 * Mode-Based Prompt Builder
 * 
 * Centralizes prompt generation for all modes with vendor awareness
 * Builds optimized prompts for: Study, Quiz, Interview, Video, Labs
 */

import { VendorId, VendorDetectionResult, AIModel, ProcessingMode } from './types';
import { VENDOR_CONFIGS } from './vendorDetector';
import { RuleEngine, createRuleEngine } from './ruleEngine';

// ============================================
// TYPES
// ============================================

// ProcessingMode is now imported from './types'
export type { ProcessingMode } from './types';

export interface PromptConfig {
  mode: ProcessingMode;
  language: 'en' | 'ar';
  vendor: VendorDetectionResult;
  contentLength: number;
  options?: ModeSpecificOptions;
}

export interface ModeSpecificOptions {
  // Quiz options
  questionCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard' | 'mixed';
  questionTypes?: ('multiple_choice' | 'true_false' | 'scenario')[];
  
  // Interview options
  interviewType?: 'technical' | 'behavioral' | 'mixed';
  experienceLevel?: 'entry' | 'mid' | 'senior';
  
  // Video options
  duration?: 'short' | 'medium' | 'long';
  style?: 'educational' | 'tutorial' | 'overview';
  
  // Labs options
  labType?: 'guided' | 'challenge' | 'troubleshooting';
  includeTopology?: boolean;
  
  // Study options
  depth?: 'overview' | 'detailed' | 'comprehensive';
  includeExamples?: boolean;
  
  // General
  includePageRefs?: boolean;
  maxOutputTokens?: number;
}

export interface GeneratedPrompt {
  systemPrompt: string;
  userPrompt: string;
  recommendedModel: AIModel;
  maxTokens: number;
  temperature: number;
}

// ============================================
// PROMPT BUILDER CLASS
// ============================================

export class PromptBuilder {
  private static instance: PromptBuilder;

  private constructor() {}

  static getInstance(): PromptBuilder {
    if (!PromptBuilder.instance) {
      PromptBuilder.instance = new PromptBuilder();
    }
    return PromptBuilder.instance;
  }

  /**
   * Build prompt for any mode
   */
  build(config: PromptConfig, content: string): GeneratedPrompt {
    const ruleEngine = createRuleEngine({
      vendorId: config.vendor.vendorId,
      mode: config.mode === 'summary' || config.mode === 'flashcards' ? 'study' : config.mode,
      language: config.language,
      preserveFormatting: true,
    });

    // Build base grounding prompt
    const groundingPrompt = ruleEngine.buildGroundedSystemPrompt();
    
    // Build mode-specific prompt
    let modePrompt: GeneratedPrompt;
    
    switch (config.mode) {
      case 'study':
        modePrompt = this.buildStudyPrompt(config, content, groundingPrompt);
        break;
      case 'quiz':
        modePrompt = this.buildQuizPrompt(config, content, groundingPrompt);
        break;
      case 'interview':
        modePrompt = this.buildInterviewPrompt(config, content, groundingPrompt);
        break;
      case 'video':
        modePrompt = this.buildVideoPrompt(config, content, groundingPrompt);
        break;
      case 'labs':
        modePrompt = this.buildLabsPrompt(config, content, groundingPrompt);
        break;
      case 'summary':
        modePrompt = this.buildSummaryPrompt(config, content, groundingPrompt);
        break;
      case 'flashcards':
        modePrompt = this.buildFlashcardsPrompt(config, content, groundingPrompt);
        break;
      default:
        modePrompt = this.buildSummaryPrompt(config, content, groundingPrompt);
    }

    return modePrompt;
  }

  // ============================================
  // STUDY MODE PROMPT
  // ============================================

  private buildStudyPrompt(
    config: PromptConfig,
    content: string,
    groundingPrompt: string
  ): GeneratedPrompt {
    const { vendor, language, options } = config;
    const depth = options?.depth || 'detailed';
    const isArabic = language === 'ar';

    const systemPrompt = `${groundingPrompt}

You are an expert educator creating a study guide${vendor.detected ? ` for ${vendor.vendorName} content` : ''}.

${isArabic ? 'OUTPUT LANGUAGE: Arabic (العربية). Use proper Arabic terminology for technical terms where standard Arabic equivalents exist.' : ''}

STUDY GUIDE REQUIREMENTS:
1. ${depth === 'overview' ? 'Provide a high-level overview' : depth === 'comprehensive' ? 'Cover every detail thoroughly' : 'Balance depth with readability'}
2. Use clear, educational language appropriate for ${vendor.detected ? vendor.vendorName + ' certification students' : 'learners'}
3. Structure content logically with clear headers
4. Highlight key terms with **bold**
5. Use code blocks for any commands/configurations
6. Include practical tips and memory aids
${vendor.detected ? `7. Emphasize ${vendor.vendorName}-specific best practices` : ''}

OUTPUT STRUCTURE:
${isArabic ? `
# 📚 [عنوان الدليل]

## نظرة عامة
[مقدمة موجزة]

## المفاهيم الأساسية
### [المفهوم 1]
- النقاط الرئيسية
- الشرح

## الإجراءات والخطوات
1. [خطوة]
2. [خطوة]

## مرجع الأوامر (إن وجد)
\`\`\`
[الأوامر]
\`\`\`

## النقاط الرئيسية للمراجعة
- ✓ [نقطة]

## أسئلة الاختبار الذاتي
1. [سؤال]
` : `
# 📚 [Study Guide Title]

## Overview
[Brief introduction]

## Core Concepts
### [Concept 1]
- Key points
- Explanation

## Procedures & Steps
1. [Step]
2. [Step]

## CLI/Command Reference (if applicable)
\`\`\`
[commands]
\`\`\`

## Key Takeaways
- ✓ [Point]

## Self-Test Questions
1. [Question]
`}`;

    const userPrompt = `Create a ${depth} study guide from this document:

${content.substring(0, 50000)}

${options?.includeExamples ? 'Include all examples from the document.' : ''}
${options?.includePageRefs ? 'Include page/section references.' : ''}`;

    return {
      systemPrompt,
      userPrompt,
      recommendedModel: vendor.detected && vendor.confidence > 0.5 ? 'gpt-4.1' : 'gpt-4o',
      maxTokens: depth === 'comprehensive' ? 8000 : depth === 'detailed' ? 5000 : 3000,
      temperature: 0.3,
    };
  }

  // ============================================
  // QUIZ MODE PROMPT
  // ============================================

  private buildQuizPrompt(
    config: PromptConfig,
    content: string,
    groundingPrompt: string
  ): GeneratedPrompt {
    const { vendor, language, options } = config;
    const questionCount = options?.questionCount || 10;
    const difficulty = options?.difficulty || 'mixed';
    const isArabic = language === 'ar';

    const systemPrompt = `${groundingPrompt}

You are an expert exam question writer${vendor.detected ? ` specializing in ${vendor.vendorName} certifications` : ''}.

${isArabic ? 'OUTPUT LANGUAGE: Arabic (العربية)' : ''}

QUIZ GENERATION RULES:
1. Generate EXACTLY ${questionCount} questions
2. Difficulty distribution: ${difficulty === 'mixed' ? 'Easy 30%, Medium 50%, Hard 20%' : `All ${difficulty}`}
3. ONLY test knowledge present in the document
4. Each question must have exactly 4 options
5. Include detailed explanations for correct answers
${vendor.detected ? `6. Use ${vendor.vendorName} exam-style question formats` : ''}
${vendor.detected && vendor.vendorId === 'cisco' ? `7. Include scenario-based and CLI output interpretation questions` : ''}

QUESTION TYPES:
- Factual recall
- Concept application
- Scenario analysis
- ${vendor.detected ? vendor.vendorName + ' CLI/configuration interpretation' : 'Technical interpretation'}

OUTPUT FORMAT (JSON):
{
  "quizTitle": "${isArabic ? 'اختبار' : 'Quiz'}: [Topic]",
  "totalQuestions": ${questionCount},
  "questions": [
    {
      "id": 1,
      "question": "${isArabic ? 'نص السؤال' : 'Question text'}",
      "type": "multiple_choice",
      "options": [
        "${isArabic ? 'الخيار أ' : 'Option A'}",
        "${isArabic ? 'الخيار ب' : 'Option B'}",
        "${isArabic ? 'الخيار ج' : 'Option C'}",
        "${isArabic ? 'الخيار د' : 'Option D'}"
      ],
      "correctAnswer": 0,
      "explanation": "${isArabic ? 'شرح لماذا هذه الإجابة صحيحة' : 'Explanation why this is correct'}",
      "difficulty": "easy|medium|hard",
      "topic": "Topic name"
    }
  ]
}`;

    const userPrompt = `Generate ${questionCount} quiz questions from this document:

${content.substring(0, 40000)}

Requirements:
- Difficulty: ${difficulty}
- Question types: Multiple choice
- Include explanations for all answers`;

    return {
      systemPrompt,
      userPrompt,
      recommendedModel: vendor.detected ? 'gpt-4.1' : 'gpt-4o-mini',
      maxTokens: questionCount * 500,
      temperature: 0.5,
    };
  }

  // ============================================
  // INTERVIEW MODE PROMPT
  // ============================================

  private buildInterviewPrompt(
    config: PromptConfig,
    content: string,
    groundingPrompt: string
  ): GeneratedPrompt {
    const { vendor, language, options } = config;
    const interviewType = options?.interviewType || 'mixed';
    const experienceLevel = options?.experienceLevel || 'mid';
    const isArabic = language === 'ar';

    const systemPrompt = `${groundingPrompt}

You are an expert technical interviewer${vendor.detected ? ` for ${vendor.vendorName} positions` : ''}.

${isArabic ? 'OUTPUT LANGUAGE: Arabic (العربية)' : ''}

INTERVIEW QUESTION REQUIREMENTS:
1. Generate questions appropriate for ${experienceLevel}-level candidates
2. Focus on ${interviewType === 'mixed' ? 'both technical and behavioral aspects' : interviewType + ' aspects'}
3. Base questions on document content
4. Include follow-up questions to probe deeper
5. Provide ideal answer key points
${vendor.detected ? `6. Include ${vendor.vendorName}-specific scenarios` : ''}

EXPERIENCE LEVEL GUIDELINES:
- Entry: Conceptual understanding, basic terminology
- Mid: Practical application, troubleshooting, design decisions
- Senior: Architecture, optimization, leadership, mentoring

OUTPUT FORMAT:
${isArabic ? `
## أسئلة المقابلة

### السؤال 1: [نص السؤال]
**النوع:** تقني / سلوكي / سيناريو
**المستوى:** ${experienceLevel}
**النقاط الرئيسية للإجابة:**
- [نقطة]

**نموذج إجابة:**
[إجابة مفصلة]

**أسئلة المتابعة:**
1. [سؤال]
2. [سؤال]
` : `
## Interview Questions

### Question 1: [Question text]
**Type:** Technical / Behavioral / Scenario
**Level:** ${experienceLevel}
**Key Answer Points:**
- [Point]

**Sample Answer:**
[Detailed response]

**Follow-up Questions:**
1. [Question]
2. [Question]
`}`;

    const userPrompt = `Generate interview questions based on this document:

${content.substring(0, 35000)}

Requirements:
- Experience level: ${experienceLevel}
- Type: ${interviewType}
- Include 8-10 questions with follow-ups`;

    return {
      systemPrompt,
      userPrompt,
      recommendedModel: 'gpt-4o',
      maxTokens: 6000,
      temperature: 0.6,
    };
  }

  // ============================================
  // VIDEO MODE PROMPT
  // ============================================

  private buildVideoPrompt(
    config: PromptConfig,
    content: string,
    groundingPrompt: string
  ): GeneratedPrompt {
    const { vendor, language, options } = config;
    const duration = options?.duration || 'medium';
    const style = options?.style || 'educational';
    const isArabic = language === 'ar';

    const durationMinutes = duration === 'short' ? '3-5' : duration === 'long' ? '15-20' : '8-12';

    const systemPrompt = `${groundingPrompt}

You are a professional video script writer creating ${style} content${vendor.detected ? ` about ${vendor.vendorName} technology` : ''}.

${isArabic ? 'OUTPUT LANGUAGE: Arabic (العربية). Write narration in natural spoken Arabic.' : ''}

VIDEO SCRIPT REQUIREMENTS:
1. Target duration: ${durationMinutes} minutes
2. Style: ${style} - ${style === 'educational' ? 'Clear explanations with visual cues' : style === 'tutorial' ? 'Step-by-step walkthrough' : 'High-level overview'}
3. Include timestamps for each section
4. Provide visual directions for each scene
5. Write conversational narration
${vendor.detected ? `6. Include ${vendor.vendorName} branding suggestions` : ''}

OUTPUT FORMAT:
${isArabic ? `
# 🎬 سيناريو الفيديو: [العنوان]

## معلومات عامة
- **المدة:** ${durationMinutes} دقائق
- **النمط:** ${style}
- **الجمهور المستهدف:** [الجمهور]

## المقدمة (0:00 - 0:30)
**المشهد:** [وصف المرئيات]
**السرد:** "[نص الكلام]"
**نص على الشاشة:** [النص]

## القسم 1: [العنوان] (0:30 - X:XX)
**المشهد:** [المرئيات]
**السرد:** "[الكلام]"
**النقاط الرئيسية:** [للرسومات]
**انتقال:** [نوع الانتقال]
` : `
# 🎬 Video Script: [Title]

## Overview
- **Duration:** ${durationMinutes} minutes
- **Style:** ${style}
- **Target audience:** [Audience]

## Introduction (0:00 - 0:30)
**Scene:** [Visual description]
**Narration:** "[Spoken text]"
**On-screen text:** [Text to display]

## Section 1: [Title] (0:30 - X:XX)
**Scene:** [Visuals]
**Narration:** "[Spoken text]"
**Key points:** [For graphics]
**Transition:** [Transition type]

## Section 2: [Title] (X:XX - X:XX)
[Continue...]

## Conclusion (X:XX - X:XX)
**Scene:** [Closing visuals]
**Narration:** "[Summary and call-to-action]"
**End screen:** [Final display]

## Production Notes
- Music suggestions
- Animation requirements
- B-roll needs
`}`;

    const userPrompt = `Create a ${duration} ${style} video script from this document:

${content.substring(0, 30000)}

Requirements:
- Duration: ${durationMinutes} minutes
- Include visual directions
- Write engaging narration`;

    return {
      systemPrompt,
      userPrompt,
      recommendedModel: 'gpt-4o',
      maxTokens: duration === 'long' ? 8000 : duration === 'short' ? 3000 : 5000,
      temperature: 0.7,
    };
  }

  // ============================================
  // LABS MODE PROMPT
  // ============================================

  private buildLabsPrompt(
    config: PromptConfig,
    content: string,
    groundingPrompt: string
  ): GeneratedPrompt {
    const { vendor, language, options } = config;
    const labType = options?.labType || 'guided';
    const includeTopology = options?.includeTopology !== false;
    const isArabic = language === 'ar';

    const systemPrompt = `${groundingPrompt}

You are an expert lab instructor${vendor.detected ? ` creating ${vendor.vendorName} hands-on exercises` : ''}.

${isArabic ? 'OUTPUT LANGUAGE: Arabic (العربية)' : ''}

LAB EXERCISE REQUIREMENTS:
1. Type: ${labType} - ${labType === 'guided' ? 'Step-by-step with detailed instructions' : labType === 'challenge' ? 'Objectives only, students find solution' : 'Given broken scenario to fix'}
2. ${vendor.detected ? `Use ${vendor.vendorName} CLI syntax exactly` : 'Use appropriate CLI syntax'}
3. Include verification commands after each step
4. Show expected outputs
5. Add troubleshooting section
${includeTopology ? '6. Include topology description/diagram instructions' : ''}

${vendor.detected && vendor.vendorId === 'cisco' ? `
CISCO LAB STANDARDS:
- Use standard IOS prompts (Router#, Switch>, etc.)
- Include full command syntax
- Show both configuration and verification commands
- Use meaningful device names (R1, SW1, etc.)
` : ''}

OUTPUT FORMAT:
${isArabic ? `
# 🧪 تمرين عملي: [العنوان]

## المعلومات العامة
- **المدة:** [الوقت المقدر]
- **المستوى:** [مبتدئ/متوسط/متقدم]
- **المتطلبات المسبقة:** [المتطلبات]

## الأهداف
بعد إكمال هذا التمرين، ستكون قادراً على:
1. [هدف]

## ${includeTopology ? 'مخطط الشبكة' : 'بيئة التمرين'}
[الوصف]

## الخطوات

### الخطوة 1: [العنوان]
**المهمة:** [ما يجب فعله]
**الأوامر:**
\`\`\`
[الأوامر]
\`\`\`
**المخرج المتوقع:**
\`\`\`
[المخرج]
\`\`\`
**التحقق:** [أمر التحقق]

## استكشاف الأخطاء
| المشكلة | السبب | الحل |
|---------|-------|------|

## قائمة التحقق النهائية
- [ ] [نقطة تحقق]
` : `
# 🧪 Lab Exercise: [Title]

## Lab Information
- **Duration:** [Estimated time]
- **Difficulty:** [Beginner/Intermediate/Advanced]
- **Prerequisites:** [Requirements]

## Objectives
Upon completion, you will be able to:
1. [Objective]

## ${includeTopology ? 'Network Topology' : 'Lab Environment'}
[Description]

## Instructions

### Step 1: [Title]
**Task:** [What to do]
**Commands:**
\`\`\`
[Commands]
\`\`\`
**Expected Output:**
\`\`\`
[Output]
\`\`\`
**Verify:** [Verification command]

### Step 2: [Title]
[Continue...]

## Troubleshooting
| Issue | Cause | Solution |
|-------|-------|----------|

## Final Verification Checklist
- [ ] [Checkpoint]

## Challenge Tasks (Optional)
1. [Extra challenge]
`}`;

    const userPrompt = `Create a ${labType} lab exercise from this document:

${content.substring(0, 40000)}

Requirements:
- Lab type: ${labType}
${includeTopology ? '- Include topology' : ''}
- Include verification for each step
- Add troubleshooting section`;

    return {
      systemPrompt,
      userPrompt,
      recommendedModel: vendor.detected && ['cisco', 'juniper', 'paloalto'].includes(vendor.vendorId) 
        ? 'gpt-5.2' 
        : 'gpt-4.1',
      maxTokens: 8000,
      temperature: 0.3,
    };
  }

  // ============================================
  // SUMMARY MODE PROMPT
  // ============================================

  private buildSummaryPrompt(
    config: PromptConfig,
    content: string,
    groundingPrompt: string
  ): GeneratedPrompt {
    const { vendor, language, options } = config;
    const isArabic = language === 'ar';

    const systemPrompt = `${groundingPrompt}

You are an expert document summarizer${vendor.detected ? ` with expertise in ${vendor.vendorName}` : ''}.

${isArabic ? 'OUTPUT LANGUAGE: Arabic (العربية)' : ''}

SUMMARY REQUIREMENTS:
1. Capture all key information
2. Maintain technical accuracy
3. Preserve important details and numbers
4. Organize logically
${vendor.detected ? `5. Highlight ${vendor.vendorName}-specific concepts` : ''}

OUTPUT FORMAT:
${isArabic ? `
# 📋 ملخص المستند

## نظرة عامة
[ملخص موجز في 2-3 جمل]

## النقاط الرئيسية
1. [نقطة]
2. [نقطة]

## الملخص التفصيلي
### [القسم 1]
[ملخص]

## المصطلحات المهمة
| المصطلح | التعريف |
|---------|---------|

## الخلاصة
[النقاط النهائية]
` : `
# 📋 Document Summary

## Overview
[2-3 sentence summary]

## Key Points
1. [Point]
2. [Point]

## Detailed Summary
### [Section 1]
[Summary]

## Important Terms
| Term | Definition |
|------|------------|

## Conclusions
[Final takeaways]
`}`;

    const userPrompt = `Summarize this document:

${content.substring(0, 50000)}

${options?.includePageRefs ? 'Include page/section references.' : ''}`;

    return {
      systemPrompt,
      userPrompt,
      recommendedModel: 'gpt-4o-mini',
      maxTokens: 4000,
      temperature: 0.3,
    };
  }

  // ============================================
  // FLASHCARDS MODE PROMPT
  // ============================================

  private buildFlashcardsPrompt(
    config: PromptConfig,
    content: string,
    groundingPrompt: string
  ): GeneratedPrompt {
    const { vendor, language } = config;
    const isArabic = language === 'ar';

    const systemPrompt = `${groundingPrompt}

You are creating flashcards for effective memorization${vendor.detected ? ` of ${vendor.vendorName} concepts` : ''}.

${isArabic ? 'OUTPUT LANGUAGE: Arabic (العربية)' : ''}

FLASHCARD REQUIREMENTS:
1. One concept per card
2. Front: Question or term
3. Back: Concise answer or definition
4. Include memory aids where helpful
${vendor.detected ? `5. Include ${vendor.vendorName} CLI commands as separate cards` : ''}

OUTPUT FORMAT (JSON):
{
  "flashcards": [
    {
      "id": 1,
      "front": "${isArabic ? 'السؤال أو المصطلح' : 'Question or term'}",
      "back": "${isArabic ? 'الإجابة أو التعريف' : 'Answer or definition'}",
      "category": "Category name",
      "difficulty": "easy|medium|hard"
    }
  ]
}`;

    const userPrompt = `Create flashcards from this document:

${content.substring(0, 40000)}

Generate 20-30 flashcards covering key concepts, terms, and procedures.`;

    return {
      systemPrompt,
      userPrompt,
      recommendedModel: 'gpt-4o-mini',
      maxTokens: 4000,
      temperature: 0.4,
    };
  }
}

// Export singleton
export const promptBuilder = PromptBuilder.getInstance();
