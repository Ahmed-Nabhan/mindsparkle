/**
 * Video Pipeline - Storyboard Generator
 * 
 * Generates video content from documents:
 * - Storyboard with scenes
 * - Voice scripts (TTS-ready)
 * - Visual prompts for graphics
 * - Timing and transitions
 */

import { VendorDetectionResult } from './types';
import { vendorDetector } from './vendorDetector';

// ============================================
// TYPES
// ============================================

export interface Storyboard {
  title: string;
  totalDuration: number;  // seconds
  scenes: Scene[];
  metadata: StoryboardMetadata;
}

export interface Scene {
  id: number;
  title: string;
  startTime: number;      // seconds
  duration: number;       // seconds
  type: SceneType;
  narration: NarrationScript;
  visuals: VisualPrompt[];
  keyPoints: string[];
  transitions: Transition;
  pageRef?: number;
}

export type SceneType = 
  | 'intro'
  | 'concept'
  | 'demo'
  | 'cli'
  | 'diagram'
  | 'summary'
  | 'quiz'
  | 'conclusion';

export interface NarrationScript {
  text: string;
  estimatedDuration: number;  // seconds
  ttsInstructions: TTSInstructions;
  language: 'en' | 'ar';
}

export interface TTSInstructions {
  voice: string;
  rate: number;    // 0.5 - 2.0
  pitch: number;   // 0.5 - 2.0
  emphasis: EmphasisMarker[];
  pauses: PauseMarker[];
}

export interface EmphasisMarker {
  word: string;
  type: 'strong' | 'moderate' | 'reduced';
}

export interface PauseMarker {
  afterWord: string;
  duration: 'short' | 'medium' | 'long';  // 0.5s, 1s, 2s
}

export interface VisualPrompt {
  type: VisualType;
  description: string;
  duration: number;
  position: 'full' | 'left' | 'right' | 'overlay';
  animation?: string;
  content?: string;  // For text overlays or code
}

export type VisualType = 
  | 'title-card'
  | 'text-overlay'
  | 'bullet-points'
  | 'code-block'
  | 'diagram'
  | 'comparison-table'
  | 'image'
  | 'animation'
  | 'screen-recording'
  | 'avatar';

export interface Transition {
  type: 'cut' | 'fade' | 'slide' | 'zoom' | 'dissolve';
  duration: number;
}

export interface StoryboardMetadata {
  documentTitle: string;
  vendor?: VendorDetectionResult;
  targetAudience: string;
  style: 'educational' | 'tutorial' | 'overview' | 'explainer';
  generatedAt: Date;
  wordCount: number;
  estimatedReadingTime: number;
}

// ============================================
// VOICE SCRIPT TYPES
// ============================================

export interface VoiceScript {
  fullScript: string;
  segments: VoiceSegment[];
  totalDuration: number;
  language: 'en' | 'ar';
  recommendedVoice: VoiceRecommendation;
}

export interface VoiceSegment {
  sceneId: number;
  text: string;
  ssml: string;  // SSML markup for TTS
  duration: number;
}

export interface VoiceRecommendation {
  provider: 'google' | 'azure' | 'amazon' | 'elevenlabs';
  voiceId: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  style: 'professional' | 'friendly' | 'authoritative';
}

// ============================================
// STORYBOARD GENERATOR
// ============================================

export class StoryboardGenerator {
  private vendor: VendorDetectionResult | undefined;
  private language: 'en' | 'ar' = 'en';
  private style: StoryboardMetadata['style'] = 'educational';

  /**
   * Generate storyboard from content
   */
  generate(
    content: string,
    title: string,
    options: {
      language?: 'en' | 'ar';
      style?: StoryboardMetadata['style'];
      targetDuration?: number;  // minutes
      vendor?: VendorDetectionResult;
    } = {}
  ): Storyboard {
    this.language = options.language || 'en';
    this.style = options.style || 'educational';
    this.vendor = options.vendor || vendorDetector.detect(content);

    const targetDurationSeconds = (options.targetDuration || 10) * 60;

    // Parse content into sections
    const sections = this.parseContentSections(content);

    // Generate scenes
    const scenes = this.generateScenes(sections, targetDurationSeconds);

    // Calculate actual duration
    const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

    return {
      title,
      totalDuration,
      scenes,
      metadata: {
        documentTitle: title,
        vendor: this.vendor,
        targetAudience: this.determineAudience(),
        style: this.style,
        generatedAt: new Date(),
        wordCount: content.split(/\s+/).length,
        estimatedReadingTime: Math.ceil(content.split(/\s+/).length / 200),
      },
    };
  }

  /**
   * Parse content into logical sections
   */
  private parseContentSections(content: string): ContentSection[] {
    const sections: ContentSection[] = [];
    
    // Split by headers
    const headerPattern = /^(#{1,3})\s+(.+)$/gm;
    let lastIndex = 0;
    let match;
    const matches: { level: number; title: string; index: number }[] = [];

    while ((match = headerPattern.exec(content)) !== null) {
      matches.push({
        level: match[1].length,
        title: match[2].trim(),
        index: match.index,
      });
    }

    // Extract section content
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      const endIndex = next ? next.index : content.length;
      const sectionContent = content.substring(current.index, endIndex).trim();

      sections.push({
        level: current.level,
        title: current.title,
        content: sectionContent,
        type: this.determineSectionType(sectionContent, current.title),
        hasCliCommands: this.hasCliCommands(sectionContent),
        hasBulletPoints: /^[-*]\s+/m.test(sectionContent),
        hasCodeBlocks: /```[\s\S]*```/.test(sectionContent),
      });
    }

    // If no sections found, treat entire content as one section
    if (sections.length === 0) {
      sections.push({
        level: 1,
        title: 'Main Content',
        content,
        type: 'concept',
        hasCliCommands: this.hasCliCommands(content),
        hasBulletPoints: /^[-*]\s+/m.test(content),
        hasCodeBlocks: /```[\s\S]*```/.test(content),
      });
    }

    return sections;
  }

  /**
   * Generate scenes from sections
   */
  private generateScenes(
    sections: ContentSection[],
    targetDuration: number
  ): Scene[] {
    const scenes: Scene[] = [];
    let currentTime = 0;

    // Add intro scene
    scenes.push(this.createIntroScene(sections[0]?.title || 'Document Overview'));
    currentTime += scenes[0].duration;

    // Calculate time per section
    const contentSections = sections.filter(s => s.level <= 2);
    const timePerSection = Math.max(
      30,
      (targetDuration - 60) / Math.max(contentSections.length, 1)  // Reserve 60s for intro/outro
    );

    // Generate content scenes
    for (let i = 0; i < contentSections.length && currentTime < targetDuration - 30; i++) {
      const section = contentSections[i];
      const scene = this.createContentScene(
        section,
        i + 2,  // Scene ID (1 is intro)
        currentTime,
        Math.min(timePerSection, targetDuration - currentTime - 30)
      );
      scenes.push(scene);
      currentTime += scene.duration;
    }

    // Add conclusion scene
    const conclusionScene = this.createConclusionScene(
      scenes.length + 1,
      currentTime,
      sections
    );
    scenes.push(conclusionScene);

    return scenes;
  }

  /**
   * Create intro scene
   */
  private createIntroScene(title: string): Scene {
    const isArabic = this.language === 'ar';
    
    const narrationText = isArabic
      ? `مرحباً بكم في هذا الفيديو التعليمي عن ${title}. ${this.vendor?.detected ? `سنتناول محتوى ${this.vendor.vendorName} بالتفصيل.` : ''} دعونا نبدأ!`
      : `Welcome to this educational video about ${title}. ${this.vendor?.detected ? `We'll be covering ${this.vendor.vendorName} content in detail.` : ''} Let's get started!`;

    return {
      id: 1,
      title: isArabic ? 'المقدمة' : 'Introduction',
      startTime: 0,
      duration: 15,
      type: 'intro',
      narration: this.createNarration(narrationText),
      visuals: [
        {
          type: 'title-card',
          description: `Main title: "${title}"${this.vendor?.detected ? ` with ${this.vendor.vendorName} logo` : ''}`,
          duration: 5,
          position: 'full',
          animation: 'fade-in',
        },
        {
          type: 'bullet-points',
          description: 'Agenda/Topics to be covered',
          duration: 8,
          position: 'full',
          animation: 'slide-in',
        },
      ],
      keyPoints: [isArabic ? 'مقدمة عن الموضوع' : 'Introduction to the topic'],
      transitions: { type: 'fade', duration: 1 },
    };
  }

  /**
   * Create content scene from section
   */
  private createContentScene(
    section: ContentSection,
    id: number,
    startTime: number,
    maxDuration: number
  ): Scene {
    const isArabic = this.language === 'ar';
    
    // Generate narration from section content
    const narrationText = this.generateNarrationFromContent(section);
    const narration = this.createNarration(narrationText);

    // Adjust duration based on narration
    const duration = Math.min(maxDuration, Math.max(20, narration.estimatedDuration + 5));

    // Generate visuals based on content type
    const visuals = this.generateVisuals(section, duration);

    // Extract key points
    const keyPoints = this.extractKeyPoints(section.content);

    return {
      id,
      title: section.title,
      startTime,
      duration,
      type: section.type,
      narration,
      visuals,
      keyPoints,
      transitions: { type: section.hasCliCommands ? 'cut' : 'fade', duration: 0.5 },
    };
  }

  /**
   * Create conclusion scene
   */
  private createConclusionScene(
    id: number,
    startTime: number,
    sections: ContentSection[]
  ): Scene {
    const isArabic = this.language === 'ar';
    
    const keyTopics = sections
      .filter(s => s.level <= 2)
      .map(s => s.title)
      .slice(0, 5);

    const narrationText = isArabic
      ? `في الختام، تناولنا في هذا الفيديو: ${keyTopics.join('، ')}. شكراً لمتابعتكم!`
      : `To summarize, in this video we covered: ${keyTopics.join(', ')}. Thanks for watching!`;

    return {
      id,
      title: isArabic ? 'الخلاصة' : 'Conclusion',
      startTime,
      duration: 20,
      type: 'conclusion',
      narration: this.createNarration(narrationText),
      visuals: [
        {
          type: 'bullet-points',
          description: 'Key takeaways summary',
          duration: 12,
          position: 'full',
          animation: 'fade-in',
          content: keyTopics.join('\n'),
        },
        {
          type: 'title-card',
          description: 'Thank you / Subscribe card',
          duration: 6,
          position: 'full',
          animation: 'zoom',
        },
      ],
      keyPoints: keyTopics,
      transitions: { type: 'fade', duration: 1.5 },
    };
  }

  /**
   * Generate narration from content
   */
  private generateNarrationFromContent(section: ContentSection): string {
    const isArabic = this.language === 'ar';
    let narration = '';

    // Add section intro
    if (isArabic) {
      narration = `الآن دعونا نتحدث عن ${section.title}. `;
    } else {
      narration = `Now let's talk about ${section.title}. `;
    }

    // Extract main points from content (simplified - actual would use AI)
    const sentences = section.content
      .replace(/^#+\s+.+$/gm, '')  // Remove headers
      .replace(/```[\s\S]*?```/g, '')  // Remove code blocks
      .replace(/\n+/g, ' ')
      .split(/[.!?]+/)
      .filter(s => s.trim().length > 20)
      .slice(0, 5);

    narration += sentences.join('. ').trim();

    if (section.hasCliCommands) {
      narration += isArabic
        ? ' دعونا نلقي نظرة على الأوامر المطلوبة.'
        : ' Let\'s look at the commands involved.';
    }

    return narration;
  }

  /**
   * Create narration object with TTS instructions
   */
  private createNarration(text: string): NarrationScript {
    const wordsPerMinute = this.language === 'ar' ? 120 : 150;
    const wordCount = text.split(/\s+/).length;
    const duration = (wordCount / wordsPerMinute) * 60;

    // Generate TTS instructions
    const emphasis: EmphasisMarker[] = [];
    const pauses: PauseMarker[] = [];

    // Add emphasis on technical terms
    const technicalTerms = text.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    for (const term of technicalTerms.slice(0, 5)) {
      emphasis.push({ word: term, type: 'strong' });
    }

    // Add pauses after sentences
    const sentenceEnders = text.match(/[.!?]/g) || [];
    for (let i = 0; i < Math.min(sentenceEnders.length, 3); i++) {
      pauses.push({ afterWord: '.', duration: 'medium' });
    }

    return {
      text,
      estimatedDuration: duration,
      language: this.language,
      ttsInstructions: {
        voice: this.language === 'ar' ? 'ar-XA-Wavenet-A' : 'en-US-Neural2-D',
        rate: 0.9,
        pitch: 1.0,
        emphasis,
        pauses,
      },
    };
  }

  /**
   * Generate visuals for a scene
   */
  private generateVisuals(section: ContentSection, totalDuration: number): VisualPrompt[] {
    const visuals: VisualPrompt[] = [];
    let remainingTime = totalDuration;

    // Add title
    visuals.push({
      type: 'text-overlay',
      description: `Section title: "${section.title}"`,
      duration: 3,
      position: 'overlay',
      animation: 'slide-in',
      content: section.title,
    });
    remainingTime -= 3;

    // Add code blocks if present
    if (section.hasCodeBlocks || section.hasCliCommands) {
      const codeBlockTime = Math.min(remainingTime * 0.4, 15);
      visuals.push({
        type: 'code-block',
        description: 'CLI commands or code from the section',
        duration: codeBlockTime,
        position: 'full',
        animation: 'type-writer',
      });
      remainingTime -= codeBlockTime;
    }

    // Add bullet points if present
    if (section.hasBulletPoints) {
      const bulletTime = Math.min(remainingTime * 0.5, 10);
      visuals.push({
        type: 'bullet-points',
        description: 'Key points from the section',
        duration: bulletTime,
        position: 'full',
        animation: 'fade-in-sequence',
      });
      remainingTime -= bulletTime;
    }

    // Add diagram placeholder for concept sections
    if (section.type === 'concept' && remainingTime > 5) {
      visuals.push({
        type: 'diagram',
        description: `Conceptual diagram for ${section.title}`,
        duration: Math.min(remainingTime, 8),
        position: 'full',
        animation: 'build',
      });
    }

    return visuals;
  }

  /**
   * Extract key points from content
   */
  private extractKeyPoints(content: string): string[] {
    const keyPoints: string[] = [];

    // Extract bullet points
    const bulletPattern = /^[-*]\s+(.+)$/gm;
    let match;
    while ((match = bulletPattern.exec(content)) !== null && keyPoints.length < 5) {
      keyPoints.push(match[1].trim());
    }

    // Extract bold text as key points
    if (keyPoints.length < 3) {
      const boldPattern = /\*\*([^*]+)\*\*/g;
      while ((match = boldPattern.exec(content)) !== null && keyPoints.length < 5) {
        const point = match[1].trim();
        if (point.length > 10 && !keyPoints.includes(point)) {
          keyPoints.push(point);
        }
      }
    }

    return keyPoints;
  }

  /**
   * Determine section type from content
   */
  private determineSectionType(content: string, title: string): SceneType {
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    if (titleLower.includes('intro') || titleLower.includes('overview')) return 'intro';
    if (titleLower.includes('summar') || titleLower.includes('conclusion')) return 'summary';
    if (titleLower.includes('demo') || titleLower.includes('example')) return 'demo';
    if (titleLower.includes('diagram') || titleLower.includes('architecture')) return 'diagram';
    if (titleLower.includes('quiz') || titleLower.includes('question')) return 'quiz';
    if (this.hasCliCommands(content)) return 'cli';
    
    return 'concept';
  }

  /**
   * Check if content has CLI commands
   */
  private hasCliCommands(content: string): boolean {
    const cliPatterns = [
      /^[A-Za-z0-9_-]+[#>]\s*.+/m,
      /^\$\s+\w+/m,
      /^>\s+\w+/m,
      /```(bash|shell|cisco|cli)/,
    ];
    return cliPatterns.some(p => p.test(content));
  }

  /**
   * Determine target audience
   */
  private determineAudience(): string {
    if (this.vendor?.detected) {
      const certLevel = this.vendor.certificationDetected;
      if (certLevel) {
        if (['CCIE', 'JNCIE', 'RHCA'].some(c => certLevel.includes(c))) {
          return 'Expert-level professionals';
        }
        if (['CCNP', 'JNCIP', 'RHCE'].some(c => certLevel.includes(c))) {
          return 'Professional-level practitioners';
        }
        return 'IT professionals and certification candidates';
      }
      return `${this.vendor.vendorName} professionals and learners`;
    }
    return 'General learners';
  }
}

// ============================================
// VOICE SCRIPT GENERATOR
// ============================================

export class VoiceScriptGenerator {
  /**
   * Generate voice script from storyboard
   */
  generate(storyboard: Storyboard): VoiceScript {
    const segments: VoiceSegment[] = [];
    let fullScript = '';
    let totalDuration = 0;

    for (const scene of storyboard.scenes) {
      const ssml = this.convertToSSML(scene.narration);
      
      segments.push({
        sceneId: scene.id,
        text: scene.narration.text,
        ssml,
        duration: scene.narration.estimatedDuration,
      });

      fullScript += scene.narration.text + '\n\n';
      totalDuration += scene.narration.estimatedDuration;
    }

    return {
      fullScript,
      segments,
      totalDuration,
      language: storyboard.scenes[0]?.narration.language || 'en',
      recommendedVoice: this.recommendVoice(storyboard),
    };
  }

  /**
   * Convert narration to SSML
   */
  private convertToSSML(narration: NarrationScript): string {
    let ssml = '<speak>';
    let text = narration.text;

    // Apply rate
    ssml += `<prosody rate="${narration.ttsInstructions.rate * 100}%">`;

    // Apply emphasis markers
    for (const emphasis of narration.ttsInstructions.emphasis) {
      const level = emphasis.type === 'strong' ? 'strong' : 
                    emphasis.type === 'moderate' ? 'moderate' : 'reduced';
      text = text.replace(
        new RegExp(`\\b${emphasis.word}\\b`, 'gi'),
        `<emphasis level="${level}">${emphasis.word}</emphasis>`
      );
    }

    // Apply pauses
    for (const pause of narration.ttsInstructions.pauses) {
      const duration = pause.duration === 'long' ? '1s' :
                       pause.duration === 'medium' ? '500ms' : '250ms';
      text = text.replace(
        pause.afterWord,
        `${pause.afterWord}<break time="${duration}"/>`
      );
    }

    ssml += text;
    ssml += '</prosody></speak>';

    return ssml;
  }

  /**
   * Recommend voice based on content
   */
  private recommendVoice(storyboard: StoryboardMetadata | Storyboard): VoiceRecommendation {
    const metadata = 'metadata' in storyboard ? storyboard.metadata : storyboard;
    const isArabic = 'scenes' in storyboard && storyboard.scenes[0]?.narration.language === 'ar';

    if (isArabic) {
      return {
        provider: 'google',
        voiceId: 'ar-XA-Wavenet-B',
        language: 'ar-XA',
        gender: 'male',
        style: 'professional',
      };
    }

    return {
      provider: 'google',
      voiceId: 'en-US-Neural2-D',
      language: 'en-US',
      gender: 'male',
      style: metadata.style === 'tutorial' ? 'friendly' : 'professional',
    };
  }
}

// ============================================
// HELPER TYPES
// ============================================

interface ContentSection {
  level: number;
  title: string;
  content: string;
  type: SceneType;
  hasCliCommands: boolean;
  hasBulletPoints: boolean;
  hasCodeBlocks: boolean;
}

// ============================================
// EXPORTS
// ============================================

export function generateStoryboard(
  content: string,
  title: string,
  options?: Parameters<StoryboardGenerator['generate']>[2]
): Storyboard {
  const generator = new StoryboardGenerator();
  return generator.generate(content, title, options);
}

export function generateVoiceScript(storyboard: Storyboard): VoiceScript {
  const generator = new VoiceScriptGenerator();
  return generator.generate(storyboard);
}
