/**
 * Validation & Accuracy Layer
 * 
 * Multi-layer validation to prevent hallucinations:
 * - Source grounding verification
 * - Factual consistency checks
 * - CLI syntax validation
 * - Vendor-specific accuracy checks
 */

import { VendorId, VendorDetectionResult } from './types';
import { VENDOR_CONFIGS } from './vendorDetector';

// ============================================
// TYPES
// ============================================

export interface ValidationReport {
  isValid: boolean;
  overallScore: number;  // 0-100
  checks: ValidationCheck[];
  corrections: Correction[];
  warnings: Warning[];
  summary: string;
}

export interface ValidationCheck {
  name: string;
  category: 'grounding' | 'factual' | 'syntax' | 'consistency' | 'vendor';
  passed: boolean;
  score: number;
  details: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface Correction {
  type: 'factual' | 'syntax' | 'terminology' | 'formatting';
  original: string;
  suggested: string;
  reason: string;
  location?: string;
  confidence: number;
}

export interface Warning {
  type: 'potential-hallucination' | 'unverified-claim' | 'outdated-info' | 'vendor-mismatch';
  message: string;
  context: string;
  suggestion: string;
}

export interface GroundingResult {
  isGrounded: boolean;
  groundedPercentage: number;
  ungroundedClaims: UngroundedClaim[];
}

export interface UngroundedClaim {
  claim: string;
  type: 'number' | 'fact' | 'procedure' | 'command' | 'term';
  foundInSource: boolean;
  confidence: number;
}

// ============================================
// VALIDATION LAYER CLASS
// ============================================

export class ValidationLayer {
  private sourceContent: string = '';
  private vendor: VendorDetectionResult | undefined;

  /**
   * Full validation of generated content
   */
  validate(
    generatedContent: string,
    sourceContent: string,
    vendor?: VendorDetectionResult
  ): ValidationReport {
    this.sourceContent = sourceContent.toLowerCase();
    this.vendor = vendor;

    const checks: ValidationCheck[] = [];
    const corrections: Correction[] = [];
    const warnings: Warning[] = [];

    // Run all validation checks
    checks.push(this.checkSourceGrounding(generatedContent));
    checks.push(this.checkFactualAccuracy(generatedContent));
    checks.push(this.checkNumericalAccuracy(generatedContent));
    checks.push(this.checkTerminologyConsistency(generatedContent));
    
    if (vendor?.detected) {
      checks.push(this.checkVendorAccuracy(generatedContent, vendor));
      checks.push(this.checkCliSyntax(generatedContent, vendor.vendorId));
    }

    checks.push(this.checkLogicalConsistency(generatedContent));
    checks.push(this.checkCompleteness(generatedContent));

    // Collect corrections and warnings
    const groundingResult = this.analyzeGrounding(generatedContent);
    for (const claim of groundingResult.ungroundedClaims) {
      if (!claim.foundInSource) {
        warnings.push({
          type: 'potential-hallucination',
          message: `Claim not found in source: "${claim.claim}"`,
          context: claim.type,
          suggestion: 'Verify this information or remove if not in source document',
        });
      }
    }

    // Calculate overall score
    const validChecks = checks.filter(c => c.passed);
    const criticalFailed = checks.filter(c => !c.passed && c.severity === 'critical');
    
    let overallScore = (validChecks.length / checks.length) * 100;
    overallScore -= criticalFailed.length * 20;  // Heavy penalty for critical failures
    overallScore = Math.max(0, Math.min(100, overallScore));

    const isValid = criticalFailed.length === 0 && overallScore >= 70;

    return {
      isValid,
      overallScore,
      checks,
      corrections,
      warnings,
      summary: this.generateSummary(checks, overallScore),
    };
  }

  /**
   * Quick validation (fewer checks, faster)
   */
  quickValidate(
    generatedContent: string,
    sourceContent: string
  ): { isValid: boolean; score: number; issues: string[] } {
    this.sourceContent = sourceContent.toLowerCase();
    
    const issues: string[] = [];
    let score = 100;

    // Check for obvious hallucinations (numbers not in source)
    const numbers = generatedContent.match(/\b\d{3,}\b/g) || [];
    for (const num of numbers) {
      if (!this.sourceContent.includes(num)) {
        issues.push(`Number ${num} not found in source`);
        score -= 10;
      }
    }

    // Check for made-up product names
    const productNames = generatedContent.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g) || [];
    for (const name of productNames.slice(0, 10)) {
      if (!this.sourceContent.includes(name.toLowerCase()) && 
          (name.includes('Cloud') || name.includes('Server') || name.includes('Platform'))) {
        issues.push(`Product name "${name}" may be fabricated`);
        score -= 5;
      }
    }

    return {
      isValid: score >= 70 && issues.length < 5,
      score: Math.max(0, score),
      issues,
    };
  }

  // ============================================
  // VALIDATION CHECKS
  // ============================================

  /**
   * Check if content is grounded in source
   */
  private checkSourceGrounding(content: string): ValidationCheck {
    const result = this.analyzeGrounding(content);
    
    return {
      name: 'Source Grounding',
      category: 'grounding',
      passed: result.groundedPercentage >= 80,
      score: result.groundedPercentage,
      details: `${result.groundedPercentage.toFixed(1)}% of claims are grounded in source document. ${result.ungroundedClaims.length} ungrounded claims found.`,
      severity: result.groundedPercentage < 60 ? 'critical' : 'major',
    };
  }

  /**
   * Check factual accuracy against source
   */
  private checkFactualAccuracy(content: string): ValidationCheck {
    const facts = this.extractFacts(content);
    let verifiedCount = 0;

    for (const fact of facts) {
      if (this.verifyFact(fact)) {
        verifiedCount++;
      }
    }

    const accuracy = facts.length > 0 ? (verifiedCount / facts.length) * 100 : 100;

    return {
      name: 'Factual Accuracy',
      category: 'factual',
      passed: accuracy >= 85,
      score: accuracy,
      details: `${verifiedCount}/${facts.length} facts verified against source`,
      severity: accuracy < 70 ? 'critical' : 'major',
    };
  }

  /**
   * Check numerical accuracy
   */
  private checkNumericalAccuracy(content: string): ValidationCheck {
    const numbers = content.match(/\b\d+(?:\.\d+)?(?:\s*(?:MB|GB|TB|ms|seconds|minutes|hours|%|port|vlan|mask))?\b/gi) || [];
    let verifiedCount = 0;
    const issues: string[] = [];

    for (const num of numbers) {
      const numOnly = num.match(/\d+(?:\.\d+)?/)?.[0] || '';
      if (this.sourceContent.includes(numOnly)) {
        verifiedCount++;
      } else {
        issues.push(num);
      }
    }

    const accuracy = numbers.length > 0 ? (verifiedCount / numbers.length) * 100 : 100;

    return {
      name: 'Numerical Accuracy',
      category: 'factual',
      passed: accuracy >= 90,
      score: accuracy,
      details: `${verifiedCount}/${numbers.length} numbers verified. Issues: ${issues.slice(0, 5).join(', ')}`,
      severity: accuracy < 80 ? 'critical' : 'minor',
    };
  }

  /**
   * Check terminology consistency
   */
  private checkTerminologyConsistency(content: string): ValidationCheck {
    const terms = content.match(/\b[A-Z][a-z]+(?:\s+[A-Za-z]+)*\b/g) || [];
    const uniqueTerms = [...new Set(terms)];
    let consistentCount = 0;

    for (const term of uniqueTerms) {
      // Check if term appears consistently in source
      if (this.sourceContent.includes(term.toLowerCase())) {
        consistentCount++;
      }
    }

    const consistency = uniqueTerms.length > 0 ? (consistentCount / uniqueTerms.length) * 100 : 100;

    return {
      name: 'Terminology Consistency',
      category: 'consistency',
      passed: consistency >= 80,
      score: consistency,
      details: `${consistentCount}/${uniqueTerms.length} terms consistent with source`,
      severity: 'minor',
    };
  }

  /**
   * Check vendor-specific accuracy
   */
  private checkVendorAccuracy(content: string, vendor: VendorDetectionResult): ValidationCheck {
    const vendorConfig = VENDOR_CONFIGS[vendor.vendorId];
    let score = 100;
    const issues: string[] = [];

    // Check if correct vendor terminology is used
    const vendorKeywords = vendorConfig.keywords;
    let keywordMatches = 0;

    for (const keyword of vendorKeywords.slice(0, 20)) {
      if (content.toLowerCase().includes(keyword.toLowerCase())) {
        keywordMatches++;
      }
    }

    // Check for competitor terminology (potential confusion)
    const competitors: Record<VendorId, string[]> = {
      cisco: ['juniper', 'arista', 'huawei'],
      aws: ['azure', 'google cloud', 'gcp'],
      microsoft: ['aws', 'google cloud', 'gcp'],
      google: ['aws', 'azure'],
      juniper: ['cisco', 'arista'],
      paloalto: ['fortinet', 'checkpoint'],
      fortinet: ['paloalto', 'checkpoint'],
      vmware: ['hyper-v', 'proxmox'],
      redhat: ['ubuntu', 'debian', 'suse'],
      comptia: [],
      oracle: ['mysql', 'postgresql'],
      generic: [],
    };

    const competitorTerms = competitors[vendor.vendorId] || [];
    for (const comp of competitorTerms) {
      if (content.toLowerCase().includes(comp) && !this.sourceContent.includes(comp)) {
        issues.push(`Competitor term "${comp}" found but not in source`);
        score -= 10;
      }
    }

    return {
      name: 'Vendor Accuracy',
      category: 'vendor',
      passed: score >= 80,
      score: Math.max(0, score),
      details: `${vendorConfig.name} terminology check. ${issues.length > 0 ? issues.join('; ') : 'No issues'}`,
      severity: score < 70 ? 'major' : 'minor',
    };
  }

  /**
   * Check CLI syntax accuracy
   */
  private checkCliSyntax(content: string, vendorId: VendorId): ValidationCheck {
    const vendorConfig = VENDOR_CONFIGS[vendorId];
    const cliPatterns = vendorConfig.cliPatterns;
    
    // Extract CLI commands from content
    const cliLines: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (/^[A-Za-z0-9_-]+[#>]\s*/.test(line) || /^\$\s+/.test(line)) {
        cliLines.push(line.trim());
      }
    }

    let validCount = 0;
    const issues: string[] = [];

    for (const cliLine of cliLines) {
      // Check if command exists in source (should be preserved exactly)
      if (this.sourceContent.includes(cliLine.toLowerCase())) {
        validCount++;
      } else {
        // Check against patterns
        let matchesPattern = false;
        for (const pattern of cliPatterns) {
          if (pattern.test(cliLine)) {
            matchesPattern = true;
            break;
          }
        }
        if (matchesPattern) {
          validCount++;
        } else {
          issues.push(cliLine.substring(0, 50));
        }
      }
    }

    const accuracy = cliLines.length > 0 ? (validCount / cliLines.length) * 100 : 100;

    return {
      name: 'CLI Syntax',
      category: 'syntax',
      passed: accuracy >= 95,
      score: accuracy,
      details: `${validCount}/${cliLines.length} CLI commands validated. ${issues.length > 0 ? 'Issues: ' + issues.slice(0, 3).join('; ') : ''}`,
      severity: accuracy < 90 ? 'critical' : 'minor',
    };
  }

  /**
   * Check logical consistency
   */
  private checkLogicalConsistency(content: string): ValidationCheck {
    let score = 100;
    const issues: string[] = [];

    // Check for contradictions
    const contradictions = this.findContradictions(content);
    for (const c of contradictions) {
      issues.push(c);
      score -= 15;
    }

    // Check for incomplete procedures
    const procedures = content.match(/step\s+\d+/gi) || [];
    if (procedures.length > 0) {
      const stepNumbers = procedures.map(p => parseInt(p.match(/\d+/)?.[0] || '0'));
      const maxStep = Math.max(...stepNumbers);
      const hasAllSteps = stepNumbers.length === maxStep;
      if (!hasAllSteps) {
        issues.push('Procedure may have missing steps');
        score -= 10;
      }
    }

    return {
      name: 'Logical Consistency',
      category: 'consistency',
      passed: score >= 80,
      score: Math.max(0, score),
      details: issues.length > 0 ? issues.join('; ') : 'No logical inconsistencies found',
      severity: score < 70 ? 'major' : 'minor',
    };
  }

  /**
   * Check completeness
   */
  private checkCompleteness(content: string): ValidationCheck {
    let score = 100;
    const issues: string[] = [];

    // Check for truncation indicators
    if (content.includes('...') || content.includes('[truncated]') || content.includes('[continue')) {
      issues.push('Content appears truncated');
      score -= 20;
    }

    // Check for placeholder text
    const placeholders = ['TODO', 'TBD', 'placeholder', '[insert', '[add'];
    for (const ph of placeholders) {
      if (content.toLowerCase().includes(ph.toLowerCase())) {
        issues.push(`Placeholder found: ${ph}`);
        score -= 10;
      }
    }

    return {
      name: 'Completeness',
      category: 'consistency',
      passed: score >= 90,
      score: Math.max(0, score),
      details: issues.length > 0 ? issues.join('; ') : 'Content appears complete',
      severity: score < 80 ? 'major' : 'minor',
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Analyze grounding of content
   */
  private analyzeGrounding(content: string): GroundingResult {
    const claims = this.extractClaims(content);
    const ungroundedClaims: UngroundedClaim[] = [];
    let groundedCount = 0;

    for (const claim of claims) {
      const foundInSource = this.isClaimGrounded(claim.text);
      if (foundInSource) {
        groundedCount++;
      } else {
        ungroundedClaims.push({
          claim: claim.text,
          type: claim.type,
          foundInSource: false,
          confidence: this.calculateGroundingConfidence(claim.text),
        });
      }
    }

    return {
      isGrounded: ungroundedClaims.length === 0,
      groundedPercentage: claims.length > 0 ? (groundedCount / claims.length) * 100 : 100,
      ungroundedClaims,
    };
  }

  /**
   * Extract claims from content
   */
  private extractClaims(content: string): { text: string; type: UngroundedClaim['type'] }[] {
    const claims: { text: string; type: UngroundedClaim['type'] }[] = [];

    // Extract numerical claims
    const numbers = content.match(/\b\d+(?:\.\d+)?(?:\s*(?:MB|GB|TB|ms|%|port|vlan))?\b/gi) || [];
    for (const num of numbers.slice(0, 20)) {
      claims.push({ text: num, type: 'number' });
    }

    // Extract command claims
    const commands = content.match(/^[A-Za-z0-9_-]+[#>]\s*.+$/gm) || [];
    for (const cmd of commands.slice(0, 10)) {
      claims.push({ text: cmd, type: 'command' });
    }

    // Extract factual sentences
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    for (const sentence of sentences.slice(0, 15)) {
      if (/\b(is|are|was|were|always|never|must|required)\b/i.test(sentence)) {
        claims.push({ text: sentence.trim().substring(0, 100), type: 'fact' });
      }
    }

    return claims;
  }

  /**
   * Check if a claim is grounded in source
   */
  private isClaimGrounded(claim: string): boolean {
    const claimLower = claim.toLowerCase();
    
    // Direct match
    if (this.sourceContent.includes(claimLower)) {
      return true;
    }

    // Fuzzy match - check if key words are present
    const words = claimLower.split(/\s+/).filter(w => w.length > 3);
    const matchedWords = words.filter(w => this.sourceContent.includes(w));
    return matchedWords.length / words.length >= 0.7;
  }

  /**
   * Calculate grounding confidence
   */
  private calculateGroundingConfidence(claim: string): number {
    const words = claim.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matchedWords = words.filter(w => this.sourceContent.includes(w));
    return matchedWords.length / Math.max(words.length, 1);
  }

  /**
   * Extract facts from content
   */
  private extractFacts(content: string): string[] {
    const sentences = content.split(/[.!?]+/);
    return sentences
      .filter(s => /\b(is|are|has|have|can|will|must)\b/i.test(s))
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 200)
      .slice(0, 30);
  }

  /**
   * Verify a fact against source
   */
  private verifyFact(fact: string): boolean {
    const factLower = fact.toLowerCase();
    const keywords = factLower.split(/\s+/).filter(w => w.length > 4);
    
    let matchCount = 0;
    for (const keyword of keywords) {
      if (this.sourceContent.includes(keyword)) {
        matchCount++;
      }
    }

    return keywords.length > 0 && matchCount / keywords.length >= 0.6;
  }

  /**
   * Find contradictions in content
   */
  private findContradictions(content: string): string[] {
    const contradictions: string[] = [];
    const sentences = content.split(/[.!?]+/).map(s => s.trim().toLowerCase());

    // Look for opposite statements
    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        if (this.areContradictory(sentences[i], sentences[j])) {
          contradictions.push(`Potential contradiction between statements ${i + 1} and ${j + 1}`);
        }
      }
    }

    return contradictions.slice(0, 5);
  }

  /**
   * Check if two sentences are contradictory
   */
  private areContradictory(s1: string, s2: string): boolean {
    // Simple contradiction detection
    const opposites = [
      ['always', 'never'],
      ['must', 'must not'],
      ['required', 'optional'],
      ['enabled', 'disabled'],
      ['true', 'false'],
      ['yes', 'no'],
    ];

    for (const [word1, word2] of opposites) {
      if ((s1.includes(word1) && s2.includes(word2)) ||
          (s1.includes(word2) && s2.includes(word1))) {
        // Check if they're talking about the same topic
        const s1Words = new Set(s1.split(/\s+/));
        const s2Words = new Set(s2.split(/\s+/));
        const overlap = [...s1Words].filter(w => s2Words.has(w) && w.length > 4);
        if (overlap.length >= 2) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Generate summary
   */
  private generateSummary(checks: ValidationCheck[], score: number): string {
    const passed = checks.filter(c => c.passed).length;
    const failed = checks.filter(c => !c.passed).length;
    const critical = checks.filter(c => !c.passed && c.severity === 'critical').length;

    if (critical > 0) {
      return `⚠️ Critical issues found: ${critical} critical checks failed. Score: ${score.toFixed(0)}/100. Review required.`;
    }
    if (score >= 90) {
      return `✅ Excellent: ${passed}/${checks.length} checks passed. Score: ${score.toFixed(0)}/100. Content is well-grounded.`;
    }
    if (score >= 70) {
      return `✓ Good: ${passed}/${checks.length} checks passed. Score: ${score.toFixed(0)}/100. Minor issues detected.`;
    }
    return `⚠️ Needs Review: ${failed} checks failed. Score: ${score.toFixed(0)}/100. Significant grounding issues.`;
  }
}

// ============================================
// EXPORTS
// ============================================

export function validateContent(
  generatedContent: string,
  sourceContent: string,
  vendor?: VendorDetectionResult
): ValidationReport {
  const validator = new ValidationLayer();
  return validator.validate(generatedContent, sourceContent, vendor);
}

export function quickValidate(
  generatedContent: string,
  sourceContent: string
): { isValid: boolean; score: number; issues: string[] } {
  const validator = new ValidationLayer();
  return validator.quickValidate(generatedContent, sourceContent);
}
