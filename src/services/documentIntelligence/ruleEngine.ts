/**
 * Vendor-Aware Rule Engine
 * 
 * Applies vendor-specific rules to content processing
 * Handles CLI preservation, config blocks, and output formatting
 */

import { VendorId, VendorConfig, VendorAIRules, PageContent, CliCommand } from './types';
import { VENDOR_CONFIGS } from './vendorDetector';

// ============================================
// RULE TYPES
// ============================================

export interface RuleEngineConfig {
  vendorId: VendorId;
  mode: 'study' | 'quiz' | 'interview' | 'video' | 'labs' | 'summary' | 'flashcards';
  language: 'en' | 'ar';
  preserveFormatting: boolean;
}

export interface ProcessedContent {
  text: string;
  cliCommands: CliCommand[];
  configBlocks: ConfigBlock[];
  warnings: string[];
  suggestions: string[];
}

export interface ConfigBlock {
  type: 'cli' | 'config' | 'code' | 'output';
  language: string;
  content: string;
  context?: string;
  vendor?: VendorId;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  confidence: number;
}

export interface ValidationError {
  type: 'factual' | 'syntax' | 'incomplete' | 'hallucination';
  message: string;
  location?: string;
  suggestion?: string;
}

export interface ValidationWarning {
  type: 'outdated' | 'vendor-specific' | 'version-dependent';
  message: string;
}

// ============================================
// RULE ENGINE CLASS
// ============================================

export class RuleEngine {
  private vendorConfig: VendorConfig;
  private rules: VendorAIRules;
  private mode: RuleEngineConfig['mode'];
  private language: RuleEngineConfig['language'];

  constructor(config: RuleEngineConfig) {
    this.vendorConfig = VENDOR_CONFIGS[config.vendorId] || VENDOR_CONFIGS.generic;
    this.rules = this.vendorConfig.aiRules;
    this.mode = config.mode;
    this.language = config.language;
  }

  // ============================================
  // CLI COMMAND EXTRACTION
  // ============================================

  /**
   * Extract and preserve CLI commands from text
   */
  extractCliCommands(text: string): CliCommand[] {
    const commands: CliCommand[] = [];
    
    if (!this.rules.preserveCliCommands) {
      return commands;
    }

    for (const pattern of this.vendorConfig.cliPatterns) {
      const matches = text.matchAll(new RegExp(pattern.source, 'gm'));
      for (const match of matches) {
        const fullLine = match[0].trim();
        const parsed = this.parseCliLine(fullLine);
        if (parsed) {
          commands.push(parsed);
        }
      }
    }

    return this.deduplicateCommands(commands);
  }

  /**
   * Parse a CLI line into structured format
   */
  private parseCliLine(line: string): CliCommand | null {
    // Match common prompt patterns
    const promptPatterns = [
      /^([A-Za-z0-9_-]+[#>])\s*(.+)$/,              // Router# command
      /^([A-Za-z0-9_-]+\([a-z-]+\)[#>])\s*(.+)$/,  // Router(config)# command
      /^(\$)\s*(.+)$/,                               // $ command
      /^(#)\s*(.+)$/,                                // # command
      /^(\[.+\])\s*(.+)$/,                          // [edit] command (Junos)
    ];

    for (const pattern of promptPatterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          prompt: match[1],
          command: match[2],
          fullLine: line,
        };
      }
    }

    // If no prompt found, treat entire line as command
    if (line.length > 0 && !line.startsWith('!') && !line.startsWith('#')) {
      return {
        prompt: '',
        command: line,
        fullLine: line,
      };
    }

    return null;
  }

  /**
   * Remove duplicate commands
   */
  private deduplicateCommands(commands: CliCommand[]): CliCommand[] {
    const seen = new Set<string>();
    return commands.filter(cmd => {
      const key = cmd.fullLine.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ============================================
  // CONFIG BLOCK EXTRACTION
  // ============================================

  /**
   * Extract configuration blocks from text
   */
  extractConfigBlocks(text: string): ConfigBlock[] {
    const blocks: ConfigBlock[] = [];

    if (!this.rules.preserveConfigBlocks) {
      return blocks;
    }

    // Cisco config blocks
    const ciscoConfigPattern = /^!\n([\s\S]*?)\n!/gm;
    const ciscoMatches = text.matchAll(ciscoConfigPattern);
    for (const match of ciscoMatches) {
      blocks.push({
        type: 'config',
        language: 'cisco-ios',
        content: match[1].trim(),
        vendor: 'cisco',
      });
    }

    // AWS CloudFormation / JSON blocks
    const jsonPattern = /```(?:json|yaml|cloudformation)?\n([\s\S]*?)```/gm;
    const jsonMatches = text.matchAll(jsonPattern);
    for (const match of jsonMatches) {
      blocks.push({
        type: 'config',
        language: 'json',
        content: match[1].trim(),
      });
    }

    // Generic code blocks
    const codePattern = /```(\w+)?\n([\s\S]*?)```/gm;
    const codeMatches = text.matchAll(codePattern);
    for (const match of codeMatches) {
      blocks.push({
        type: 'code',
        language: match[1] || 'text',
        content: match[2].trim(),
      });
    }

    return blocks;
  }

  // ============================================
  // CONTENT VALIDATION
  // ============================================

  /**
   * Validate AI-generated content against source document
   */
  validateContent(
    generatedContent: string,
    sourceContent: string,
    vendor: VendorId
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let confidence = 1.0;

    // Check for potential hallucinations
    const hallucinations = this.detectHallucinations(generatedContent, sourceContent);
    for (const h of hallucinations) {
      errors.push({
        type: 'hallucination',
        message: `Potential hallucination detected: "${h.text}"`,
        suggestion: 'Verify this information exists in the source document',
      });
      confidence -= 0.1;
    }

    // Validate CLI commands (vendor-specific)
    if (this.rules.preserveCliCommands) {
      const cliValidation = this.validateCliCommands(generatedContent, vendor);
      errors.push(...cliValidation.errors);
      warnings.push(...cliValidation.warnings);
      confidence -= cliValidation.errors.length * 0.05;
    }

    // Check factual consistency
    const factualIssues = this.checkFactualConsistency(generatedContent, sourceContent);
    errors.push(...factualIssues);
    confidence -= factualIssues.length * 0.1;

    return {
      isValid: errors.filter(e => e.type !== 'hallucination').length === 0,
      errors,
      warnings,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  }

  /**
   * Detect potential hallucinations in generated content
   */
  private detectHallucinations(generated: string, source: string): { text: string; reason: string }[] {
    const hallucinations: { text: string; reason: string }[] = [];
    const sourceLower = source.toLowerCase();

    // Check for specific numeric claims
    const numericClaims = generated.match(/\b(\d{3,})\b/g) || [];
    for (const num of numericClaims) {
      if (!sourceLower.includes(num)) {
        hallucinations.push({
          text: num,
          reason: 'Numeric value not found in source',
        });
      }
    }

    // Check for specific version numbers
    const versionPatterns = /\b(v?\d+\.\d+(?:\.\d+)?)\b/g;
    const versions = generated.match(versionPatterns) || [];
    for (const version of versions) {
      if (!sourceLower.includes(version.toLowerCase())) {
        hallucinations.push({
          text: version,
          reason: 'Version number not found in source',
        });
      }
    }

    // Check for proper nouns/product names that might be fabricated
    const properNouns = generated.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
    for (const noun of properNouns) {
      const nounLower = noun.toLowerCase();
      // Only flag if it looks like a product/technology name
      if (
        !sourceLower.includes(nounLower) &&
        (noun.includes('Cloud') || noun.includes('Server') || noun.includes('Platform'))
      ) {
        hallucinations.push({
          text: noun,
          reason: 'Product name not found in source',
        });
      }
    }

    return hallucinations.slice(0, 10); // Limit to top 10
  }

  /**
   * Validate CLI command syntax for a specific vendor
   */
  private validateCliCommands(
    content: string,
    vendor: VendorId
  ): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const commands = this.extractCliCommands(content);

    for (const cmd of commands) {
      // Vendor-specific validation
      switch (vendor) {
        case 'cisco':
          if (cmd.command.startsWith('show') && !cmd.prompt.includes('#')) {
            warnings.push({
              type: 'vendor-specific',
              message: `Command "${cmd.command}" typically requires privileged mode (#)`,
            });
          }
          break;
        case 'aws':
          if (cmd.command.startsWith('aws') && !cmd.command.includes('--region')) {
            warnings.push({
              type: 'vendor-specific',
              message: `AWS command may need --region flag: "${cmd.command}"`,
            });
          }
          break;
      }
    }

    return { errors, warnings };
  }

  /**
   * Check factual consistency between generated and source content
   */
  private checkFactualConsistency(generated: string, source: string): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check for contradictions (simple heuristic)
    const sourceFacts = this.extractKeyFacts(source);
    const generatedFacts = this.extractKeyFacts(generated);

    for (const genFact of generatedFacts) {
      // Look for potential contradictions
      const potentialContradiction = sourceFacts.find(
        sf => this.arePotentiallyContradictory(sf, genFact)
      );
      if (potentialContradiction) {
        errors.push({
          type: 'factual',
          message: `Potential inconsistency detected`,
          location: genFact,
          suggestion: `Verify against source: "${potentialContradiction}"`,
        });
      }
    }

    return errors;
  }

  /**
   * Extract key facts from text (simplified)
   */
  private extractKeyFacts(text: string): string[] {
    const facts: string[] = [];
    
    // Extract sentences with numbers or specific claims
    const sentences = text.split(/[.!?]+/);
    for (const sentence of sentences) {
      if (/\d+|always|never|must|required|maximum|minimum/i.test(sentence)) {
        facts.push(sentence.trim());
      }
    }

    return facts.slice(0, 50);
  }

  /**
   * Check if two facts might be contradictory
   */
  private arePotentiallyContradictory(fact1: string, fact2: string): boolean {
    // Simple contradiction detection
    const f1Lower = fact1.toLowerCase();
    const f2Lower = fact2.toLowerCase();

    // Check for opposite statements
    if (f1Lower.includes('always') && f2Lower.includes('never')) return true;
    if (f1Lower.includes('never') && f2Lower.includes('always')) return true;
    if (f1Lower.includes('must') && f2Lower.includes('must not')) return true;
    if (f1Lower.includes('required') && f2Lower.includes('optional')) return true;

    // Check for conflicting numbers on same topic
    const topics = ['port', 'vlan', 'ip', 'mask', 'metric', 'cost', 'priority'];
    for (const topic of topics) {
      if (f1Lower.includes(topic) && f2Lower.includes(topic)) {
        const num1 = f1Lower.match(/\d+/);
        const num2 = f2Lower.match(/\d+/);
        if (num1 && num2 && num1[0] !== num2[0]) {
          return true;
        }
      }
    }

    return false;
  }

  // ============================================
  // OUTPUT FORMATTING
  // ============================================

  /**
   * Format content according to vendor rules and mode
   */
  formatOutput(content: string, cliCommands: CliCommand[], configBlocks: ConfigBlock[]): string {
    let formatted = content;

    // Preserve CLI commands in code blocks
    if (this.rules.preserveCliCommands && cliCommands.length > 0) {
      const cliSection = this.formatCliSection(cliCommands);
      formatted += '\n\n' + cliSection;
    }

    // Preserve config blocks
    if (this.rules.preserveConfigBlocks && configBlocks.length > 0) {
      const configSection = this.formatConfigSection(configBlocks);
      formatted += '\n\n' + configSection;
    }

    // Apply mode-specific formatting
    formatted = this.applyModeFormatting(formatted);

    return formatted;
  }

  /**
   * Format CLI commands section
   */
  private formatCliSection(commands: CliCommand[]): string {
    const title = this.language === 'ar' ? '## 💻 أوامر CLI' : '## 💻 CLI Commands Reference';
    
    let section = `${title}\n\n`;
    section += '```\n';
    
    for (const cmd of commands) {
      section += cmd.fullLine + '\n';
    }
    
    section += '```\n';
    return section;
  }

  /**
   * Format configuration blocks section
   */
  private formatConfigSection(blocks: ConfigBlock[]): string {
    const title = this.language === 'ar' ? '## ⚙️ كتل التكوين' : '## ⚙️ Configuration Blocks';
    
    let section = `${title}\n\n`;
    
    for (const block of blocks) {
      section += `### ${block.context || block.language}\n\n`;
      section += `\`\`\`${block.language}\n`;
      section += block.content + '\n';
      section += '```\n\n';
    }
    
    return section;
  }

  /**
   * Apply mode-specific formatting rules
   */
  private applyModeFormatting(content: string): string {
    switch (this.mode) {
      case 'study':
        return this.formatForStudy(content);
      case 'quiz':
        return this.formatForQuiz(content);
      case 'interview':
        return this.formatForInterview(content);
      case 'video':
        return this.formatForVideo(content);
      case 'labs':
        return this.formatForLabs(content);
      default:
        return content;
    }
  }

  private formatForStudy(content: string): string {
    // Add study-specific formatting
    // Numbered steps, highlighted key terms, etc.
    return content;
  }

  private formatForQuiz(content: string): string {
    // Quiz formatting is handled by quiz generator
    return content;
  }

  private formatForInterview(content: string): string {
    // Interview question formatting
    return content;
  }

  private formatForVideo(content: string): string {
    // Video script formatting
    return content;
  }

  private formatForLabs(content: string): string {
    // Lab instructions formatting
    // Add step numbers, validation checkpoints
    return content;
  }

  // ============================================
  // GROUNDING ENFORCEMENT
  // ============================================

  /**
   * Build system prompt with grounding rules
   */
  buildGroundedSystemPrompt(): string {
    const vendorName = this.vendorConfig.name;
    const rules = this.rules;

    let prompt = '';

    if (rules.useStrictGrounding) {
      prompt += `STRICT GROUNDING RULES:
- ONLY use information from the provided document
- DO NOT add external knowledge, examples, or explanations not in the document
- If information is incomplete, say "Document does not specify" rather than guessing
- Preserve technical accuracy exactly as stated in the document
- Quote or paraphrase directly from the source when possible

`;
    }

    if (!rules.allowExternalKnowledge) {
      prompt += `KNOWLEDGE RESTRICTION:
- DO NOT supplement with general ${vendorName} knowledge
- DO NOT add best practices unless explicitly stated in the document
- DO NOT reference documentation or resources not mentioned
- Keep all technical claims traceable to the source document

`;
    }

    if (rules.preserveCliCommands) {
      prompt += `CLI COMMAND RULES:
- Preserve ALL CLI command syntax EXACTLY as shown
- Include command prompts (${vendorName === 'Cisco Systems' ? 'Router#, Switch>, (config)#' : 'relevant prompts'})
- Do NOT modify, simplify, or explain away command syntax
- Include output examples when shown in the document

`;
    }

    if (rules.preserveConfigBlocks) {
      prompt += `CONFIGURATION RULES:
- Preserve configuration blocks in their entirety
- Maintain proper indentation and formatting
- Include comments and annotations from the source
- Do NOT summarize or truncate configuration examples

`;
    }

    // Add vendor-specific instructions
    for (const instruction of rules.specialInstructions) {
      prompt += `- ${instruction}\n`;
    }

    return prompt;
  }

  /**
   * Get processing instructions for the current mode
   */
  getModeInstructions(): string {
    const modeInstructions: Record<RuleEngineConfig['mode'], string> = {
      study: `OUTPUT FORMAT: Study Guide
- Organize content in clear sections with headers
- Use numbered steps for procedures
- Highlight key terms and definitions
- Include "Key Takeaways" at section ends
- Add review questions based on content`,

      quiz: `OUTPUT FORMAT: Quiz Questions
- Generate multiple choice questions (4 options each)
- Include scenario-based questions
- Cover all major topics from the document
- Provide explanations for correct answers
- Reference page/section numbers`,

      interview: `OUTPUT FORMAT: Interview Questions
- Generate technical interview questions
- Include behavioral questions related to the content
- Provide sample answers with key points
- Add follow-up question suggestions
- Rate questions by difficulty`,

      video: `OUTPUT FORMAT: Video Script
- Create narration script with timestamps
- Define visual cues and transitions
- Include key points for on-screen text
- Structure into clear scenes/sections
- Keep language conversational`,

      labs: `OUTPUT FORMAT: Lab Exercise
- List clear objectives
- Provide step-by-step instructions
- Include validation commands/checks
- Add expected outputs
- Include troubleshooting tips`,

      summary: `OUTPUT FORMAT: Document Summary
- Begin with an executive summary (2-3 sentences)
- List key points in bullet format
- Include important definitions/terms
- Summarize each major section
- Add conclusions and takeaways`,

      flashcards: `OUTPUT FORMAT: Flashcard Set
- Create question/answer pairs
- Keep fronts concise (questions or terms)
- Keep backs clear and memorable
- Include CLI commands for technical content
- Return as JSON with "flashcards" array`,
    };

    return modeInstructions[this.mode];
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createRuleEngine(config: RuleEngineConfig): RuleEngine {
  return new RuleEngine(config);
}
