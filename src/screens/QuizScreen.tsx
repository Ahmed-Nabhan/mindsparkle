import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { colors } from '../constants/colors';
import { usePremiumContext } from '../context/PremiumContext';

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  type?: 'multiple' | 'truefalse';
  difficulty?: 'easy' | 'medium' | 'hard';
}

interface QuizScreenProps {
  route: {
    params: {
      content: string;
      chunks?:  string[];
      fileUri?: string;
      fileType?: string;
    };
  };
  navigation: any;
}

import { generateQuiz } from '../services/openai';

// Timer configurations
const TIMER_SETTINGS = {
  off: { label: 'No Timer', seconds: 0 },
  relaxed: { label: 'Relaxed (60s)', seconds: 60 },
  normal: { label: 'Normal (30s)', seconds: 30 },
  challenge: { label: 'Challenge (15s)', seconds: 15 },
};

// Difficulty settings
const DIFFICULTY_SETTINGS = {
  mixed: { label: 'Mixed', emoji: '🎲' },
  easy: { label: 'Easy', emoji: '🟢' },
  medium: { label: 'Medium', emoji: '🟡' },
  hard: { label: 'Hard', emoji: '🔴' },
};

export const QuizScreen: React.FC<QuizScreenProps> = ({ route, navigation }) => {
  const { content, chunks, fileUri, fileType } = route.params;
  const { isPremium, features, dailyQuizCount, incrementQuizCount } = usePremiumContext();
  
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Generating quiz...');
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [answeredQuestions, setAnsweredQuestions] = useState<boolean[]>([]);
  const [quizAttempt, setQuizAttempt] = useState(1);
  
  // New states for timer and settings
  const [showSettings, setShowSettings] = useState(true);
  const [timerMode, setTimerMode] = useState<keyof typeof TIMER_SETTINGS>('off');
  const [difficulty, setDifficulty] = useState<keyof typeof DIFFICULTY_SETTINGS>('mixed');
  const [questionCount, setQuestionCount] = useState(5);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Timer effect
  useEffect(() => {
    if (timerMode !== 'off' && !showResult && !quizCompleted && questions.length > 0 && !showSettings) {
      if (timeLeft > 0) {
        timerRef.current = setTimeout(() => {
          setTimeLeft(timeLeft - 1);
        }, 1000);
      } else if (timeLeft === 0 && TIMER_SETTINGS[timerMode].seconds > 0) {
        // Time's up!
        setTimedOut(true);
        handleTimeUp();
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeLeft, showResult, quizCompleted, questions.length, showSettings]);

  const handleTimeUp = () => {
    const newAnswered = [...answeredQuestions];
    newAnswered[currentQuestion] = true;
    setAnsweredQuestions(newAnswered);
    setShowResult(true);
  };

  const resetTimer = () => {
    setTimedOut(false);
    if (timerMode !== 'off') {
      setTimeLeft(TIMER_SETTINGS[timerMode].seconds);
    }
  };

  const loadQuiz = async () => {
    setIsLoading(true);
    setQuizCompleted(false);
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAnsweredQuestions([]);
    setTimedOut(false);
    
    try {
      const quizQuestions = await generateQuiz(
        content,
        chunks,
        questionCount,
        (progress, message) => {
          setLoadingMessage(message);
        },
        fileUri,
        fileType
      );
      
      if (quizQuestions && quizQuestions.length > 0) {
        setQuestions(quizQuestions);
        setAnsweredQuestions(new Array(quizQuestions.length).fill(false));
        resetTimer();
      } else {
        Alert.alert('Error', 'No questions generated. Please try again.');
        navigation.goBack();
      }
    } catch (error:  any) {
      console.error('Error generating quiz:', error);
      Alert.alert('Error', error.message || 'Failed to generate quiz.');
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  };

  const startQuiz = () => {
    // Check daily quiz limit for free users
    if (!isPremium && features.maxQuizzesPerDay !== -1 && dailyQuizCount >= features.maxQuizzesPerDay) {
      Alert.alert(
        '📝 Daily Quiz Limit Reached',
        `Free users can take ${features.maxQuizzesPerDay} quizzes per day. Upgrade to Pro for unlimited quizzes!`,
        [
          { text: 'Maybe Later', style: 'cancel', onPress: () => navigation.goBack() },
          { text: 'Upgrade to Pro', onPress: () => navigation.navigate('Paywall', { source: 'quiz' }) },
        ]
      );
      return;
    }
    
    setShowSettings(false);
    incrementQuizCount();
    loadQuiz();
  };

  const handleAnswerSelect = (answerIndex: number) => {
    if (showResult || timedOut) return;
    setSelectedAnswer(answerIndex);
  };

  const handleSubmitAnswer = () => {
    if (selectedAnswer === null && !timedOut) {
      Alert.alert('Select an Answer', 'Please select an answer before submitting.');
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    const isCorrect = selectedAnswer === questions[currentQuestion].correctAnswer;
    
    if (isCorrect) {
      // Bonus points for time remaining in timed mode
      if (timerMode !== 'off' && timeLeft > 0) {
        setScore(score + 1 + Math.floor(timeLeft / 10) * 0.1);
      } else {
        setScore(score + 1);
      }
    }

    const newAnswered = [...answeredQuestions];
    newAnswered[currentQuestion] = true;
    setAnsweredQuestions(newAnswered);

    setShowResult(true);
  };

  const handleNextQuestion = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      setShowResult(false);
      setTimedOut(false);
      resetTimer();
    } else {
      setQuizCompleted(true);
    }
  };

  const handleRetakeQuiz = () => {
    setQuizAttempt(quizAttempt + 1);
    setShowSettings(true);
  };

  const getTimerColor = () => {
    if (timeLeft > 20) return colors.success || '#28a745';
    if (timeLeft > 10) return '#FFA500';
    return '#dc3545';
  };

  const getOptionStyle = (index: number) => {
    if (! showResult) {
      return selectedAnswer === index ? styles.selectedOption : styles.option;
    }

    if (index === questions[currentQuestion].correctAnswer) {
      return styles. correctOption;
    }

    if (selectedAnswer === index) {
      return styles. wrongOption;
    }

    return styles. option;
  };

  const getOptionTextStyle = (index:  number) => {
    if (!showResult) {
      return selectedAnswer === index ? styles.selectedOptionText :  styles.optionText;
    }

    if (index === questions[currentQuestion]. correctAnswer) {
      return styles.correctOptionText;
    }

    if (selectedAnswer === index) {
      return styles.wrongOptionText;
    }

    return styles.optionText;
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles. loadingText}>{loadingMessage}</Text>
        {quizAttempt > 1 && (
          <Text style={styles.attemptText}>Generating new questions (Attempt #{quizAttempt})</Text>
        )}
      </View>
    );
  }

  // Settings screen
  if (showSettings) {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.settingsContainer}>
          <Text style={styles.settingsTitle}>⚙️ Quiz Settings</Text>
          <Text style={styles.settingsSubtitle}>Customize your quiz experience</Text>

          {/* Question Count */}
          <View style={styles.settingSection}>
            <Text style={styles.settingLabel}>Number of Questions</Text>
            <View style={styles.optionRow}>
              {[5, 10, 15, 20].map((count) => (
                <TouchableOpacity
                  key={count}
                  style={[styles.optionButton, questionCount === count && styles.optionButtonSelected]}
                  onPress={() => setQuestionCount(count)}
                >
                  <Text style={[styles.optionButtonText, questionCount === count && styles.optionButtonTextSelected]}>
                    {count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Timer Mode */}
          <View style={styles.settingSection}>
            <Text style={styles.settingLabel}>⏱️ Timer Mode</Text>
            <View style={styles.optionRow}>
              {(Object.keys(TIMER_SETTINGS) as Array<keyof typeof TIMER_SETTINGS>).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.optionButton, styles.optionButtonWide, timerMode === mode && styles.optionButtonSelected]}
                  onPress={() => setTimerMode(mode)}
                >
                  <Text style={[styles.optionButtonText, timerMode === mode && styles.optionButtonTextSelected]}>
                    {TIMER_SETTINGS[mode].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Difficulty */}
          <View style={styles.settingSection}>
            <Text style={styles.settingLabel}>🎯 Difficulty</Text>
            <View style={styles.optionRow}>
              {(Object.keys(DIFFICULTY_SETTINGS) as Array<keyof typeof DIFFICULTY_SETTINGS>).map((diff) => (
                <TouchableOpacity
                  key={diff}
                  style={[styles.optionButton, difficulty === diff && styles.optionButtonSelected]}
                  onPress={() => setDifficulty(diff)}
                >
                  <Text style={styles.difficultyEmoji}>{DIFFICULTY_SETTINGS[diff].emoji}</Text>
                  <Text style={[styles.optionButtonText, difficulty === diff && styles.optionButtonTextSelected]}>
                    {DIFFICULTY_SETTINGS[diff].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.startQuizButton} onPress={startQuiz}>
            <Text style={styles.startQuizButtonText}>🚀 Start Quiz</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()}>
            <Text style={styles.cancelButtonText}>← Back to Document</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (quizCompleted) {
    const percentage = Math.round((score / questions.length) * 100);
    let resultMessage = '';
    let resultEmoji = '';

    if (percentage >= 80) {
      resultMessage = 'Excellent work! ';
      resultEmoji = '🏆';
    } else if (percentage >= 60) {
      resultMessage = 'Good job!';
      resultEmoji = '👍';
    } else if (percentage >= 40) {
      resultMessage = 'Keep practicing!';
      resultEmoji = '📚';
    } else {
      resultMessage = 'Review the material and try again!';
      resultEmoji = '💪';
    }

    return (
      <View style={styles.resultContainer}>
        <Text style={styles.resultEmoji}>{resultEmoji}</Text>
        <Text style={styles.resultTitle}>Quiz Complete!</Text>
        <Text style={styles.resultScore}>
          {score} / {questions.length}
        </Text>
        <Text style={styles.resultPercentage}>{percentage}%</Text>
        <Text style={styles.resultMessage}>{resultMessage}</Text>
        
        <View style={styles.resultButtons}>
          <TouchableOpacity 
            style={styles.retakeButton} 
            onPress={handleRetakeQuiz}
          >
            <Text style={styles.retakeButtonText}>🔄 Retake Quiz</Text>
            <Text style={styles.retakeSubtext}>New Questions</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.homeButton} 
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.homeButtonText}>← Back to Document</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.attemptInfo}>
          Attempt #{quizAttempt}
        </Text>
      </View>
    );
  }

  const question = questions[currentQuestion];

  return (
    <ScrollView style={styles. container}>
      <View style={styles.header}>
        <Text style={styles.progress}>
          Question {currentQuestion + 1} of {questions.length}
        </Text>
        {timerMode !== 'off' && (
          <View style={[styles.timerBadge, { backgroundColor: getTimerColor() }]}>
            <Text style={styles.timerText}>⏱️ {timeLeft}s</Text>
          </View>
        )}
        <Text style={styles.score}>Score: {Math.round(score * 10) / 10}</Text>
      </View>

      <View style={styles. progressBar}>
        <View 
          style={[
            styles.progressFill, 
            { width: `${((currentQuestion + 1) / questions.length) * 100}%` }
          ]} 
        />
      </View>

      {/* Timer progress bar */}
      {timerMode !== 'off' && !showResult && (
        <View style={styles.timerBar}>
          <View 
            style={[
              styles.timerFill, 
              { 
                width: `${(timeLeft / TIMER_SETTINGS[timerMode].seconds) * 100}%`,
                backgroundColor: getTimerColor()
              }
            ]} 
          />
        </View>
      )}

      {question.difficulty && (
        <View style={styles.difficultyBadgeContainer}>
          <View style={[styles.difficultyBadge, {
            backgroundColor: question.difficulty === 'easy' ? '#d4edda' : 
                           question.difficulty === 'medium' ? '#fff3cd' : '#f8d7da'
          }]}>
            <Text style={styles.difficultyBadgeText}>
              {question.difficulty === 'easy' ? '🟢 Easy' : 
               question.difficulty === 'medium' ? '🟡 Medium' : '🔴 Hard'}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.questionCard}>
        <Text style={styles.questionText}>{question. question}</Text>
      </View>

      <View style={styles.optionsContainer}>
        {question.options.map((option, index) => (
          <TouchableOpacity
            key={index}
            style={getOptionStyle(index)}
            onPress={() => handleAnswerSelect(index)}
            disabled={showResult}
          >
            <View style={styles.optionContent}>
              <Text style={styles.optionLetter}>
                {String.fromCharCode(65 + index)}
              </Text>
              <Text style={getOptionTextStyle(index)}>{option}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {showResult && (
        <View style={styles.explanationCard}>
          <Text style={styles.explanationTitle}>
            {selectedAnswer === question.correctAnswer ? '✅ Correct!' :  '❌ Incorrect'}
          </Text>
          <Text style={styles.explanationText}>{question.explanation}</Text>
        </View>
      )}

      <View style={styles.buttonContainer}>
        {!showResult ?  (
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmitAnswer}>
            <Text style={styles.submitButtonText}>Submit Answer</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.nextButton} onPress={handleNextQuestion}>
            <Text style={styles.nextButtonText}>
              {currentQuestion < questions.length - 1 ? 'Next Question →' : 'See Results'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize:  16,
    color: colors.textSecondary,
  },
  attemptText: {
    marginTop: 8,
    fontSize:  14,
    color: colors.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  progress:  {
    fontSize: 16,
    color: colors.textSecondary,
  },
  score:  {
    fontSize:  16,
    fontWeight: '600',
    color: colors.primary,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    marginHorizontal: 16,
    borderRadius: 3,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius:  3,
  },
  questionCard: {
    backgroundColor: colors.cardBackground,
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width:  0, height:  2 },
    shadowOpacity:  0.1,
    shadowRadius:  4,
    elevation: 3,
  },
  questionText: {
    fontSize: 18,
    fontWeight:  '600',
    color: colors.text,
    lineHeight: 26,
  },
  optionsContainer:  {
    paddingHorizontal:  16,
  },
  option: {
    backgroundColor: colors.cardBackground,
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: colors.border,
  },
  selectedOption: {
    backgroundColor: colors.primary + '20',
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth:  2,
    borderColor: colors. primary,
  },
  correctOption: {
    backgroundColor: '#d4edda',
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth:  2,
    borderColor: '#28a745',
  },
  wrongOption: {
    backgroundColor: '#f8d7da',
    padding: 16,
    borderRadius:  10,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#dc3545',
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionLetter: {
    width: 28,
    height:  28,
    borderRadius: 14,
    backgroundColor: colors.border,
    textAlign: 'center',
    lineHeight: 28,
    marginRight: 12,
    fontWeight: '600',
    color: colors.text,
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  selectedOptionText: {
    flex: 1,
    fontSize: 16,
    color:  colors.primary,
    fontWeight: '500',
  },
  correctOptionText: {
    flex: 1,
    fontSize:  16,
    color: '#155724',
    fontWeight: '500',
  },
  wrongOptionText:  {
    flex:  1,
    fontSize: 16,
    color: '#721c24',
    fontWeight: '500',
  },
  explanationCard:  {
    backgroundColor:  colors.cardBackground,
    margin: 16,
    padding: 16,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  explanationTitle:  {
    fontSize:  16,
    fontWeight: '600',
    marginBottom: 8,
    color: colors.text,
  },
  explanationText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  buttonContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  submitButton: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius:  10,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  nextButton: {
    backgroundColor: colors.success || '#28a745',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  resultContainer: {
    flex: 1,
    justifyContent:  'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding:  20,
  },
  resultEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  resultScore: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.primary,
  },
  resultPercentage: {
    fontSize: 24,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  resultMessage: {
    fontSize: 18,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  resultButtons: {
    width: '100%',
    paddingHorizontal:  20,
  },
  retakeButton: {
    backgroundColor: colors.primary,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  retakeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  retakeSubtext: {
    color: '#fff',
    fontSize:  12,
    opacity: 0.8,
    marginTop: 4,
  },
  homeButton: {
    backgroundColor: colors.cardBackground,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  homeButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight:  '500',
  },
  attemptInfo: {
    marginTop: 20,
    fontSize:  14,
    color: colors.textSecondary,
  },
  // Settings styles
  settingsContainer: {
    padding: 20,
  },
  settingsTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  settingsSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  settingSection: {
    marginBottom: 24,
  },
  settingLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionButton: {
    backgroundColor: colors.cardBackground,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    minWidth: 70,
  },
  optionButtonWide: {
    flex: 1,
    minWidth: '45%',
  },
  optionButtonSelected: {
    backgroundColor: colors.primary + '20',
    borderColor: colors.primary,
  },
  optionButtonText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  optionButtonTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  difficultyEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  startQuizButton: {
    backgroundColor: colors.primary,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  startQuizButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  // Timer styles
  timerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  timerText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  timerBar: {
    height: 4,
    backgroundColor: colors.border,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 2,
  },
  timerFill: {
    height: '100%',
    borderRadius: 2,
  },
  difficultyBadgeContainer: {
    paddingHorizontal: 16,
    marginTop: 12,
  },
  difficultyBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  difficultyBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default QuizScreen;
