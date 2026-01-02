/**
 * Document Intelligence Types
 * Core type definitions for the document-aware AI system
 * 
 * ARCHITECTURE NOTE (Step 8: Future Proofing):
 * This file defines the foundational types for the modular AI system.
 * Adding a new AI provider requires:
 * 1. Add provider ID to AIProvider type
 * 2. Add models to AIModel type
 * 3. Register in modelRouter's PROVIDER_CONFIGS
 */

// ============================================
// AI PROVIDER DEFINITIONS (Future-Proof)
// ============================================

/**
 * Supported AI Providers
 * 
 * Adding new providers:
 * 1. Add the provider ID here
 * 2. Add provider config in modelRouter.ts
 * 3. Implement provider adapter in aiProviders/ folder
 */
export type AIProvider = 
  | 'openai'      // GPT models
  | 'google'      // Gemini models
  | 'anthropic'   // Claude models
  | 'mistral'     // Mistral models
  | 'local';      // Local/self-hosted models

/**
 * Provider Configuration
 * Each provider has different capabilities and pricing
 */
export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  isEnabled: boolean;
  capabilities: AICapability[];
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}

export type AICapability = 
  | 'text-generation'
  | 'vision'
  | 'function-calling'
  | 'streaming'
  | 'embeddings'
  | 'long-context';

// ============================================
// VENDOR DEFINITIONS
// ============================================

export type VendorId = 
  | 'cisco' 
  | 'aws' 
  | 'microsoft' 
  | 'google' 
  | 'oracle'
  | 'vmware'
  | 'redhat'
  | 'comptia'
  | 'fortinet'
  | 'paloalto'
  | 'juniper'
  | 'generic';

export interface VendorConfig {
  id: VendorId;
  name: string;
  logo: string; // Base64 or URL
  color: string; // Brand color
  keywords: string[];
  cliPatterns: RegExp[];
  certifications: string[];
  aiRules: VendorAIRules;
}

export interface VendorAIRules {
  preserveCliCommands: boolean;
  preserveConfigBlocks: boolean;
  useStrictGrounding: boolean;
  allowExternalKnowledge: boolean;
  technicalDepth: 'basic' | 'intermediate' | 'advanced' | 'expert';
  outputFormat: 'study-notes' | 'exam-prep' | 'reference' | 'tutorial';
  specialInstructions: string[];
}

// ============================================
// DOCUMENT STRUCTURE
// ============================================

export type FileType = 'pdf' | 'pptx' | 'docx' | 'txt' | 'unknown';

export interface DocumentMetadata {
  fileName: string;
  fileType: FileType;
  fileSize: number;
  fileSizeMB: number;
  pageCount: number;
  extractedAt: Date;
  processingTimeMs: number;
  extractionMethod: string;
  extractionQuality: 'excellent' | 'good' | 'partial' | 'failed';
}

export interface ExtractedContent {
  metadata: DocumentMetadata;
  vendor: VendorDetectionResult;
  pages: PageContent[];
  fullText: string;
  summary?: string;
}

export interface PageContent {
  pageNum: number;
  title?: string;
  headings: Heading[];
  paragraphs: string[];
  bulletPoints: string[];
  cliCommands: CliCommand[];
  tables: TableData[];
  codeBlocks: CodeBlock[];
  images: ImageRef[];
  rawText: string;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface CliCommand {
  prompt: string;      // e.g., "Router#", "Switch(config)#"
  command: string;     // e.g., "show ip route"
  fullLine: string;    // Full command line
  context?: string;    // What the command does
}

export interface TableData {
  headers: string[];
  rows: string[][];
  caption?: string;
}

export interface CodeBlock {
  language: string;
  code: string;
  context?: string;
}

export interface ImageRef {
  id: string;
  pageNum: number;
  base64?: string;
  url?: string;
  caption?: string;
  type: 'figure' | 'diagram' | 'screenshot' | 'logo';
}

// ============================================
// VENDOR DETECTION
// ============================================

export interface VendorDetectionResult {
  detected: boolean;
  vendorId: VendorId;
  vendorName: string;
  confidence: number;
  matchedKeywords: string[];
  matchedPatterns: string[];
  certificationDetected?: string;
  logo: string;
  color: string;
}

// ============================================
// AI PROCESSING
// ============================================

/**
 * Available AI Models (Extensible)
 * 
 * Naming convention: {provider}-{model-version}
 * Adding new models:
 * 1. Add model ID here
 * 2. Add model config in modelRouter.ts MODEL_CONFIGS
 * 3. Update routing rules if needed
 * 
 * Current models by provider:
 * - OpenAI: gpt-4o, gpt-4o-mini, gpt-4.1, gpt-5.2
 * - Google: gemini-2.0-flash, gemini-2.5-pro (placeholder)
 * - Anthropic: claude-sonnet, claude-opus (placeholder)
 */
export type AIModel = 
  // OpenAI Models
  | 'gpt-4o' 
  | 'gpt-4o-mini' 
  | 'gpt-4.1' 
  | 'gpt-5.2'
  // Google Gemini Models (Future)
  | 'gemini-2.0-flash'
  | 'gemini-2.5-pro'
  // Anthropic Claude Models (Future)
  | 'claude-sonnet'
  | 'claude-opus'
  // Local/Custom Models (Future)
  | 'local-llama'
  | 'local-mistral';

export type ProcessingMode = 'study' | 'quiz' | 'interview' | 'video' | 'labs' | 'summary' | 'flashcards';

export interface ModelRouterDecision {
  model: AIModel;
  provider: AIProvider;
  reason: string;
  estimatedTokens: number;
  estimatedCost: number;
  fallbackModels: AIModel[];
}

export interface ProcessingOptions {
  language: 'en' | 'ar';
  outputFormat: 'summary' | 'study-notes' | 'flashcards' | 'quiz' | 'exam-prep';
  includeImages: boolean;
  maxLength?: number;
  multiPass: boolean;
}

export interface AIPrompt {
  systemPrompt: string;
  userPrompt: string;
  model: AIModel;
  maxTokens: number;
  temperature: number;
}

// ============================================
// OUTPUT STRUCTURE
// ============================================

export interface StructuredOutput {
  vendorHeader: VendorHeader;
  sections: OutputSection[];
  keyPoints: string[];
  cliReference?: CliReference;
  studyTips?: string[];
  examNotes?: string[];
  generatedAt: Date;
  model: AIModel;
  processingTime: number;
}

export interface VendorHeader {
  logo: string;
  vendorName: string;
  documentTitle: string;
  certification?: string;
  color: string;
}

export interface OutputSection {
  title: string;
  content: string;
  type: 'text' | 'list' | 'table' | 'code' | 'cli' | 'important' | 'warning';
  subsections?: OutputSection[];
}

export interface CliReference {
  title: string;
  commands: {
    command: string;
    description: string;
    example?: string;
  }[];
}

// ============================================
// STORAGE
// ============================================

export interface StorageDecision {
  location: 'local' | 'cloud';
  reason: string;
  compressionNeeded: boolean;
}

export interface ProcessingResult {
  success: boolean;
  content?: ExtractedContent;
  output?: StructuredOutput;
  error?: string;
  storageDecision: StorageDecision;
}

// ============================================
// SUPABASE INTEGRATION (Step 8)
// ============================================

/**
 * Document Analysis Record for Supabase
 * 
 * Stored in: document_analysis table
 * Used for: Analytics, caching, and user history
 */
export interface DocumentAnalysisRecord {
  id: string;
  documentId: string;
  userId: string;
  vendorId: VendorId;
  vendorConfidence: number;
  modelUsed: AIModel;
  providerUsed: AIProvider;
  processingMode: ProcessingMode;
  tokensUsed: number;
  processingTimeMs: number;
  validationScore: number;
  passCount: number;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * AI Summary Record for Supabase
 * 
 * Stored in: ai_summaries table
 * Contains the generated content for each mode
 */
export interface AISummaryRecord {
  id: string;
  documentId: string;
  userId: string;
  mode: ProcessingMode;
  content: string;
  modelUsed: AIModel;
  validationPassed: boolean;
  validationScore: number;
  warnings: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Processing Pipeline State
 * 
 * Tracks the state of multi-pass processing
 * Enables resumable processing and debugging
 */
export interface PipelineState {
  documentId: string;
  currentPass: number;
  totalPasses: number;
  passResults: Map<string, string>;
  startedAt: Date;
  lastUpdatedAt: Date;
  status: 'pending' | 'processing' | 'validating' | 'completed' | 'failed';
  error?: string;
}
