// Audio Service - Text-to-Speech for summaries and flashcards
// Uses Expo Speech API

import * as Speech from 'expo-speech';

export interface AudioSettings {
  rate: number; // 0.5 to 2.0
  pitch: number; // 0.5 to 2.0
  language: string;
  voice?: string;
}

export interface VoiceOption {
  identifier: string;
  name: string;
  language: string;
  quality: 'Default' | 'Enhanced';
}

const DEFAULT_SETTINGS: AudioSettings = {
  rate: 1.0,
  pitch: 1.0,
  language: 'en-US',
};

class AudioService {
  private currentSettings: AudioSettings = DEFAULT_SETTINGS;
  private isSpeaking: boolean = false;
  private isPaused: boolean = false;
  private stopRequested: boolean = false;
  private onPlayingChange?: (playing: boolean) => void;
  private onProgressChange?: (progress: number) => void;
  private availableVoices: VoiceOption[] = [];

  // Initialize and get available voices
  async initialize(): Promise<VoiceOption[]> {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      this.availableVoices = voices.map(voice => ({
        identifier: voice.identifier,
        name: voice.name,
        language: voice.language,
        quality: voice.quality as 'Default' | 'Enhanced',
      }));
      return this.availableVoices;
    } catch (error) {
      console.error('Error getting voices:', error);
      return [];
    }
  }

  // Get English voices only
  getEnglishVoices(): VoiceOption[] {
    return this.availableVoices.filter(v => 
      v.language.startsWith('en')
    );
  }

  // Set audio settings
  setSettings(settings: Partial<AudioSettings>): void {
    this.currentSettings = { ...this.currentSettings, ...settings };
  }

  // Get current settings
  getSettings(): AudioSettings {
    return { ...this.currentSettings };
  }

  // Set callback for playing state changes
  setOnPlayingChange(callback: (playing: boolean) => void): void {
    this.onPlayingChange = callback;
  }

  // Set callback for progress changes
  setOnProgressChange(callback: (progress: number) => void): void {
    this.onProgressChange = callback;
  }

  // Speak text
  async speak(text: string): Promise<void> {
    // Stop any current speech
    await this.stop();

    if (!text || text.trim().length === 0) {
      console.warn('No text to speak');
      return;
    }

    return new Promise((resolve, reject) => {
      this.isSpeaking = true;
      this.isPaused = false;
      this.onPlayingChange?.(true);

      Speech.speak(text, {
        rate: this.currentSettings.rate,
        pitch: this.currentSettings.pitch,
        language: this.currentSettings.language,
        voice: this.currentSettings.voice,
        onStart: () => {
          this.isSpeaking = true;
          this.onPlayingChange?.(true);
        },
        onDone: () => {
          this.isSpeaking = false;
          this.onPlayingChange?.(false);
          resolve();
        },
        onStopped: () => {
          this.isSpeaking = false;
          this.onPlayingChange?.(false);
          resolve();
        },
        onError: (error) => {
          this.isSpeaking = false;
          this.onPlayingChange?.(false);
          console.error('Speech error:', error);
          reject(error);
        },
      });
    });
  }

  // Speak with progress tracking (splits into sentences)
  async speakWithProgress(text: string): Promise<void> {
    // Stop any current speech, then speak the full text in chunks.
    // IMPORTANT: We must not use `this.isSpeaking` to decide if we should continue,
    // because `Speech.speak()` sets onDone between chunks.
    await this.stop();
    this.stopRequested = false;

    const sentences = this.splitIntoSentences(text);
    const totalSentences = Math.max(1, sentences.length);

    this.isSpeaking = true;
    this.isPaused = false;
    this.onPlayingChange?.(true);

    for (let i = 0; i < sentences.length; i++) {
      if (this.stopRequested) break;
      this.onProgressChange?.(((i + 1) / totalSentences) * 100);
      await this.speakOnce(sentences[i]);
    }

    this.isSpeaking = false;
    this.onPlayingChange?.(false);
    this.onProgressChange?.(100);
  }

  // Speak a single chunk without stopping first.
  // Used by speakWithProgress() to avoid canceling speech every sentence.
  private async speakOnce(text: string): Promise<void> {
    if (!text || text.trim().length === 0) return;

    return new Promise((resolve, reject) => {
      Speech.speak(text, {
        rate: this.currentSettings.rate,
        pitch: this.currentSettings.pitch,
        language: this.currentSettings.language,
        voice: this.currentSettings.voice,
        onStart: () => {
          this.isSpeaking = true;
        },
        onDone: () => {
          resolve();
        },
        onStopped: () => {
          resolve();
        },
        onError: (error) => {
          console.error('Speech error:', error);
          reject(error);
        },
      });
    });
  }

  // Split text into sentences for better progress tracking
  private splitIntoSentences(text: string): string[] {
    // Split on sentence-ending punctuation
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.map(s => s.trim()).filter(s => s.length > 0);
  }

  // Pause speech
  async pause(): Promise<void> {
    if (this.isSpeaking) {
      await Speech.pause();
      this.isPaused = true;
      this.onPlayingChange?.(false);
    }
  }

  // Resume speech
  async resume(): Promise<void> {
    if (this.isPaused) {
      await Speech.resume();
      this.isPaused = false;
      this.onPlayingChange?.(true);
    }
  }

  // Stop speech
  async stop(): Promise<void> {
    this.stopRequested = true;
    await Speech.stop();
    this.isSpeaking = false;
    this.isPaused = false;
    this.onPlayingChange?.(false);
  }

  // Check if currently speaking
  async isCurrentlySpeaking(): Promise<boolean> {
    return await Speech.isSpeakingAsync();
  }

  // Get speaking state
  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  // Get paused state
  getIsPaused(): boolean {
    return this.isPaused;
  }

  // Clean up text for better speech
  cleanTextForSpeech(text: string): string {
    return text
      // Remove markdown formatting
      .replace(/#{1,6}\s/g, '') // Headers
      .replace(/\*\*/g, '') // Bold
      .replace(/\*/g, '') // Italic
      .replace(/`/g, '') // Code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
      .replace(/[-*+]\s/g, '') // List markers
      .replace(/\n{3,}/g, '\n\n') // Multiple newlines
      .replace(/\n/g, '. ') // Convert newlines to pauses
      .trim();
  }

  // Generate audio-friendly summary prompt
  getAudioSummaryPrompt(content: string): string {
    return `Create a summary of this content that is optimized for audio listening. 
Use natural speech patterns, avoid abbreviations, spell out numbers, and use transition words.
Make it conversational and easy to follow when heard:

${content}`;
  }
}

export const audioService = new AudioService();
export default audioService;
