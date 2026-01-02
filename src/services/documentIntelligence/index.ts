/**
 * Document Intelligence - Main Entry Point (Step 8: Modular AI & Future Proofing)
 * 
 * ARCHITECTURE OVERVIEW:
 * This is the unified AI document processing system for MindSparkle.
 * It provides a modular, extensible architecture for intelligent document analysis.
 * 
 * KEY FEATURES:
 * - Multi-vendor detection (Cisco, AWS, Microsoft, Google, etc.)
 * - Cost-optimized AI model routing with fallback chains
 * - Multi-pass validation for accuracy (hallucination prevention)
 * - Mode-specific output generation
 * - Future-proof provider abstraction (OpenAI, Gemini, Claude)
 * - Supabase integration for persistence and analytics
 * 
 * USAGE EXAMPLE:
 * ```typescript
 * import { DocumentIntelligence } from './services/documentIntelligence';
 * 
 * const ai = new DocumentIntelligence(apiCallFunction);
 * const analysis = ai.analyze(documentContent);
 * const result = await ai.process(documentContent, {
 *   mode: 'study',
 *   language: 'en',
 *   persistToDatabase: true,
 *   documentId: 'doc-123',
 *   userId: 'user-456',
 * });
 * ```
 * 
 * EXTENDING THE SYSTEM:
 * - New vendors: Add to vendorDetector.ts
 * - New models: Add to modelRouter.ts MODEL_CONFIGS
 * - New providers: Add to modelRouter.ts PROVIDER_CONFIGS
 * - New passes: Use processor.addPass() method
 */

// Core Types - includes AI provider and model types
export * from './types';

// Vendor Detection
export { vendorDetector, VENDOR_CONFIGS, VendorDetector } from './vendorDetector';

// Rule Engine
export { createRuleEngine, RuleEngine } from './ruleEngine';
export type { RuleEngineConfig, ProcessedContent, ConfigBlock, ValidationResult } from './ruleEngine';

// AI Model Router - Now with provider abstraction
export { modelRouter, AIModelRouter, PROVIDER_CONFIGS } from './modelRouter';

// Multi-Pass Processor - Enhanced with validation and Supabase
export { createMultiPassProcessor, MultiPassProcessor } from './multiPassProcessor';
export type { MultiPassResult, ProcessingOptions, ProcessingPass, ProcessingMetadata } from './multiPassProcessor';

// Prompt Builder
export { promptBuilder, PromptBuilder } from './promptBuilder';
export type { ProcessingMode, PromptConfig, ModeSpecificOptions, GeneratedPrompt } from './promptBuilder';

// Knowledge Graph
export { createKnowledgeGraph, generateLearningPaths, KnowledgeGraphBuilder, LearningPathGenerator } from './knowledgeGraph';
export type { KnowledgeGraph, KnowledgeNode, KnowledgeEdge, LearningPath, ConceptCluster } from './knowledgeGraph';

// Video Pipeline
export { generateStoryboard, generateVoiceScript, StoryboardGenerator, VoiceScriptGenerator } from './videoPipeline';
export type { Storyboard, Scene, VoiceScript, NarrationScript, VisualPrompt } from './videoPipeline';

// Validation Layer - For hallucination prevention
export { validateContent, quickValidate, ValidationLayer } from './validationLayer';
export type { ValidationReport, ValidationCheck, Correction, Warning } from './validationLayer';

// ============================================
// MAIN DOCUMENT INTELLIGENCE CLASS
// ============================================

import { VendorDetectionResult, ExtractedContent, AIModel, AIProvider } from './types';
import { vendorDetector } from './vendorDetector';
import { modelRouter } from './modelRouter';
import { createMultiPassProcessor, MultiPassResult, ProcessingMetadata } from './multiPassProcessor';
import { promptBuilder, ProcessingMode, GeneratedPrompt } from './promptBuilder';
import { createKnowledgeGraph, KnowledgeGraph } from './knowledgeGraph';
import { generateStoryboard, generateVoiceScript, Storyboard, VoiceScript } from './videoPipeline';
import { validateContent, ValidationReport } from './validationLayer';

export interface DocumentAnalysis {
  vendor: VendorDetectionResult;
  recommendedModel: AIModel;
  recommendedProvider: AIProvider;
  fallbackModels: AIModel[];
  complexity: 'low' | 'medium' | 'high' | 'expert';
  hasCliCommands: boolean;
  hasConfigBlocks: boolean;
  certificationLevel?: string;
  suggestedModes: ProcessingMode[];
  estimatedCost: number;
}

export interface ProcessingResult {
  success: boolean;
  output: string;
  analysis: DocumentAnalysis;
  validation?: ValidationReport;
  knowledgeGraph?: KnowledgeGraph;
  metadata: {
    model: AIModel;
    provider: AIProvider;
    processingTime: number;
    tokensUsed?: number;
    validationScore?: number;
    fallbacksUsed?: AIModel[];
  };
  /** Database record ID if persisted */
  recordId?: string;
}

type ApiCallFunction = (
  systemPrompt: string,
  userPrompt: string,
  model: AIModel
) => Promise<string>;

/**
 * Main Document Intelligence Engine
 * 
 * This is the primary interface for document processing.
 * It orchestrates vendor detection, model selection, and processing.
 * 
 * FEATURES:
 * - Automatic vendor detection and specialized handling
 * - Cost-optimized model selection with fallbacks
 * - Multi-pass processing for accuracy
 * - Validation layer for hallucination prevention
 * - Knowledge graph generation
 * - Video/storyboard generation
 * 
 * USAGE:
 * ```typescript
 * const ai = new DocumentIntelligence(apiCallFn);
 * 
 * // Quick analysis
 * const analysis = ai.analyze(documentContent);
 * 
 * // Full processing
 * const result = await ai.process(documentContent, 'study', {
 *   language: 'en',
 *   useMultiPass: true,
 *   validate: true,
 *   persistToDatabase: true,
 *   documentId: 'doc-123',
 *   userId: 'user-456',
 * });
 * ```
 */
export class DocumentIntelligence {
  private apiCallFn: ApiCallFunction;

  constructor(apiCallFn: ApiCallFunction) {
    this.apiCallFn = apiCallFn;
  }

  /**
   * Analyze document to determine processing strategy
   * 
   * This is a lightweight analysis that:
   * 1. Detects vendor (Cisco, AWS, etc.)
   * 2. Determines content complexity
   * 3. Selects optimal AI model
   * 4. Suggests appropriate processing modes
   * 
   * @param content - Document text content
   * @param fileName - Optional filename for hints
   * @returns DocumentAnalysis with recommendations
   */
  analyze(content: string, fileName?: string): DocumentAnalysis {
    // STEP 1: Detect vendor
    const vendor = vendorDetector.detect(content, fileName);

    // STEP 2: Build routing context
    const mode: ProcessingMode = 'summary';
    const routingContext = modelRouter.buildRoutingContext(content, vendor, mode);

    // STEP 3: Get model recommendation with fallbacks
    const modelDecision = modelRouter.selectModel(routingContext);

    // STEP 4: Determine suggested modes based on content
    const suggestedModes = this.determineSuggestedModes(content, vendor);

    return {
      vendor,
      recommendedModel: modelDecision.model,
      recommendedProvider: modelDecision.provider,
      fallbackModels: modelDecision.fallbackModels,
      complexity: routingContext.complexity,
      hasCliCommands: routingContext.hasCliCommands,
      hasConfigBlocks: routingContext.hasConfigBlocks,
      certificationLevel: routingContext.certificationLevel,
      suggestedModes,
      estimatedCost: modelDecision.estimatedCost,
    };
  }

  /**
   * Process document for a specific mode
   * 
   * PROCESSING MODES:
   * - study: Comprehensive study guide
   * - summary: Executive summary
   * - quiz: Quiz questions
   * - flashcards: Flashcard set
   * - interview: Interview questions
   * - labs: Hands-on lab exercises
   * - video: Video script/storyboard
   * 
   * OPTIONS:
   * - language: Output language ('en' | 'ar')
   * - useMultiPass: Use 4-pass pipeline (default: true)
   * - validate: Run validation layer (default: true)
   * - buildKnowledgeGraph: Generate knowledge graph
   * - persistToDatabase: Save to Supabase
   * - documentId/userId: Required for persistence
   * 
   * @param content - Document text content
   * @param mode - Processing mode
   * @param options - Processing options
   * @returns ProcessingResult with output and metadata
   */
  async process(
    content: string,
    mode: ProcessingMode,
    options: {
      language?: 'en' | 'ar';
      useMultiPass?: boolean;
      validate?: boolean;
      buildKnowledgeGraph?: boolean;
      modeOptions?: Record<string, any>;
      persistToDatabase?: boolean;
      documentId?: string;
      userId?: string;
      minValidationScore?: number;
    } = {}
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const language = options.language || 'en';
    const useMultiPass = options.useMultiPass !== false;
    const validate = options.validate !== false;

    // Analyze document
    const analysis = this.analyze(content);

    let output: string;
    let tokensUsed: number | undefined;
    let validation: ValidationReport | undefined;
    let validationScore: number | undefined;
    let fallbacksUsed: AIModel[] | undefined;
    let recordId: string | undefined;

    if (useMultiPass && ['study', 'labs'].includes(mode)) {
      // Use multi-pass processor for complex modes
      // This provides hallucination prevention through 4-pass validation
      const processor = createMultiPassProcessor(this.apiCallFn);
      const result = await processor.process(content, {
        mode,
        language,
        persistToDatabase: options.persistToDatabase,
        documentId: options.documentId,
        userId: options.userId,
        minValidationScore: options.minValidationScore,
        onProgress: (pass, total, message) => {
          console.log(`[DocumentIntelligence] Pass ${pass}/${total}: ${message}`);
        },
      });

      output = result.finalOutput;
      tokensUsed = result.metadata.tokensUsed;
      validationScore = result.metadata.validationScore;
      fallbacksUsed = result.metadata.fallbacksUsed;
      recordId = result.recordId;
      
      if (validate && result.validationReport) {
        validation = result.validationReport;
      }
    } else {
      // Use single-pass with prompt builder
      const prompt = promptBuilder.build(
        {
          mode,
          language,
          vendor: analysis.vendor,
          contentLength: content.length,
          options: options.modeOptions,
        },
        content
      );

      output = await this.apiCallFn(
        prompt.systemPrompt,
        prompt.userPrompt,
        prompt.recommendedModel
      );

      if (validate) {
        validation = validateContent(output, content, analysis.vendor);
        validationScore = validation.overallScore;
      }
    }

    // Build knowledge graph if requested
    let knowledgeGraph: KnowledgeGraph | undefined;
    if (options.buildKnowledgeGraph) {
      knowledgeGraph = createKnowledgeGraph(
        'doc-' + Date.now(),
        content,
        analysis.vendor.vendorId
      );
    }

    return {
      success: true,
      output,
      analysis,
      validation,
      knowledgeGraph,
      metadata: {
        model: analysis.recommendedModel,
        provider: analysis.recommendedProvider,
        processingTime: Date.now() - startTime,
        tokensUsed,
        validationScore,
        fallbacksUsed,
      },
      recordId,
    };
  }

  /**
   * Generate video content from document
   */
  async generateVideo(
    content: string,
    title: string,
    options: {
      language?: 'en' | 'ar';
      duration?: number;
      style?: 'educational' | 'tutorial' | 'overview';
    } = {}
  ): Promise<{ storyboard: Storyboard; voiceScript: VoiceScript }> {
    const vendor = vendorDetector.detect(content);

    const storyboard = generateStoryboard(content, title, {
      language: options.language,
      style: options.style,
      targetDuration: options.duration,
      vendor,
    });

    const voiceScript = generateVoiceScript(storyboard);

    return { storyboard, voiceScript };
  }

  /**
   * Build prompt for a mode (for external use)
   */
  buildPrompt(
    content: string,
    mode: ProcessingMode,
    options: {
      language?: 'en' | 'ar';
      modeOptions?: Record<string, any>;
    } = {}
  ): GeneratedPrompt {
    const vendor = vendorDetector.detect(content);

    return promptBuilder.build(
      {
        mode,
        language: options.language || 'en',
        vendor,
        contentLength: content.length,
        options: options.modeOptions,
      },
      content
    );
  }

  /**
   * Validate generated content against source
   */
  validateOutput(
    generatedContent: string,
    sourceContent: string
  ): ValidationReport {
    const vendor = vendorDetector.detect(sourceContent);
    return validateContent(generatedContent, sourceContent, vendor);
  }

  /**
   * Determine suggested modes based on content
   */
  private determineSuggestedModes(
    content: string,
    vendor: VendorDetectionResult
  ): ProcessingMode[] {
    const modes: ProcessingMode[] = ['study', 'summary'];

    // Quiz is good for most content
    modes.push('quiz');

    // Labs for vendor-specific content with CLI
    if (vendor.detected && modelRouter.hasCliCommands(content)) {
      modes.unshift('labs');
    }

    // Interview for professional content
    if (vendor.detected || content.length > 5000) {
      modes.push('interview');
    }

    // Video for substantial content
    if (content.length > 2000) {
      modes.push('video');
    }

    // Flashcards for term-heavy content
    if (content.match(/\*\*[^*]+\*\*/g)?.length || 0 > 5) {
      modes.push('flashcards');
    }

    return modes;
  }
}

// ============================================
// CONVENIENCE FACTORY
// ============================================

/**
 * Create a new Document Intelligence instance
 */
export function createDocumentIntelligence(
  apiCallFn: ApiCallFunction
): DocumentIntelligence {
  return new DocumentIntelligence(apiCallFn);
}

// Default export
export default DocumentIntelligence;
