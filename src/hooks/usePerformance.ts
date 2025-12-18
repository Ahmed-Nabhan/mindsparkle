import { useState, useEffect } from 'react';
import { TestResult, PerformanceStats } from '../types/performance';
import { getAllTestResults, saveTestResult } from '../services/storage';
import { calculatePercentage } from '../utils/helpers';

export const usePerformance = () => {
  const [stats, setStats] = useState<PerformanceStats>({
    totalTests: 0,
    averageScore: 0,
    totalTimeSpent: 0,
    testsByType: {
      quiz: 0,
      exam: 0,
      interview: 0,
    },
    recentTests: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPerformanceStats();
  }, []);

  const loadPerformanceStats = async () => {
    try {
      setIsLoading(true);
      const results = await getAllTestResults();

      const totalTests = results.length;
      const averageScore =
        totalTests > 0
          ? results.reduce((sum, r) => sum + r.score, 0) / totalTests
          : 0;
      const totalTimeSpent = results.reduce((sum, r) => sum + r.timeSpent, 0);

      const testsByType = {
        quiz: results.filter(r => r.testType === 'quiz').length,
        exam: results.filter(r => r.testType === 'exam').length,
        interview: results.filter(r => r.testType === 'interview').length,
      };

      const recentTests = results.slice(0, 10);

      setStats({
        totalTests,
        averageScore,
        totalTimeSpent,
        testsByType,
        recentTests,
      });
    } catch (err) {
      setError('Failed to load performance stats');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const saveResult = async (result: TestResult): Promise<boolean> => {
    try {
      await saveTestResult(result);
      await loadPerformanceStats();
      return true;
    } catch (err) {
      console.error('Failed to save test result:', err);
      return false;
    }
  };

  return {
    stats,
    isLoading,
    error,
    saveResult,
    refreshStats: loadPerformanceStats,
  };
};
