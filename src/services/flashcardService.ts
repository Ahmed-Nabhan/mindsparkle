// Flashcard Service - AI-powered flashcard generation with spaced repetition

import ApiService from './apiService';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category?: string;
  // Spaced Repetition fields
  easeFactor: number; // SM-2 algorithm ease factor
  interval: number; // Days until next review
  repetitions: number; // Number of successful reviews
  nextReview: Date;
  lastReview?: Date;
}

export interface FlashcardDeck {
  id: string;
  documentId: string;
  title: string;
  cards: Flashcard[];
  createdAt: Date;
  lastStudied?: Date;
  totalCards: number;
  masteredCards: number;
}

export interface StudySession {
  deckId: string;
  cardsStudied: number;
  correctAnswers: number;
  timeSpent: number; // in seconds
  completedAt: Date;
}

// Quality ratings for spaced repetition (SM-2 algorithm)
export type QualityRating = 0 | 1 | 2 | 3 | 4 | 5;
// 0 - Complete blackout
// 1 - Incorrect, but recognized
// 2 - Incorrect, but easy to recall
// 3 - Correct with difficulty
// 4 - Correct with hesitation
// 5 - Perfect response

class FlashcardService {
  // Generate flashcards from document content using AI
  async generateFlashcards(
    content: string,
    count: number = 20,
    onProgress?: (progress: number, message: string) => void
  ): Promise<Flashcard[]> {
    try {
      if (!content || content.trim().length === 0) {
        throw new Error('No content provided for flashcard generation');
      }
      
      if (onProgress) onProgress(10, 'Analyzing content...');

      const prompt = `Create ${count} educational flashcards from this content. 
      
For each flashcard, provide:
- A clear, concise question or prompt for the front
- A comprehensive answer for the back
- Difficulty level (easy, medium, or hard)
- Category/topic

Format as JSON array:
[
  {
    "front": "Question or prompt",
    "back": "Answer or explanation",
    "difficulty": "easy|medium|hard",
    "category": "Topic name"
  }
]

Content to create flashcards from:
${content.substring(0, 8000)}`;

      if (onProgress) onProgress(50, 'Generating flashcards with AI...');

      const response = await ApiService.callApi('flashcards', { content: content.substring(0, 8000) });
      
      if (onProgress) onProgress(80, 'Processing flashcards...');

      // Get flashcards from response
      const rawCards = response.flashcards || [];
      
      if (rawCards.length === 0) {
        throw new Error('No flashcards generated');
      }
      
      // Transform to full Flashcard objects with SM-2 initial values
      const flashcards: Flashcard[] = rawCards.map((card: any, index: number) => ({
        id: `card_${Date.now()}_${index}`,
        front: card.term || card.front,
        back: card.definition || card.back,
        difficulty: card.difficulty || 'medium',
        category: card.category || 'General',
        // SM-2 algorithm initial values
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: new Date(),
      }));

      if (onProgress) onProgress(100, 'Done!');

      return flashcards;
    } catch (error: any) {
      console.error('Error generating flashcards:', error);
      throw new Error(error.message || 'Failed to generate flashcards');
    }
  }

  // SM-2 Spaced Repetition Algorithm
  calculateNextReview(card: Flashcard, quality: QualityRating): Flashcard {
    let { easeFactor, interval, repetitions } = card;

    if (quality >= 3) {
      // Correct response
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions += 1;
    } else {
      // Incorrect response - reset
      repetitions = 0;
      interval = 1;
    }

    // Update ease factor (minimum 1.3)
    easeFactor = Math.max(
      1.3,
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);

    return {
      ...card,
      easeFactor,
      interval,
      repetitions,
      nextReview,
      lastReview: new Date(),
    };
  }

  // Get cards due for review today
  getCardsForReview(cards: Flashcard[]): Flashcard[] {
    const now = new Date();
    return cards.filter(card => new Date(card.nextReview) <= now);
  }

  // Get cards that are considered "mastered" (interval > 21 days)
  getMasteredCards(cards: Flashcard[]): Flashcard[] {
    return cards.filter(card => card.interval > 21);
  }

  // Get study statistics
  getStudyStats(cards: Flashcard[]): {
    total: number;
    mastered: number;
    learning: number;
    new: number;
    dueToday: number;
  } {
    const mastered = cards.filter(c => c.interval > 21).length;
    const learning = cards.filter(c => c.repetitions > 0 && c.interval <= 21).length;
    const newCards = cards.filter(c => c.repetitions === 0).length;
    const dueToday = this.getCardsForReview(cards).length;

    return {
      total: cards.length,
      mastered,
      learning,
      new: newCards,
      dueToday,
    };
  }

  // Shuffle cards for study session
  shuffleCards(cards: Flashcard[]): Flashcard[] {
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Sort cards by priority (due first, then by ease factor)
  sortByPriority(cards: Flashcard[]): Flashcard[] {
    return [...cards].sort((a, b) => {
      const aDue = new Date(a.nextReview).getTime();
      const bDue = new Date(b.nextReview).getTime();
      
      if (aDue !== bDue) return aDue - bDue;
      return a.easeFactor - b.easeFactor;
    });
  }
}

export const flashcardService = new FlashcardService();
export default flashcardService;
