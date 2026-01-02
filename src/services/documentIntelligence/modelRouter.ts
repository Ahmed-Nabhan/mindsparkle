/**
 * AI Model Router (Step 8: Modular AI & Future Proofing)
 * 
 * ARCHITECTURE OVERVIEW:
 * This module implements a flexible, extensible AI model routing system.
 * It supports multiple AI providers and models, with cost-optimized selection
 * based on document type, vendor, and complexity.
 * 
 * KEY CONCEPTS:
 * 1. Provider Abstraction: Each AI provider (OpenAI, Google, Anthropic) is configured independently
 * 2. Model Configs: Each model has defined capabilities, costs, and best-use cases
 * 3. Routing Rules: Priority-based rules select the optimal model for each context
 * 4. Fallback Chain: If primary model fails, system falls back to alternatives
 * 
 * ADDING A NEW AI PROVIDER:
 * 1. Add provider ID to types.ts AIProvider type
 * 2. Add PROVIDER_CONFIGS entry below with API details
 * 3. Add model configs to MODEL_CONFIGS
 * 4. Implement provider adapter in aiProviders/ folder
 * 5. Update routing rules if needed
 * 
 * ADDING A NEW MODEL:
 * 1. Add model ID to types.ts AIModel type
 * 2. Add model config to MODEL_CONFIGS below
 * 3. Add routing rules that select this model
 */

import { VendorId, AIModel, AIProvider, AIProviderConfig, ModelRouterDecision, ProcessingMode } from './types';
import { VendorDetectionResult } from './types';

// ============================================
// PROVIDER CONFIGURATIONS (Future-Proof)
// ============================================

/**
 * AI Provider Registry
 * 
 * Each provider has:
 * - API configuration (baseUrl, auth)
 * - Rate limits
 * - Available capabilities
 * 
 * To add a new provider:
 * 1. Add entry here with isEnabled: true
 * 2. Implement provider adapter
 */
export const PROVIDER_CONFIGS: Record<AIProvider, AIProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    isEnabled: true,
    capabilities: ['text-generation', 'vision', 'function-calling', 'streaming', 'embeddings', 'long-context'],
    rateLimit: { requestsPerMinute: 500, tokensPerMinute: 150000 },
  },
  google: {
    id: 'google',
    name: 'Google AI (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1',
    apiKeyEnvVar: 'GOOGLE_AI_API_KEY',
    isEnabled: false, // Enable when Gemini 3 is available
    capabilities: ['text-generation', 'vision', 'long-context'],
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000 },
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    isEnabled: false, // Enable when ready
    capabilities: ['text-generation', 'vision', 'long-context'],
    rateLimit: { requestsPerMinute: 50, tokensPerMinute: 100000 },
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    isEnabled: false,
    capabilities: ['text-generation', 'function-calling'],
    rateLimit: { requestsPerMinute: 100, tokensPerMinute: 50000 },
  },
  local: {
    id: 'local',
    name: 'Local Models (Ollama)',
    baseUrl: 'http://localhost:11434/api',
    apiKeyEnvVar: '', // No API key needed for local
    isEnabled: false,
    capabilities: ['text-generation'],
    rateLimit: { requestsPerMinute: 1000, tokensPerMinute: 1000000 },
  },
};

// ============================================
// MODEL CONFIGURATIONS
// ============================================

interface ModelConfig {
  id: AIModel;
  provider: AIProvider;
  name: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  capabilities: ModelCapability[];
  bestFor: string[];
  isAvailable: boolean;
  fallbackTo?: AIModel;
}

type ModelCapability = 
  | 'cli-preservation'
  | 'technical-depth'
  | 'code-generation'
  | 'reasoning'
  | 'summarization'
  | 'quiz-generation'
  | 'fast-response'
  | 'vision'
  | 'long-context';

/**
 * Model Configuration Registry
 * 
 * Each model defines:
 * - Provider association
 * - Token limits and costs
 * - Capabilities for routing decisions
 * - Best use cases
 * - Fallback model if unavailable
 */
const MODEL_CONFIGS: Record<AIModel, ModelConfig> = {
  // ========== OpenAI Models ==========
  'gpt-5.2': {
    id: 'gpt-5.2',
    provider: 'openai',
    name: 'GPT-5.2',
    maxTokens: 128000,
    costPer1kInput: 0.01,
    costPer1kOutput: 0.03,
    capabilities: ['cli-preservation', 'technical-depth', 'code-generation', 'reasoning', 'long-context'],
    bestFor: [
      'Cisco Labs & CLI',
      'Network Architecture',
      'Complex Technical Content',
      'Multi-vendor configurations',
      'Advanced certification content (CCIE, JNCIE)',
    ],
    isAvailable: true,
    fallbackTo: 'gpt-4.1',
  },
  'gpt-4.1': {
    id: 'gpt-4.1',
    provider: 'openai',
    name: 'GPT-4.1',
    maxTokens: 128000,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.008,
    capabilities: ['technical-depth', 'code-generation', 'reasoning', 'summarization', 'long-context'],
    bestFor: [
      'General Technical Documentation',
      'Cloud Platform Content (AWS, Azure, GCP)',
      'Programming Tutorials',
      'Standard certification content (CCNA, CCNP)',
    ],
    isAvailable: true,
    fallbackTo: 'gpt-4o',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    maxTokens: 128000,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
    capabilities: ['technical-depth', 'reasoning', 'summarization', 'quiz-generation', 'vision'],
    bestFor: [
      'Balanced Technical Content',
      'Study Guides',
      'Interview Preparation',
      'Image-based documents',
    ],
    isAvailable: true,
    fallbackTo: 'gpt-4o-mini',
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    maxTokens: 128000,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    capabilities: ['summarization', 'quiz-generation', 'fast-response'],
    bestFor: [
      'Business Documents',
      'Academic Content',
      'Simple Summaries',
      'Quick Quizzes',
      'Non-technical content',
    ],
    isAvailable: true,
  },
  
  // ========== Google Gemini Models (Future) ==========
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    provider: 'google',
    name: 'Gemini 2.0 Flash',
    maxTokens: 1000000, // 1M context window
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
    capabilities: ['summarization', 'fast-response', 'long-context'],
    bestFor: [
      'Very long documents',
      'Quick summaries',
      'Cost-efficient processing',
    ],
    isAvailable: false, // Enable when Gemini API is integrated
    fallbackTo: 'gpt-4o-mini',
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    provider: 'google',
    name: 'Gemini 2.5 Pro',
    maxTokens: 2000000, // 2M context window
    costPer1kInput: 0.001,
    costPer1kOutput: 0.004,
    capabilities: ['technical-depth', 'reasoning', 'long-context', 'vision'],
    bestFor: [
      'Full textbook processing',
      'Complex technical analysis',
      'Multi-document synthesis',
    ],
    isAvailable: false,
    fallbackTo: 'gpt-4.1',
  },
  
  // ========== Anthropic Claude Models (Future) ==========
  'claude-sonnet': {
    id: 'claude-sonnet',
    provider: 'anthropic',
    name: 'Claude Sonnet',
    maxTokens: 200000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    capabilities: ['technical-depth', 'reasoning', 'code-generation'],
    bestFor: [
      'Code analysis',
      'Technical documentation',
      'Detailed explanations',
    ],
    isAvailable: false,
    fallbackTo: 'gpt-4o',
  },
  'claude-opus': {
    id: 'claude-opus',
    provider: 'anthropic',
    name: 'Claude Opus',
    maxTokens: 200000,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    capabilities: ['technical-depth', 'reasoning', 'code-generation', 'cli-preservation'],
    bestFor: [
      'Expert-level analysis',
      'Complex reasoning tasks',
      'High-stakes content',
    ],
    isAvailable: false,
    fallbackTo: 'gpt-5.2',
  },
  
  // ========== Local Models (Future) ==========
  'local-llama': {
    id: 'local-llama',
    provider: 'local',
    name: 'Local Llama',
    maxTokens: 8192,
    costPer1kInput: 0, // Free (local)
    costPer1kOutput: 0,
    capabilities: ['summarization', 'fast-response'],
    bestFor: [
      'Offline processing',
      'Privacy-sensitive content',
      'Development/testing',
    ],
    isAvailable: false,
    fallbackTo: 'gpt-4o-mini',
  },
  'local-mistral': {
    id: 'local-mistral',
    provider: 'local',
    name: 'Local Mistral',
    maxTokens: 32768,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    capabilities: ['summarization', 'code-generation', 'fast-response'],
    bestFor: [
      'Code-heavy documents',
      'Offline processing',
      'Development/testing',
    ],
    isAvailable: false,
    fallbackTo: 'gpt-4o-mini',
  },
};

// ============================================
// ROUTING RULES
// ============================================

interface RoutingRule {
  condition: (context: RoutingContext) => boolean;
  model: AIModel;
  reason: string;
  priority: number;
}

interface RoutingContext {
  vendor: VendorDetectionResult;
  mode: ProcessingMode;
  contentLength: number;
  hasCliCommands: boolean;
  hasConfigBlocks: boolean;
  complexity: 'low' | 'medium' | 'high' | 'expert';
  certificationLevel?: string;
}

const ROUTING_RULES: RoutingRule[] = [
  // Rule 1: Cisco Labs/CLI → GPT-5.2 (highest priority)
  {
    condition: (ctx) => 
      ctx.vendor.vendorId === 'cisco' && 
      (ctx.mode === 'labs' || ctx.hasCliCommands) &&
      ctx.complexity !== 'low',
    model: 'gpt-5.2',
    reason: 'Cisco Labs/CLI content requires GPT-5.2 for accurate command preservation',
    priority: 100,
  },

  // Rule 2: Cisco Architecture → GPT-5.2
  {
    condition: (ctx) =>
      ctx.vendor.vendorId === 'cisco' &&
      ctx.complexity === 'expert',
    model: 'gpt-5.2',
    reason: 'Expert-level Cisco architecture requires GPT-5.2',
    priority: 95,
  },

  // Rule 3: Advanced Certifications (CCIE, JNCIE, RHCA) → GPT-5.2
  {
    condition: (ctx) =>
      Boolean(ctx.certificationLevel) &&
      ['CCIE', 'JNCIE', 'RHCA', 'VCDX', 'NSE8'].some(cert => 
        ctx.certificationLevel!.toUpperCase().includes(cert)
      ),
    model: 'gpt-5.2',
    reason: 'Expert-level certification content requires GPT-5.2',
    priority: 90,
  },

  // Rule 4: Multi-vendor CLI/Config → GPT-5.2
  {
    condition: (ctx) =>
      ctx.hasCliCommands &&
      ctx.hasConfigBlocks &&
      ['cisco', 'juniper', 'paloalto', 'fortinet'].includes(ctx.vendor.vendorId),
    model: 'gpt-5.2',
    reason: 'Network vendor CLI/config requires GPT-5.2 for accuracy',
    priority: 85,
  },

  // Rule 5: General Technical with CLI → GPT-4.1
  {
    condition: (ctx) =>
      ctx.hasCliCommands &&
      ctx.complexity !== 'expert',
    model: 'gpt-4.1',
    reason: 'Technical content with CLI commands uses GPT-4.1',
    priority: 70,
  },

  // Rule 6: Cloud Platforms (AWS, Azure, GCP) → GPT-4.1
  {
    condition: (ctx) =>
      ['aws', 'microsoft', 'google'].includes(ctx.vendor.vendorId) &&
      ctx.complexity !== 'low',
    model: 'gpt-4.1',
    reason: 'Cloud platform content uses GPT-4.1',
    priority: 65,
  },

  // Rule 7: Professional Certifications (CCNP, JNCIP, etc.) → GPT-4.1
  {
    condition: (ctx) =>
      Boolean(ctx.certificationLevel) &&
      ['CCNP', 'JNCIS', 'JNCIP', 'RHCE', 'VCP', 'NSE5', 'NSE6'].some(cert =>
        ctx.certificationLevel!.toUpperCase().includes(cert)
      ),
    model: 'gpt-4.1',
    reason: 'Professional-level certification uses GPT-4.1',
    priority: 60,
  },

  // Rule 8: Labs mode (non-Cisco) → GPT-4.1
  {
    condition: (ctx) =>
      ctx.mode === 'labs' &&
      ctx.vendor.vendorId !== 'cisco',
    model: 'gpt-4.1',
    reason: 'Lab exercises require detailed step-by-step generation',
    priority: 55,
  },

  // Rule 9: Video mode → GPT-4o
  {
    condition: (ctx) => ctx.mode === 'video',
    model: 'gpt-4o',
    reason: 'Video script generation uses GPT-4o for narrative quality',
    priority: 50,
  },

  // Rule 10: Interview mode with technical content → GPT-4o
  {
    condition: (ctx) =>
      ctx.mode === 'interview' &&
      ctx.vendor.detected,
    model: 'gpt-4o',
    reason: 'Technical interview questions use GPT-4o',
    priority: 45,
  },

  // Rule 11: Study mode with medium complexity → GPT-4o
  {
    condition: (ctx) =>
      ctx.mode === 'study' &&
      ctx.complexity === 'medium',
    model: 'gpt-4o',
    reason: 'Medium complexity study content uses GPT-4o',
    priority: 40,
  },

  // Rule 12: Entry-level certifications → GPT-4o-mini
  {
    condition: (ctx) =>
      Boolean(ctx.certificationLevel) &&
      ['CCNA', 'A+', 'NETWORK+', 'SECURITY+', 'AZ-900', 'JNCIA'].some(cert =>
        ctx.certificationLevel!.toUpperCase().includes(cert)
      ) &&
      !ctx.hasCliCommands,
    model: 'gpt-4o-mini',
    reason: 'Entry-level certification content uses efficient mini model',
    priority: 35,
  },

  // Rule 13: Quiz generation (simple) → GPT-4o-mini
  {
    condition: (ctx) =>
      ctx.mode === 'quiz' &&
      ctx.complexity === 'low',
    model: 'gpt-4o-mini',
    reason: 'Simple quiz generation uses mini model for efficiency',
    priority: 30,
  },

  // Rule 14: Business/Academic content → GPT-4o-mini
  {
    condition: (ctx) =>
      !ctx.vendor.detected &&
      ctx.complexity !== 'expert',
    model: 'gpt-4o-mini',
    reason: 'Non-technical content uses efficient mini model',
    priority: 25,
  },

  // Rule 15: Short content → GPT-4o-mini
  {
    condition: (ctx) => ctx.contentLength < 2000,
    model: 'gpt-4o-mini',
    reason: 'Short content uses mini model for speed',
    priority: 20,
  },

  // Default: GPT-4o (balanced)
  {
    condition: () => true,
    model: 'gpt-4o',
    reason: 'Default model for balanced performance',
    priority: 0,
  },
];

// ============================================
// MODEL ROUTER CLASS
// ============================================

export class AIModelRouter {
  private static instance: AIModelRouter;

  private constructor() {}

  static getInstance(): AIModelRouter {
    if (!AIModelRouter.instance) {
      AIModelRouter.instance = new AIModelRouter();
    }
    return AIModelRouter.instance;
  }

  /**
   * Select optimal model based on context
   * 
   * ROUTING PIPELINE:
   * 1. Evaluate all routing rules by priority
   * 2. Find first matching rule
   * 3. Check if selected model is available
   * 4. If not, follow fallback chain
   * 5. Build fallback list for error recovery
   * 
   * @param context - Document and processing context
   * @returns ModelRouterDecision with model, provider, and fallbacks
   */
  selectModel(context: RoutingContext): ModelRouterDecision {
    // Sort rules by priority (highest first)
    const sortedRules = [...ROUTING_RULES].sort((a, b) => b.priority - a.priority);

    // Find first matching rule
    for (const rule of sortedRules) {
      if (rule.condition(context)) {
        let selectedModel = rule.model;
        let config = MODEL_CONFIGS[selectedModel];
        
        // FALLBACK LOGIC: If model unavailable, follow fallback chain
        while (!config.isAvailable && config.fallbackTo) {
          console.log(`[ModelRouter] ${selectedModel} unavailable, falling back to ${config.fallbackTo}`);
          selectedModel = config.fallbackTo;
          config = MODEL_CONFIGS[selectedModel];
        }
        
        const estimatedTokens = this.estimateTokens(context.contentLength);
        
        // Build fallback chain for runtime errors
        const fallbackModels = this.buildFallbackChain(selectedModel);
        
        return {
          model: selectedModel,
          provider: config.provider,
          reason: rule.reason,
          estimatedTokens,
          estimatedCost: this.estimateCost(estimatedTokens, config),
          fallbackModels,
        };
      }
    }

    // Fallback (should never reach here due to default rule)
    const defaultConfig = MODEL_CONFIGS['gpt-4o'];
    const tokens = this.estimateTokens(context.contentLength);
    return {
      model: 'gpt-4o',
      provider: 'openai',
      reason: 'Fallback to default model',
      estimatedTokens: tokens,
      estimatedCost: this.estimateCost(tokens, defaultConfig),
      fallbackModels: ['gpt-4o-mini'],
    };
  }

  /**
   * Build fallback chain for a model
   * 
   * Creates ordered list of fallback models for runtime error recovery.
   * Each model's fallbackTo property creates the chain.
   * 
   * @param startModel - The initially selected model
   * @returns Array of fallback models in priority order
   */
  private buildFallbackChain(startModel: AIModel): AIModel[] {
    const chain: AIModel[] = [];
    const visited = new Set<AIModel>();
    let current = startModel;
    
    while (MODEL_CONFIGS[current]?.fallbackTo && !visited.has(current)) {
      visited.add(current);
      const fallback = MODEL_CONFIGS[current].fallbackTo!;
      if (MODEL_CONFIGS[fallback]?.isAvailable) {
        chain.push(fallback);
      }
      current = fallback;
    }
    
    return chain;
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(providerId: AIProvider): AIProviderConfig {
    return PROVIDER_CONFIGS[providerId];
  }

  /**
   * Get all enabled providers
   */
  getEnabledProviders(): AIProviderConfig[] {
    return Object.values(PROVIDER_CONFIGS).filter(p => p.isEnabled);
  }

  /**
   * Check if a specific model is available
   */
  isModelAvailable(modelId: AIModel): boolean {
    const config = MODEL_CONFIGS[modelId];
    if (!config?.isAvailable) return false;
    
    const provider = PROVIDER_CONFIGS[config.provider];
    return provider?.isEnabled ?? false;
  }

  /**
   * Estimate token count from content length
   */
  private estimateTokens(contentLength: number): number {
    // Rough estimate: ~4 characters per token for English
    return Math.ceil(contentLength / 4);
  }

  /**
   * Estimate cost based on tokens and model
   */
  private estimateCost(tokens: number, config: ModelConfig): number {
    const inputCost = (tokens / 1000) * config.costPer1kInput;
    const outputCost = (tokens / 2 / 1000) * config.costPer1kOutput; // Assume output is ~50% of input
    return inputCost + outputCost;
  }

  /**
   * Analyze content complexity
   */
  analyzeComplexity(
    content: string,
    vendor: VendorDetectionResult
  ): RoutingContext['complexity'] {
    let complexityScore = 0;

    // Check for complex patterns
    const complexIndicators = [
      { pattern: /\b(architecture|design pattern|scalability)\b/gi, weight: 2 },
      { pattern: /\b(advanced|expert|professional)\b/gi, weight: 3 },
      { pattern: /\b(CCIE|JNCIE|RHCA|VCDX)\b/g, weight: 5 },
      { pattern: /\b(CCNP|JNCIP|RHCE|VCP)\b/g, weight: 3 },
      { pattern: /\b(troubleshoot|debug|diagnose)\b/gi, weight: 2 },
      { pattern: /\b(BGP|OSPF|EIGRP|MPLS|EVPN|VXLAN)\b/g, weight: 3 },
      { pattern: /^\s*(config|interface|router)\)?#/gm, weight: 2 }, // CLI prompts
      { pattern: /\{[\s\S]{100,}\}/g, weight: 2 }, // Large JSON/config blocks
    ];

    for (const indicator of complexIndicators) {
      const matches = content.match(indicator.pattern);
      if (matches) {
        complexityScore += matches.length * indicator.weight;
      }
    }

    // Factor in vendor-specific complexity
    if (vendor.detected && vendor.confidence > 0.7) {
      complexityScore += 5;
    }

    // Determine complexity level
    if (complexityScore >= 30) return 'expert';
    if (complexityScore >= 15) return 'high';
    if (complexityScore >= 5) return 'medium';
    return 'low';
  }

  /**
   * Detect certification level from content
   */
  detectCertificationLevel(content: string): string | undefined {
    const certPatterns = [
      // Expert level
      /\b(CCIE|JNCIE|RHCA|VCDX|NSE8)\b/gi,
      // Professional level
      /\b(CCNP|JNCIP|RHCE|VCP|NSE[56]|VCAP)\b/gi,
      // Associate level
      /\b(CCNA|JNCIA|RHCSA|NSE4)\b/gi,
      // Entry level
      /\b(A\+|Network\+|Security\+|AZ-900|AWS-CP)\b/gi,
    ];

    for (const pattern of certPatterns) {
      const match = content.match(pattern);
      if (match) {
        return match[0].toUpperCase();
      }
    }

    return undefined;
  }

  /**
   * Check if content has CLI commands
   */
  hasCliCommands(content: string): boolean {
    const cliPatterns = [
      /^[A-Za-z0-9_-]+[#>]\s*.+/m,
      /^\$\s*(sudo\s+)?[a-z]+/m,
      /^(aws|gcloud|az|kubectl)\s+/m,
      /^PS\s*>\s*/m,
    ];

    return cliPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check if content has configuration blocks
   */
  hasConfigBlocks(content: string): boolean {
    const configPatterns = [
      /```[\s\S]{50,}```/,          // Markdown code blocks
      /^\s{2,}[a-z-]+\s+[a-z0-9-]+/m, // Indented config
      /^!\n[\s\S]+\n!/m,            // Cisco config blocks
      /\{[\s\S]{100,}\}/,           // JSON/YAML blocks
    ];

    return configPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Get model configuration by ID
   */
  getModelConfig(modelId: AIModel): ModelConfig {
    return MODEL_CONFIGS[modelId];
  }

  /**
   * Get all available models
   */
  getAvailableModels(): ModelConfig[] {
    return Object.values(MODEL_CONFIGS);
  }

  /**
   * Build full routing context from content and vendor
   */
  buildRoutingContext(
    content: string,
    vendor: VendorDetectionResult,
    mode: RoutingContext['mode']
  ): RoutingContext {
    return {
      vendor,
      mode,
      contentLength: content.length,
      hasCliCommands: this.hasCliCommands(content),
      hasConfigBlocks: this.hasConfigBlocks(content),
      complexity: this.analyzeComplexity(content, vendor),
      certificationLevel: this.detectCertificationLevel(content),
    };
  }
}

// Export singleton instance
export const modelRouter = AIModelRouter.getInstance();
