// Gamification Service - Streaks, XP, Achievements, and Leaderboards

import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const STORAGE_KEYS = {
  STREAK: '@mindsparkle_streak',
  XP: '@mindsparkle_xp',
  ACHIEVEMENTS: '@mindsparkle_achievements',
  DAILY_ACTIVITY: '@mindsparkle_daily_activity',
  LEVEL: '@mindsparkle_level',
};

// XP values for different actions
export const XP_VALUES = {
  QUIZ_COMPLETE: 50,
  QUIZ_PERFECT: 100,
  FLASHCARD_SESSION: 30,
  FLASHCARD_MASTERED: 10,
  SUMMARY_GENERATED: 20,
  DOCUMENT_UPLOADED: 15,
  DAILY_LOGIN: 25,
  STREAK_BONUS: 10, // Per day of streak
  CHAT_SESSION: 15,
  VIDEO_WATCHED: 25,
};

// Level thresholds
export const LEVELS = [
  { level: 1, xpRequired: 0, title: 'Novice Learner', emoji: '🌱' },
  { level: 2, xpRequired: 100, title: 'Curious Mind', emoji: '🔍' },
  { level: 3, xpRequired: 300, title: 'Knowledge Seeker', emoji: '📚' },
  { level: 4, xpRequired: 600, title: 'Quick Learner', emoji: '⚡' },
  { level: 5, xpRequired: 1000, title: 'Study Pro', emoji: '🎓' },
  { level: 6, xpRequired: 1500, title: 'Brain Master', emoji: '🧠' },
  { level: 7, xpRequired: 2200, title: 'Wisdom Keeper', emoji: '🦉' },
  { level: 8, xpRequired: 3000, title: 'Scholar', emoji: '📜' },
  { level: 9, xpRequired: 4000, title: 'Expert', emoji: '⭐' },
  { level: 10, xpRequired: 5500, title: 'Genius', emoji: '🌟' },
  { level: 11, xpRequired: 7500, title: 'Mastermind', emoji: '💎' },
  { level: 12, xpRequired: 10000, title: 'Legend', emoji: '👑' },
];

// Achievement definitions
export const ACHIEVEMENTS = [
  // Getting Started
  { id: 'first_doc', title: 'First Steps', description: 'Upload your first document', icon: '📄', xpReward: 50 },
  { id: 'first_quiz', title: 'Quiz Rookie', description: 'Complete your first quiz', icon: '❓', xpReward: 50 },
  { id: 'first_flashcard', title: 'Card Collector', description: 'Create your first flashcard deck', icon: '📇', xpReward: 50 },
  
  // Consistency
  { id: 'streak_3', title: 'Getting Started', description: '3-day learning streak', icon: '🔥', xpReward: 75 },
  { id: 'streak_7', title: 'Week Warrior', description: '7-day learning streak', icon: '🔥', xpReward: 150 },
  { id: 'streak_14', title: 'Fortnight Fighter', description: '14-day learning streak', icon: '🔥', xpReward: 300 },
  { id: 'streak_30', title: 'Monthly Master', description: '30-day learning streak', icon: '🔥', xpReward: 500 },
  { id: 'streak_100', title: 'Centurion', description: '100-day learning streak', icon: '💯', xpReward: 1000 },
  
  // Quiz achievements
  { id: 'quiz_10', title: 'Quiz Enthusiast', description: 'Complete 10 quizzes', icon: '🎯', xpReward: 100 },
  { id: 'quiz_50', title: 'Quiz Master', description: 'Complete 50 quizzes', icon: '🏆', xpReward: 250 },
  { id: 'quiz_perfect', title: 'Perfectionist', description: 'Score 100% on a quiz', icon: '💯', xpReward: 100 },
  { id: 'quiz_perfect_10', title: 'Flawless', description: 'Score 100% on 10 quizzes', icon: '✨', xpReward: 300 },
  
  // Flashcard achievements
  { id: 'flashcard_100', title: 'Memory Builder', description: 'Review 100 flashcards', icon: '🧠', xpReward: 150 },
  { id: 'flashcard_master_50', title: 'Master of Cards', description: 'Master 50 flashcards', icon: '🎴', xpReward: 250 },
  
  // Document achievements
  { id: 'docs_5', title: 'Library Builder', description: 'Upload 5 documents', icon: '📚', xpReward: 100 },
  { id: 'docs_20', title: 'Librarian', description: 'Upload 20 documents', icon: '🏛️', xpReward: 250 },
  
  // Time-based
  { id: 'night_owl', title: 'Night Owl', description: 'Study after midnight', icon: '🦉', xpReward: 75 },
  { id: 'early_bird', title: 'Early Bird', description: 'Study before 6 AM', icon: '🐦', xpReward: 75 },
  { id: 'weekend_warrior', title: 'Weekend Warrior', description: 'Study on Saturday and Sunday', icon: '💪', xpReward: 100 },
  
  // Level achievements
  { id: 'level_5', title: 'Rising Star', description: 'Reach level 5', icon: '⭐', xpReward: 200 },
  { id: 'level_10', title: 'Top Achiever', description: 'Reach level 10', icon: '🌟', xpReward: 500 },
  
  // Special
  { id: 'premium_user', title: 'Pro Learner', description: 'Upgrade to Pro', icon: '💎', xpReward: 200 },
  { id: 'share_first', title: 'Spreading Knowledge', description: 'Share your first summary', icon: '📤', xpReward: 50 },
];

export interface UserStats {
  totalXP: number;
  level: number;
  levelTitle: string;
  levelEmoji: string;
  xpToNextLevel: number;
  xpProgress: number; // Percentage to next level
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  totalQuizzes: number;
  totalFlashcards: number;
  totalDocuments: number;
  perfectQuizzes: number;
  achievements: string[]; // Array of achievement IDs
}

export interface DailyActivity {
  date: string;
  xpEarned: number;
  quizzesCompleted: number;
  flashcardsReviewed: number;
  timeSpent: number; // in minutes
}

class GamificationService {
  private stats: UserStats | null = null;

  // Initialize and load stats
  async initialize(): Promise<UserStats> {
    try {
      const [xp, streak, achievements, level] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.XP),
        AsyncStorage.getItem(STORAGE_KEYS.STREAK),
        AsyncStorage.getItem(STORAGE_KEYS.ACHIEVEMENTS),
        AsyncStorage.getItem(STORAGE_KEYS.LEVEL),
      ]);

      const totalXP = xp ? parseInt(xp) : 0;
      const streakData = streak ? JSON.parse(streak) : { current: 0, longest: 0, lastDate: '' };
      const unlockedAchievements = achievements ? JSON.parse(achievements) : [];

      // Calculate level
      const levelInfo = this.calculateLevel(totalXP);

      this.stats = {
        totalXP,
        level: levelInfo.level,
        levelTitle: levelInfo.title,
        levelEmoji: levelInfo.emoji,
        xpToNextLevel: levelInfo.xpToNext,
        xpProgress: levelInfo.progress,
        currentStreak: streakData.current,
        longestStreak: streakData.longest,
        lastActiveDate: streakData.lastDate,
        totalQuizzes: 0,
        totalFlashcards: 0,
        totalDocuments: 0,
        perfectQuizzes: 0,
        achievements: unlockedAchievements,
      };

      // Check and update streak
      await this.checkStreak();

      return this.stats;
    } catch (error) {
      console.error('Error initializing gamification:', error);
      return this.getDefaultStats();
    }
  }

  getDefaultStats(): UserStats {
    return {
      totalXP: 0,
      level: 1,
      levelTitle: 'Novice Learner',
      levelEmoji: '🌱',
      xpToNextLevel: 100,
      xpProgress: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: '',
      totalQuizzes: 0,
      totalFlashcards: 0,
      totalDocuments: 0,
      perfectQuizzes: 0,
      achievements: [],
    };
  }

  calculateLevel(xp: number): { level: number; title: string; emoji: string; xpToNext: number; progress: number } {
    let currentLevel = LEVELS[0];
    let nextLevel = LEVELS[1];

    for (let i = LEVELS.length - 1; i >= 0; i--) {
      if (xp >= LEVELS[i].xpRequired) {
        currentLevel = LEVELS[i];
        nextLevel = LEVELS[i + 1] || LEVELS[i];
        break;
      }
    }

    const xpInCurrentLevel = xp - currentLevel.xpRequired;
    const xpNeededForNext = nextLevel.xpRequired - currentLevel.xpRequired;
    const progress = xpNeededForNext > 0 ? (xpInCurrentLevel / xpNeededForNext) * 100 : 100;

    return {
      level: currentLevel.level,
      title: currentLevel.title,
      emoji: currentLevel.emoji,
      xpToNext: nextLevel.xpRequired - xp,
      progress: Math.min(progress, 100),
    };
  }

  // Add XP and check for level up
  async addXP(amount: number, reason: string): Promise<{ newXP: number; leveledUp: boolean; newLevel?: number }> {
    const currentXP = this.stats?.totalXP || 0;
    const currentLevel = this.stats?.level || 1;
    const newXP = currentXP + amount;

    await AsyncStorage.setItem(STORAGE_KEYS.XP, newXP.toString());

    const levelInfo = this.calculateLevel(newXP);
    const leveledUp = levelInfo.level > currentLevel;

    if (this.stats) {
      this.stats.totalXP = newXP;
      this.stats.level = levelInfo.level;
      this.stats.levelTitle = levelInfo.title;
      this.stats.levelEmoji = levelInfo.emoji;
      this.stats.xpToNextLevel = levelInfo.xpToNext;
      this.stats.xpProgress = levelInfo.progress;
    }

    // Check for level achievements
    if (levelInfo.level >= 5) await this.unlockAchievement('level_5');
    if (levelInfo.level >= 10) await this.unlockAchievement('level_10');

    return { newXP, leveledUp, newLevel: leveledUp ? levelInfo.level : undefined };
  }

  // Check and update streak
  async checkStreak(): Promise<{ streakUpdated: boolean; newStreak: number }> {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    const streakData = await AsyncStorage.getItem(STORAGE_KEYS.STREAK);
    let { current, longest, lastDate } = streakData 
      ? JSON.parse(streakData) 
      : { current: 0, longest: 0, lastDate: '' };

    if (lastDate === today) {
      // Already logged today
      return { streakUpdated: false, newStreak: current };
    }

    if (lastDate === yesterday) {
      // Continuing streak
      current += 1;
    } else if (lastDate !== today) {
      // Streak broken or first day
      current = 1;
    }

    if (current > longest) {
      longest = current;
    }

    await AsyncStorage.setItem(STORAGE_KEYS.STREAK, JSON.stringify({
      current,
      longest,
      lastDate: today,
    }));

    if (this.stats) {
      this.stats.currentStreak = current;
      this.stats.longestStreak = longest;
      this.stats.lastActiveDate = today;
    }

    // Award daily login XP with streak bonus
    await this.addXP(XP_VALUES.DAILY_LOGIN + (current * XP_VALUES.STREAK_BONUS), 'Daily Login');

    // Check streak achievements
    if (current >= 3) await this.unlockAchievement('streak_3');
    if (current >= 7) await this.unlockAchievement('streak_7');
    if (current >= 14) await this.unlockAchievement('streak_14');
    if (current >= 30) await this.unlockAchievement('streak_30');
    if (current >= 100) await this.unlockAchievement('streak_100');

    return { streakUpdated: true, newStreak: current };
  }

  // Unlock an achievement
  async unlockAchievement(achievementId: string): Promise<{ unlocked: boolean; achievement?: typeof ACHIEVEMENTS[0] }> {
    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievement) return { unlocked: false };

    const achievementsData = await AsyncStorage.getItem(STORAGE_KEYS.ACHIEVEMENTS);
    const unlockedAchievements: string[] = achievementsData ? JSON.parse(achievementsData) : [];

    if (unlockedAchievements.includes(achievementId)) {
      return { unlocked: false };
    }

    unlockedAchievements.push(achievementId);
    await AsyncStorage.setItem(STORAGE_KEYS.ACHIEVEMENTS, JSON.stringify(unlockedAchievements));

    if (this.stats) {
      this.stats.achievements = unlockedAchievements;
    }

    // Award XP for achievement
    await this.addXP(achievement.xpReward, `Achievement: ${achievement.title}`);

    return { unlocked: true, achievement };
  }

  // Get all achievements with unlock status
  getAllAchievements(): Array<typeof ACHIEVEMENTS[0] & { unlocked: boolean }> {
    const unlockedIds = this.stats?.achievements || [];
    return ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: unlockedIds.includes(a.id),
    }));
  }

  // Record quiz completion
  async recordQuizCompletion(score: number, totalQuestions: number): Promise<void> {
    const isPerfect = score === totalQuestions;
    
    await this.addXP(
      isPerfect ? XP_VALUES.QUIZ_PERFECT : XP_VALUES.QUIZ_COMPLETE,
      'Quiz Completed'
    );

    // First quiz achievement
    await this.unlockAchievement('first_quiz');

    if (isPerfect) {
      await this.unlockAchievement('quiz_perfect');
    }
  }

  // Record flashcard session
  async recordFlashcardSession(cardsReviewed: number, cardsMastered: number): Promise<void> {
    await this.addXP(
      XP_VALUES.FLASHCARD_SESSION + (cardsMastered * XP_VALUES.FLASHCARD_MASTERED),
      'Flashcard Session'
    );

    await this.unlockAchievement('first_flashcard');
  }

  // Record document upload
  async recordDocumentUpload(): Promise<void> {
    await this.addXP(XP_VALUES.DOCUMENT_UPLOADED, 'Document Uploaded');
    await this.unlockAchievement('first_doc');
  }

  // Get current stats
  getStats(): UserStats {
    return this.stats || this.getDefaultStats();
  }

  // Reset all gamification data (for testing)
  async resetAll(): Promise<void> {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.XP),
      AsyncStorage.removeItem(STORAGE_KEYS.STREAK),
      AsyncStorage.removeItem(STORAGE_KEYS.ACHIEVEMENTS),
      AsyncStorage.removeItem(STORAGE_KEYS.DAILY_ACTIVITY),
      AsyncStorage.removeItem(STORAGE_KEYS.LEVEL),
    ]);
    this.stats = null;
  }
}

export const gamificationService = new GamificationService();
export default gamificationService;
