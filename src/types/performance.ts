export interface TestResult {
  id: string;
  documentId: string;
  userId: string;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  completedAt: Date;
  timeSpent: number; // in seconds
  testType: 'quiz' | 'exam' | 'interview';
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

export interface PerformanceStats {
  totalTests: number;
  averageScore: number;
  totalTimeSpent: number;
  testsByType: {
    quiz: number;
    exam: number;
    interview: number;
  };
  recentTests: TestResult[];
}
