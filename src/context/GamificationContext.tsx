import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import gamificationService, { 
  UserStats, 
  ACHIEVEMENTS, 
  LEVELS,
  XP_VALUES 
} from '../services/gamificationService';

interface GamificationContextType {
  stats: UserStats;
  isLoading: boolean;
  
  // Actions
  refreshStats: () => Promise<void>;
  addXP: (amount: number, reason: string) => Promise<{ leveledUp: boolean; newLevel?: number }>;
  checkStreak: () => Promise<{ streakUpdated: boolean; newStreak: number }>;
  unlockAchievement: (id: string) => Promise<{ unlocked: boolean; achievement?: any }>;
  
  // Record activities
  recordQuizCompletion: (score: number, total: number) => Promise<void>;
  recordFlashcardSession: (reviewed: number, mastered: number) => Promise<void>;
  recordDocumentUpload: () => Promise<void>;
  
  // Helpers
  getAllAchievements: () => Array<typeof ACHIEVEMENTS[0] & { unlocked: boolean }>;
  getLevels: () => typeof LEVELS;
  getXPValues: () => typeof XP_VALUES;
}

const GamificationContext = createContext<GamificationContextType | undefined>(undefined);

export const GamificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [stats, setStats] = useState<UserStats>(gamificationService.getDefaultStats());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initializeGamification();
  }, []);

  const initializeGamification = async () => {
    try {
      setIsLoading(true);
      const userStats = await gamificationService.initialize();
      setStats(userStats);
    } catch (error) {
      console.error('Error initializing gamification:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshStats = useCallback(async () => {
    const userStats = await gamificationService.initialize();
    setStats(userStats);
  }, []);

  const addXP = useCallback(async (amount: number, reason: string) => {
    const result = await gamificationService.addXP(amount, reason);
    setStats(gamificationService.getStats());
    return result;
  }, []);

  const checkStreak = useCallback(async () => {
    const result = await gamificationService.checkStreak();
    setStats(gamificationService.getStats());
    return result;
  }, []);

  const unlockAchievement = useCallback(async (id: string) => {
    const result = await gamificationService.unlockAchievement(id);
    setStats(gamificationService.getStats());
    return result;
  }, []);

  const recordQuizCompletion = useCallback(async (score: number, total: number) => {
    await gamificationService.recordQuizCompletion(score, total);
    setStats(gamificationService.getStats());
  }, []);

  const recordFlashcardSession = useCallback(async (reviewed: number, mastered: number) => {
    await gamificationService.recordFlashcardSession(reviewed, mastered);
    setStats(gamificationService.getStats());
  }, []);

  const recordDocumentUpload = useCallback(async () => {
    await gamificationService.recordDocumentUpload();
    setStats(gamificationService.getStats());
  }, []);

  const getAllAchievements = useCallback(() => {
    return gamificationService.getAllAchievements();
  }, [stats.achievements]);

  const getLevels = useCallback(() => LEVELS, []);
  const getXPValues = useCallback(() => XP_VALUES, []);

  return (
    <GamificationContext.Provider
      value={{
        stats,
        isLoading,
        refreshStats,
        addXP,
        checkStreak,
        unlockAchievement,
        recordQuizCompletion,
        recordFlashcardSession,
        recordDocumentUpload,
        getAllAchievements,
        getLevels,
        getXPValues,
      }}
    >
      {children}
    </GamificationContext.Provider>
  );
};

export const useGamification = () => {
  const context = useContext(GamificationContext);
  if (!context) {
    throw new Error('useGamification must be used within a GamificationProvider');
  }
  return context;
};

export default GamificationContext;
