/**
 * Multi-Pass AI Processor (Step 8: Modular AI & Future Proofing)
 * 
 * ARCHITECTURE OVERVIEW:
 * This module implements a sophisticated multi-pass processing pipeline
 * that ensures accuracy and prevents hallucinations through validation.
 * 
 * PROCESSING PIPELINE:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                        DOCUMENT INPUT                                │
 * └─────────────────────────────────┬───────────────────────────────────┘
 *                                   │
 *                                   ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  PASS 1: EXTRACTION                                                  │
 * │  - Extract facts, terms, procedures                                  │
 * │  - NO interpretation, only source facts                              │
 * │  - Vendor-aware terminology preservation                             │
 * └─────────────────────────────────┬───────────────────────────────────┘
 *                                   │
 *                                   ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  PASS 2: ENRICHMENT                                                  │
 * │  - Format tables, code blocks, diagrams                              │
 * │  - Structure content properly                                        │
 * │  - NO new information added                                          │
 * └─────────────────────────────────┬───────────────────────────────────┘
 *                                   │
 *                                   ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  PASS 3: VALIDATION (Hallucination Prevention)                       │
 * │  - Source grounding check                                            │
 * │  - Factual accuracy verification                                     │
 * │  - CLI syntax validation                                             │
 * │  - Vendor terminology check                                          │
 * └─────────────────────────────────┬───────────────────────────────────┘
 *                                   │
 *                                   ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  PASS 4: FORMATTING                                                  │
 * │  - Apply mode-specific structure                                     │
 * │  - Final quality polish                                              │
 * │  - Language-specific output                                          │
 * └─────────────────────────────────┬───────────────────────────────────┘
 *                                   │
 *                                   ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  SUPABASE PERSISTENCE                                                │
 * │  - Store in document_analysis table                                  │
 * │  - Store in ai_summaries table                                       │
 * │  - Update metadata for analytics                                     │
 * └─────────────────────────────────────────────────────────────────────┘
 * 
 * HALLUCINATION PREVENTION:
 * 1. Pass 1 extracts ONLY source facts (no AI "knowledge")
 * 2. Pass 2 structures without adding information
 * 3. Pass 3 validates against source with ValidationLayer
 * 4. Low validation scores trigger re-processing or warnings
 * 
 * EXTENDING THE PIPELINE:
 * - Add new pass definitions to PASS_DEFINITIONS array
 * - Each pass receives previous results via context
 * - Passes can be skipped based on options
 */

import { VendorId, AIModel, AIProvider, VendorDetectionResult, ProcessingMode, DocumentAnalysisRecord, AISummaryRecord, PipelineState } from './types';
import { RuleEngine, createRuleEngine, ValidationResult } from './ruleEngine';
import { AIModelRouter, modelRouter } from './modelRouter';
import { vendorDetector } from './vendorDetector';
import { ValidationLayer, ValidationReport } from './validationLayer';

// ============================================
// TYPES
// ============================================

export interface ProcessingPass {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: Date;
  endTime?: Date;
  result?: string;
  error?: string;
  validationScore?: number;
}

export interface MultiPassResult {
  success: boolean;
  passes: ProcessingPass[];
  finalOutput: string;
  validation: ValidationResult;
  validationReport?: ValidationReport;
  metadata: ProcessingMetadata;
  /** Database record ID if persisted to Supabase */
  recordId?: string;
}

export interface ProcessingMetadata {
  totalTime: number;
  tokensUsed: number;
  modelUsed: AIModel;
  providerUsed: AIProvider;
  vendor: VendorDetectionResult;
  passCount: number;
  validationScore: number;
  fallbacksUsed: AIModel[];
}

export interface ProcessingOptions {
  mode: ProcessingMode;
  language: 'en' | 'ar';
  skipValidation?: boolean;
  maxPasses?: number;
  onProgress?: (pass: number, total: number, message: string) => void;
  /** Enable Supabase persistence */
  persistToDatabase?: boolean;
  /** Document ID for Supabase relation */
  documentId?: string;
  /** User ID for ownership */
  userId?: string;
  /** Minimum validation score to accept (0-100) */
  minValidationScore?: number;
}

// ============================================
// SUPABASE PERSISTENCE HELPER
// ============================================

/**
 * Persist processing results to Supabase
 * 
 * This is a placeholder that will be implemented when
 * Supabase client is available in the context.
 * 
 * @param result - The processing result to persist
 * @param options - Processing options with IDs
 * @returns Record ID if successful
 */
async function persistToSupabase(
  result: MultiPassResult,
  options: ProcessingOptions
): Promise<string | undefined> {
  // PLACEHOLDER: Implement when Supabase client is injected
  // 
  // Implementation would:
  // 1. Insert document_analysis record
  // 2. Insert ai_summaries record
  // 3. Return the record ID
  //
  // Example:
  // const analysisRecord: DocumentAnalysisRecord = {
  //   id: generateUUID(),
  //   documentId: options.documentId!,
  //   userId: options.userId!,
  //   vendorId: result.metadata.vendor.vendorId,
  //   vendorConfidence: result.metadata.vendor.confidence,
  //   modelUsed: result.metadata.modelUsed,
  //   providerUsed: result.metadata.providerUsed,
  //   processingMode: options.mode,
  //   tokensUsed: result.metadata.tokensUsed,
  //   processingTimeMs: result.metadata.totalTime,
  //   validationScore: result.metadata.validationScore,
  //   passCount: result.metadata.passCount,
  //   createdAt: new Date(),
  //   metadata: {},
  // };
  //
  // const { data, error } = await supabase
  //   .from('document_analysis')
  //   .insert(analysisRecord)
  //   .select('id')
  //   .single();
  
  console.log('[MultiPassProcessor] Supabase persistence placeholder - implement with supabase client');
  return undefined;
}

// ============================================
// PASS DEFINITIONS
// ============================================

interface PassDefinition {
  name: string;
  description: string;
  execute: (
    input: string,
    context: PassContext,
    apiCall: ApiCallFunction
  ) => Promise<string>;
}

interface PassContext {
  originalContent: string;
  vendor: VendorDetectionResult;
  mode: ProcessingOptions['mode'];
  language: ProcessingOptions['language'];
  model: AIModel;
  ruleEngine: RuleEngine;
  previousPassResults: Map<string, string>;
  /** Validation layer for hallucination checks */
  validationLayer: ValidationLayer;
}

type ApiCallFunction = (
  systemPrompt: string,
  userPrompt: string,
  model: AIModel
) => Promise<string>;

// ============================================
// PASS 1: EXTRACTION SUMMARY
// ============================================

const pass1Extraction: PassDefinition = {
  name: 'Extraction',
  description: 'Extract facts and key information from document',
  execute: async (input, context, apiCall) => {
    const systemPrompt = `You are a precise document analyzer. Your task is to extract ONLY factual information from the document.

RULES:
1. Extract ONLY facts explicitly stated in the document
2. Do NOT add interpretations, opinions, or external knowledge
3. Preserve exact terminology, numbers, and technical terms
4. Maintain original structure where possible
5. Flag any ambiguous or unclear sections

${context.vendor.detected ? `VENDOR: ${context.vendor.vendorName}
- Preserve all ${context.vendor.vendorName}-specific terminology
- Keep technical accuracy for ${context.vendor.vendorName} products/concepts` : ''}

OUTPUT FORMAT:
## Key Facts
- [Fact 1]
- [Fact 2]
...

## Technical Details
- [Detail 1]
- [Detail 2]
...

## Definitions
- [Term]: [Definition from document]
...

## Procedures/Steps
1. [Step from document]
2. [Step from document]
...

## Uncertain/Ambiguous
- [Any unclear sections that need verification]`;

    const userPrompt = `Extract all factual information from this document. Only include information explicitly stated:

${input.substring(0, 50000)}`;

    return apiCall(systemPrompt, userPrompt, context.model);
  },
};

// ============================================
// PASS 2: ENRICHMENT
// ============================================

const pass2Enrichment: PassDefinition = {
  name: 'Enrichment',
  description: 'Enrich with tables, diagrams descriptions, and examples',
  execute: async (input, context, apiCall) => {
    const extractedFacts = context.previousPassResults.get('Extraction') || '';
    
    const systemPrompt = `You are a document enrichment specialist. Your task is to identify and format structured content.

RULES:
1. Only format content that EXISTS in the document
2. Identify and properly format:
   - Tables (convert to markdown tables)
   - Lists and bullet points
   - Code blocks and CLI commands
   - Diagrams (describe what they show)
   - Examples and scenarios
3. Do NOT create new examples - only format existing ones
4. Preserve all technical accuracy

${context.vendor.detected ? `VENDOR: ${context.vendor.vendorName}
- Format CLI commands with proper syntax highlighting
- Preserve configuration blocks exactly
- Identify ${context.vendor.vendorName}-specific diagrams/architectures` : ''}

OUTPUT FORMAT:
## Tables Found
[Formatted markdown tables]

## CLI/Code Blocks
\`\`\`
[Preserved code]
\`\`\`

## Diagrams & Visuals
[Description of each diagram with what it shows]

## Examples
[Formatted examples from the document]

## Structured Lists
[Properly formatted lists]`;

    const userPrompt = `Using the extracted facts below, identify and format all structured content (tables, code, diagrams, examples).

EXTRACTED FACTS:
${extractedFacts}

ORIGINAL DOCUMENT:
${input.substring(0, 30000)}`;

    return apiCall(systemPrompt, userPrompt, context.model);
  },
};

// ============================================
// PASS 3: VALIDATION
// ============================================

const pass3Validation: PassDefinition = {
  name: 'Validation',
  description: 'Validate accuracy, check vendor compliance, ensure consistency',
  execute: async (input, context, apiCall) => {
    const extractedFacts = context.previousPassResults.get('Extraction') || '';
    const enrichedContent = context.previousPassResults.get('Enrichment') || '';
    
    const systemPrompt = `You are a technical accuracy validator. Your task is to verify the extracted content against the source.

VALIDATION CHECKLIST:
1. FACTUAL ACCURACY
   - Verify all numbers, versions, and metrics match the source
   - Check technical terms are used correctly
   - Ensure no information was added that isn't in the source

2. VENDOR COMPLIANCE (${context.vendor.vendorName})
   - Verify CLI syntax is correct for ${context.vendor.vendorName}
   - Check terminology matches ${context.vendor.vendorName} standards
   - Validate configuration format

3. LOGICAL CONSISTENCY
   - Check for contradictions between sections
   - Verify procedures are complete (no missing steps)
   - Ensure cause-effect relationships are preserved

4. COMPLETENESS
   - Flag any important content that may have been missed
   - Note any sections that need more detail

OUTPUT FORMAT:
## Validation Report

### Accuracy Score: [X/10]

### Issues Found:
- [Issue 1]: [Description] - [Severity: High/Medium/Low]
- [Issue 2]: [Description] - [Severity: High/Medium/Low]

### Corrections Needed:
- [Original]: "..." → [Corrected]: "..."

### Missing Content:
- [Content that should be included]

### Verified Sections:
✓ [Section that passed validation]
✓ [Section that passed validation]

### Final Assessment:
[Summary of validation results]`;

    const userPrompt = `Validate the extracted and enriched content against the original document.

ORIGINAL DOCUMENT:
${input.substring(0, 20000)}

EXTRACTED FACTS:
${extractedFacts.substring(0, 15000)}

ENRICHED CONTENT:
${enrichedContent.substring(0, 15000)}

Perform thorough validation and report any discrepancies.`;

    return apiCall(systemPrompt, userPrompt, context.model);
  },
};

// ============================================
// PASS 4: FINAL FORMATTING
// ============================================

const pass4Formatting: PassDefinition = {
  name: 'Formatting',
  description: 'Apply mode-specific formatting for final output',
  execute: async (input, context, apiCall) => {
    const extractedFacts = context.previousPassResults.get('Extraction') || '';
    const enrichedContent = context.previousPassResults.get('Enrichment') || '';
    const validationReport = context.previousPassResults.get('Validation') || '';
    
    // Get mode-specific instructions
    const modeInstructions = getModeFormattingInstructions(context.mode, context.language);
    
    // Get vendor-specific grounding rules
    const groundingRules = context.ruleEngine.buildGroundedSystemPrompt();
    
    const systemPrompt = `You are a professional content formatter. Create the final ${context.mode} output.

${groundingRules}

${modeInstructions}

QUALITY REQUIREMENTS:
1. Apply corrections from the validation report
2. Use proper markdown formatting
3. Maintain all technical accuracy
4. Structure for optimal readability
5. Include page/section references where available

${context.language === 'ar' ? 'OUTPUT LANGUAGE: Arabic (العربية)\nUse right-to-left formatting conventions.' : 'OUTPUT LANGUAGE: English'}`;

    const userPrompt = `Create the final ${context.mode} output using the validated content.

VALIDATED CONTENT:
${extractedFacts.substring(0, 20000)}

ENRICHED CONTENT:
${enrichedContent.substring(0, 15000)}

VALIDATION NOTES:
${validationReport.substring(0, 5000)}

Generate a complete, well-formatted ${context.mode} output.`;

    return apiCall(systemPrompt, userPrompt, context.model);
  },
};

// ============================================
// MODE FORMATTING INSTRUCTIONS
// ============================================

function getModeFormattingInstructions(
  mode: ProcessingOptions['mode'],
  language: ProcessingOptions['language']
): string {
  const instructions: Record<ProcessingOptions['mode'], { en: string; ar: string }> = {
    study: {
      en: `OUTPUT FORMAT: Study Guide

## Structure:
1. **Overview** - Brief introduction to the topic
2. **Key Concepts** - Main ideas with explanations
3. **Detailed Sections** - In-depth coverage of each topic
   - Use headers (##, ###) for organization
   - Include bullet points for key facts
   - Add numbered steps for procedures
4. **CLI Reference** (if applicable) - All commands in code blocks
5. **Key Takeaways** - Summary of important points
6. **Review Questions** - Self-test questions based on content

## Formatting:
- Use **bold** for key terms
- Use \`code\` for technical values
- Use > for important notes
- Include ✓ checkmarks for best practices`,

      ar: `تنسيق الإخراج: دليل الدراسة

## الهيكل:
1. **نظرة عامة** - مقدمة موجزة عن الموضوع
2. **المفاهيم الرئيسية** - الأفكار الرئيسية مع الشرح
3. **الأقسام التفصيلية** - تغطية متعمقة لكل موضوع
4. **مرجع الأوامر** (إن وجد) - جميع الأوامر في كتل التعليمات البرمجية
5. **النقاط الرئيسية** - ملخص النقاط المهمة
6. **أسئلة المراجعة** - أسئلة الاختبار الذاتي`,
    },

    quiz: {
      en: `OUTPUT FORMAT: Quiz Questions

Generate questions in this JSON structure:
{
  "questions": [
    {
      "id": 1,
      "question": "Question text",
      "type": "multiple_choice",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "explanation": "Why this is correct",
      "difficulty": "easy|medium|hard",
      "topic": "Topic name",
      "pageRef": "Page/section reference"
    }
  ]
}

QUESTION TYPES:
- multiple_choice: 4 options
- true_false: True/False
- scenario: Real-world scenario with question

DIFFICULTY DISTRIBUTION:
- Easy: 30%
- Medium: 50%
- Hard: 20%`,

      ar: `تنسيق الإخراج: أسئلة الاختبار

أنشئ الأسئلة بتنسيق JSON التالي:
{
  "questions": [...]
}`,
    },

    interview: {
      en: `OUTPUT FORMAT: Interview Questions

## Structure for Each Question:
### Question [N]: [Question Text]
**Type:** Technical / Behavioral / Scenario
**Difficulty:** Entry / Mid / Senior
**Expected Answer:**
[Key points the interviewer looks for]

**Sample Answer:**
[Well-structured response]

**Follow-up Questions:**
1. [Follow-up 1]
2. [Follow-up 2]

**Red Flags:**
- [What would indicate a weak answer]

## Categories:
- Conceptual Understanding
- Practical Application
- Problem-Solving
- Best Practices`,

      ar: `تنسيق الإخراج: أسئلة المقابلة

## هيكل كل سؤال:
### السؤال [N]: [نص السؤال]
**النوع:** تقني / سلوكي / سيناريو
**الصعوبة:** مبتدئ / متوسط / متقدم`,
    },

    video: {
      en: `OUTPUT FORMAT: Video Script

## Video Structure:
### Introduction (0:00-0:30)
**Visual:** [Description of opening visual]
**Narration:** [Opening script]
**On-screen text:** [Key text to display]

### Section 1: [Title] (0:30-2:00)
**Visual:** [What to show]
**Narration:** [Script for narrator]
**Key Points:** [Bullet points for graphics]
**Animation:** [Any animation instructions]

### [Continue for each section...]

### Conclusion (X:XX-X:XX)
**Visual:** [Closing visual]
**Narration:** [Summary and call-to-action]
**End screen:** [What to display]

## Production Notes:
- Total duration estimate
- Tone: [Professional/Casual/Academic]
- Pace: [Slow/Medium/Fast]`,

      ar: `تنسيق الإخراج: نص الفيديو

## هيكل الفيديو:
### المقدمة (0:00-0:30)
**المرئيات:** [وصف المرئيات الافتتاحية]
**السرد:** [نص الافتتاحية]`,
    },

    labs: {
      en: `OUTPUT FORMAT: Lab Exercise

## Lab Overview
**Title:** [Lab Name]
**Duration:** [Estimated time]
**Difficulty:** [Beginner/Intermediate/Advanced]
**Prerequisites:** [Required knowledge/setup]

## Objectives
By the end of this lab, you will be able to:
1. [Objective 1]
2. [Objective 2]
3. [Objective 3]

## Lab Topology/Setup
[Describe the environment]

## Step-by-Step Instructions

### Step 1: [Title]
**Task:** [What to do]
**Commands:**
\`\`\`
[Commands to execute]
\`\`\`
**Expected Output:**
\`\`\`
[What you should see]
\`\`\`
**Verification:**
[How to verify success]

### Step 2: [Continue...]

## Troubleshooting
| Issue | Cause | Solution |
|-------|-------|----------|
| [Issue] | [Why] | [Fix] |

## Validation Checklist
- [ ] [Check 1]
- [ ] [Check 2]

## Challenge Tasks (Optional)
1. [Extra challenge]`,

      ar: `تنسيق الإخراج: تمرين عملي

## نظرة عامة على التمرين
**العنوان:** [اسم التمرين]
**المدة:** [الوقت المقدر]
**الصعوبة:** [مبتدئ/متوسط/متقدم]`,
    },

    summary: {
      en: `OUTPUT FORMAT: Document Summary

## Executive Summary
[2-3 sentence overview]

## Key Points
1. [Main point 1]
2. [Main point 2]
3. [Main point 3]

## Detailed Summary
### [Section 1 Title]
[Summary of section]

### [Section 2 Title]
[Summary of section]

## Important Terms
| Term | Definition |
|------|------------|
| [Term] | [Definition] |

## Conclusions
[Final takeaways]`,

      ar: `تنسيق الإخراج: ملخص المستند

## الملخص التنفيذي
[نظرة عامة في 2-3 جمل]`,
    },

    flashcards: {
      en: `OUTPUT FORMAT: Flashcard Set

## Flashcard Format
Return a JSON object with the following structure:
{
  "flashcards": [
    {
      "front": "[Question or term]",
      "back": "[Answer or definition]",
      "category": "[Topic category]",
      "difficulty": "[easy|medium|hard]"
    }
  ]
}

## Guidelines:
- Create 15-25 flashcards covering key concepts
- Front should be concise questions or terms
- Back should be clear, memorable answers
- Include CLI commands for technical content
- Vary difficulty levels
- Group by topic/category`,

      ar: `تنسيق الإخراج: مجموعة البطاقات التعليمية

## تنسيق البطاقة
أرجع كائن JSON بالهيكل التالي:
{
  "flashcards": [
    {
      "front": "[السؤال أو المصطلح]",
      "back": "[الإجابة أو التعريف]"
    }
  ]
}`,
    },
  };

  return instructions[mode][language];
}

// ============================================
// MULTI-PASS PROCESSOR CLASS
// ============================================

export class MultiPassProcessor {
  private passes: PassDefinition[];
  private apiCallFn: ApiCallFunction;
  private validationLayer: ValidationLayer;

  constructor(apiCallFn: ApiCallFunction) {
    this.apiCallFn = apiCallFn;
    this.validationLayer = new ValidationLayer();
    this.passes = [
      pass1Extraction,
      pass2Enrichment,
      pass3Validation,
      pass4Formatting,
    ];
  }

  /**
   * Process document through all passes
   * 
   * PIPELINE FLOW:
   * 1. Detect vendor to customize processing
   * 2. Select optimal AI model via router
   * 3. Execute each pass sequentially
   * 4. Validate final output with ValidationLayer
   * 5. Persist to Supabase if enabled
   * 
   * HALLUCINATION PREVENTION:
   * - Each pass builds on verified facts from previous pass
   * - ValidationLayer checks source grounding
   * - Low scores can trigger re-processing
   * 
   * @param content - Document text to process
   * @param options - Processing configuration
   * @returns MultiPassResult with output and metadata
   */
  async process(
    content: string,
    options: ProcessingOptions
  ): Promise<MultiPassResult> {
    const startTime = Date.now();
    const passResults: ProcessingPass[] = [];
    const previousPassResults = new Map<string, string>();
    let tokensUsed = 0;
    const fallbacksUsed: AIModel[] = [];

    // STEP 1: Detect vendor for specialized handling
    const vendor = vendorDetector.detect(content);
    console.log(`[MultiPassProcessor] Vendor detected: ${vendor.vendorName} (${(vendor.confidence * 100).toFixed(1)}%)`);

    // STEP 2: Select optimal model via router
    const routingContext = modelRouter.buildRoutingContext(content, vendor, options.mode);
    const modelDecision = modelRouter.selectModel(routingContext);
    console.log(`[MultiPassProcessor] Model selected: ${modelDecision.model} (${modelDecision.provider})`);
    console.log(`[MultiPassProcessor] Reason: ${modelDecision.reason}`);
    console.log(`[MultiPassProcessor] Fallbacks: ${modelDecision.fallbackModels.join(', ') || 'none'}`);

    // STEP 3: Create rule engine for grounding
    const ruleEngine = createRuleEngine({
      vendorId: vendor.vendorId,
      mode: options.mode,
      language: options.language,
      preserveFormatting: true,
    });

    // Build processing context
    const context: PassContext = {
      originalContent: content,
      vendor,
      mode: options.mode,
      language: options.language,
      model: modelDecision.model,
      ruleEngine,
      previousPassResults,
      validationLayer: this.validationLayer,
    };

    // STEP 4: Determine which passes to run
    const passesToRun = options.skipValidation
      ? this.passes.filter(p => p.name !== 'Validation')
      : this.passes.slice(0, options.maxPasses || 4);

    // STEP 5: Execute passes sequentially
    for (let i = 0; i < passesToRun.length; i++) {
      const pass = passesToRun[i];
      const passRecord: ProcessingPass = {
        name: pass.name,
        status: 'running',
        startTime: new Date(),
      };

      if (options.onProgress) {
        options.onProgress(i + 1, passesToRun.length, `Running ${pass.name}...`);
      }

      try {
        const result = await this.executeWithFallback(
          pass,
          content,
          context,
          modelDecision.fallbackModels,
          fallbacksUsed
        );
        
        passRecord.status = 'completed';
        passRecord.endTime = new Date();
        passRecord.result = result;
        previousPassResults.set(pass.name, result);
        
        // Token estimation
        tokensUsed += Math.ceil(result.length / 4);
        
        // INTERMEDIATE VALIDATION: Check extraction quality
        if (pass.name === 'Extraction') {
          const quickCheck = this.validationLayer.quickValidate(result, content);
          passRecord.validationScore = quickCheck.score;
          if (quickCheck.score < 50) {
            console.warn(`[MultiPassProcessor] Low extraction quality: ${quickCheck.score}%`);
          }
        }
      } catch (error: any) {
        passRecord.status = 'failed';
        passRecord.endTime = new Date();
        passRecord.error = error.message || 'Unknown error';
        passResults.push(passRecord);
        
        // Critical failure on extraction
        if (pass.name === 'Extraction') {
          return this.buildFailureResult(passResults, startTime, tokensUsed, modelDecision, vendor, fallbacksUsed, i + 1);
        }
      }

      passResults.push(passRecord);
    }

    // STEP 6: Get final output
    const finalOutput = previousPassResults.get('Formatting') || 
                       previousPassResults.get('Enrichment') ||
                       previousPassResults.get('Extraction') || '';

    // STEP 7: Run comprehensive validation (Hallucination Prevention)
    const validation = ruleEngine.validateContent(
      finalOutput,
      content,
      vendor.vendorId
    );
    
    // Additional validation with ValidationLayer
    const validationReport = this.validationLayer.validate(finalOutput, content, vendor);
    console.log(`[MultiPassProcessor] Validation score: ${validationReport.overallScore.toFixed(1)}%`);
    
    // Check minimum validation score
    const minScore = options.minValidationScore ?? 70;
    if (validationReport.overallScore < minScore) {
      console.warn(`[MultiPassProcessor] Validation below threshold: ${validationReport.overallScore}% < ${minScore}%`);
      validation.warnings.push({
        type: 'vendor-specific',
        message: `Validation score (${validationReport.overallScore.toFixed(1)}%) below threshold (${minScore}%)`,
      });
    }

    // Build result
    const result: MultiPassResult = {
      success: true,
      passes: passResults,
      finalOutput,
      validation,
      validationReport,
      metadata: {
        totalTime: Date.now() - startTime,
        tokensUsed,
        modelUsed: modelDecision.model,
        providerUsed: modelDecision.provider,
        vendor,
        passCount: passResults.length,
        validationScore: validationReport.overallScore,
        fallbacksUsed,
      },
    };

    // STEP 8: Persist to Supabase if enabled
    if (options.persistToDatabase && options.documentId && options.userId) {
      const recordId = await persistToSupabase(result, options);
      result.recordId = recordId;
    }

    return result;
  }

  /**
   * Execute pass with automatic fallback on failure
   * 
   * If the primary model fails, tries each fallback model in order.
   * Tracks which fallbacks were used for analytics.
   */
  private async executeWithFallback(
    pass: PassDefinition,
    content: string,
    context: PassContext,
    fallbackModels: AIModel[],
    fallbacksUsed: AIModel[]
  ): Promise<string> {
    try {
      return await pass.execute(content, context, this.apiCallFn);
    } catch (error: any) {
      // Try fallback models
      for (const fallbackModel of fallbackModels) {
        console.log(`[MultiPassProcessor] Trying fallback model: ${fallbackModel}`);
        fallbacksUsed.push(fallbackModel);
        
        const fallbackContext = { ...context, model: fallbackModel };
        try {
          return await pass.execute(content, fallbackContext, this.apiCallFn);
        } catch (fallbackError) {
          console.warn(`[MultiPassProcessor] Fallback ${fallbackModel} failed`);
        }
      }
      
      // All models failed
      throw error;
    }
  }

  /**
   * Build failure result for early termination
   */
  private buildFailureResult(
    passResults: ProcessingPass[],
    startTime: number,
    tokensUsed: number,
    modelDecision: any,
    vendor: VendorDetectionResult,
    fallbacksUsed: AIModel[],
    passCount: number
  ): MultiPassResult {
    return {
      success: false,
      passes: passResults,
      finalOutput: '',
      validation: {
        isValid: false,
        errors: [{ type: 'incomplete', message: 'Extraction pass failed' }],
        warnings: [],
        confidence: 0,
      },
      metadata: {
        totalTime: Date.now() - startTime,
        tokensUsed,
        modelUsed: modelDecision.model,
        providerUsed: modelDecision.provider,
        vendor,
        passCount,
        validationScore: 0,
        fallbacksUsed,
      },
    };
  }

  /**
   * Quick single-pass processing (for simple content)
   * 
   * Use this for:
   * - Short documents
   * - Time-critical requests
   * - Non-technical content
   * 
   * Note: No multi-pass validation, higher hallucination risk
   */
  async quickProcess(
    content: string,
    options: ProcessingOptions
  ): Promise<string> {
    const vendor = vendorDetector.detect(content);
    const routingContext = modelRouter.buildRoutingContext(content, vendor, options.mode);
    const modelDecision = modelRouter.selectModel(routingContext);

    const ruleEngine = createRuleEngine({
      vendorId: vendor.vendorId,
      mode: options.mode,
      language: options.language,
      preserveFormatting: true,
    });

    const systemPrompt = `${ruleEngine.buildGroundedSystemPrompt()}

${getModeFormattingInstructions(options.mode, options.language)}`;

    const userPrompt = `Process this document content:

${content.substring(0, 60000)}`;

    return this.apiCallFn(systemPrompt, userPrompt, modelDecision.model);
  }

  /**
   * Get registered passes for inspection/debugging
   */
  getPasses(): PassDefinition[] {
    return [...this.passes];
  }

  /**
   * Add a custom pass to the pipeline
   * 
   * Use this to extend processing with custom passes.
   * Passes are executed in array order.
   * 
   * @param pass - Pass definition to add
   * @param position - Insert position (default: end)
   */
  addPass(pass: PassDefinition, position?: number): void {
    if (position !== undefined && position >= 0 && position <= this.passes.length) {
      this.passes.splice(position, 0, pass);
    } else {
      this.passes.push(pass);
    }
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createMultiPassProcessor(apiCallFn: ApiCallFunction): MultiPassProcessor {
  return new MultiPassProcessor(apiCallFn);
}
