import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { DocumentSelector } from '../components/DocumentSelector';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { generateQuiz } from '../services/openai';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type ExamsScreenProps = MainDrawerScreenProps<'Exams'>;

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export const ExamsScreen: React.FC = () => {
  const navigation = useNavigation<ExamsScreenProps['navigation']>();
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [examMode, setExamMode] = useState<'select' | 'config' | 'exam' | 'results'>('select');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<(number | null)[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [questionCount, setQuestionCount] = useState(10);
  const [timeLimit, setTimeLimit] = useState(30); // minutes
  const [startTime, setStartTime] = useState<Date | null>(null);

  const handleDocumentSelect = (document: Document) => {
    setSelectedDocument(document);
    setExamMode('config');
  };

  const handleStartExam = async () => {
    if (!selectedDocument?.content) {
      Alert.alert('Error', 'Document content not available');
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Generating exam questions...');

    try {
      const quiz = await generateQuiz(
        selectedDocument.content,
        selectedDocument.chunks,
        questionCount,
        (progress, message) => setLoadingMessage(message),
        selectedDocument.fileUri,
        selectedDocument.fileType
      );

      if (quiz && quiz.length > 0) {
        setQuestions(quiz);
        setSelectedAnswers(new Array(quiz.length).fill(null));
        setStartTime(new Date());
        setExamMode('exam');
      } else {
        Alert.alert('Error', 'Failed to generate questions');
      }
    } catch (error: any) {
      console.error('Error generating exam:', error);
      Alert.alert('Error', error.message || 'Failed to generate exam');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswerSelect = (index: number) => {
    if (showAnswer) return;
    const newAnswers = [...selectedAnswers];
    newAnswers[currentQuestion] = index;
    setSelectedAnswers(newAnswers);
  };

  const handleSubmitAnswer = () => {
    if (selectedAnswers[currentQuestion] === null) {
      Alert.alert('Select an Answer', 'Please select an answer before continuing.');
      return;
    }
    setShowAnswer(true);
  };

  const handleNextQuestion = () => {
    setShowAnswer(false);
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      setExamMode('results');
    }
  };

  const handleRetakeExam = () => {
    setSelectedAnswers(new Array(questions.length).fill(null));
    setCurrentQuestion(0);
    setShowAnswer(false);
    setStartTime(new Date());
    setExamMode('exam');
  };

  const handleNewExam = () => {
    setSelectedDocument(null);
    setQuestions([]);
    setCurrentQuestion(0);
    setSelectedAnswers([]);
    setShowAnswer(false);
    setExamMode('select');
  };

  const calculateScore = () => {
    let correct = 0;
    questions.forEach((q, i) => {
      if (selectedAnswers[i] === q.correctAnswer) correct++;
    });
    return {
      correct,
      total: questions.length,
      percentage: Math.round((correct / questions.length) * 100),
    };
  };

  const getOptionStyle = (index: number) => {
    if (!showAnswer) {
      return selectedAnswers[currentQuestion] === index
        ? styles.selectedOption
        : styles.option;
    }
    if (index === questions[currentQuestion].correctAnswer) {
      return styles.correctOption;
    }
    if (selectedAnswers[currentQuestion] === index) {
      return styles.wrongOption;
    }
    return styles.option;
  };

  if (isLoading) {
    return <LoadingSpinner message={loadingMessage} />;
  }

  // Document Selection Mode
  if (examMode === 'select') {
    return (
      <View style={styles.container}>
        <Header title="Exams" subtitle="Practice with exam-style questions" />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.icon}>📋</Text>
            <Text style={styles.title}>Exam Preparation</Text>
            <Text style={styles.description}>
              Take comprehensive exams based on your study materials. Get detailed feedback and track your progress.
            </Text>
          </Card>

          <DocumentSelector
            onDocumentSelect={handleDocumentSelect}
            title="Select Study Material"
            subtitle="Choose a document to generate exam questions from"
          />

          <Card>
            <Text style={styles.sectionTitle}>Features</Text>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>✅</Text>
              <Text style={styles.featureText}>AI-generated questions</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>⏱️</Text>
              <Text style={styles.featureText}>Timed exam mode</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>📊</Text>
              <Text style={styles.featureText}>Detailed performance analytics</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>🎯</Text>
              <Text style={styles.featureText}>Targeted improvement suggestions</Text>
            </View>
          </Card>
        </ScrollView>
      </View>
    );
  }

  // Exam Configuration Mode
  if (examMode === 'config') {
    return (
      <View style={styles.container}>
        <Header title="Configure Exam" subtitle={selectedDocument?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.configTitle}>Exam Settings</Text>

            <Text style={styles.configLabel}>Number of Questions</Text>
            <View style={styles.configOptions}>
              {[5, 10, 15, 20].map((count) => (
                <TouchableOpacity
                  key={count}
                  style={[
                    styles.configOption,
                    questionCount === count && styles.configOptionSelected,
                  ]}
                  onPress={() => setQuestionCount(count)}
                >
                  <Text
                    style={[
                      styles.configOptionText,
                      questionCount === count && styles.configOptionTextSelected,
                    ]}
                  >
                    {count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.configLabel}>Time Limit (minutes)</Text>
            <View style={styles.configOptions}>
              {[15, 30, 45, 60].map((time) => (
                <TouchableOpacity
                  key={time}
                  style={[
                    styles.configOption,
                    timeLimit === time && styles.configOptionSelected,
                  ]}
                  onPress={() => setTimeLimit(time)}
                >
                  <Text
                    style={[
                      styles.configOptionText,
                      timeLimit === time && styles.configOptionTextSelected,
                    ]}
                  >
                    {time}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          <View style={styles.buttonContainer}>
            <Button
              title="Start Exam"
              onPress={handleStartExam}
              style={styles.startButton}
            />
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setExamMode('select')}
            >
              <Text style={styles.backButtonText}>← Choose Different Document</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Results Mode
  if (examMode === 'results') {
    const score = calculateScore();
    const timeSpent = startTime
      ? Math.round((new Date().getTime() - startTime.getTime()) / 60000)
      : 0;

    let resultEmoji = '🏆';
    let resultMessage = 'Excellent work!';
    if (score.percentage < 80) {
      resultEmoji = '👍';
      resultMessage = 'Good job!';
    }
    if (score.percentage < 60) {
      resultEmoji = '📚';
      resultMessage = 'Keep practicing!';
    }
    if (score.percentage < 40) {
      resultEmoji = '💪';
      resultMessage = 'Review and try again!';
    }

    return (
      <View style={styles.container}>
        <Header title="Exam Results" subtitle={selectedDocument?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.resultEmoji}>{resultEmoji}</Text>
            <Text style={styles.resultTitle}>Exam Complete!</Text>
            <Text style={styles.resultScore}>
              {score.correct} / {score.total}
            </Text>
            <Text style={styles.resultPercentage}>{score.percentage}%</Text>
            <Text style={styles.resultMessage}>{resultMessage}</Text>
            <Text style={styles.resultTime}>Time: {timeSpent} minutes</Text>
          </Card>

          <View style={styles.resultButtons}>
            <Button title="🔄 Retake Exam" onPress={handleRetakeExam} />
            <TouchableOpacity style={styles.newExamButton} onPress={handleNewExam}>
              <Text style={styles.newExamButtonText}>📝 New Exam</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Exam Mode
  const question = questions[currentQuestion];

  return (
    <View style={styles.container}>
      <Header
        title={`Question ${currentQuestion + 1}/${questions.length}`}
        subtitle={selectedDocument?.title}
      />
      <ScrollView style={styles.content}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${((currentQuestion + 1) / questions.length) * 100}%` },
            ]}
          />
        </View>

        <Card>
          <Text style={styles.questionText}>{question.question}</Text>
        </Card>

        <View style={styles.optionsContainer}>
          {question.options.map((option, index) => (
            <TouchableOpacity
              key={index}
              style={getOptionStyle(index)}
              onPress={() => handleAnswerSelect(index)}
              disabled={showAnswer}
            >
              <Text style={styles.optionLetter}>
                {String.fromCharCode(65 + index)}
              </Text>
              <Text style={styles.optionText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {showAnswer && (
          <Card>
            <Text
              style={[
                styles.answerStatus,
                selectedAnswers[currentQuestion] === question.correctAnswer
                  ? styles.correct
                  : styles.wrong,
              ]}
            >
              {selectedAnswers[currentQuestion] === question.correctAnswer
                ? '✅ Correct!'
                : '❌ Incorrect'}
            </Text>
            <Text style={styles.explanation}>{question.explanation}</Text>
          </Card>
        )}

        <View style={styles.buttonContainer}>
          {!showAnswer ? (
            <Button title="Submit Answer" onPress={handleSubmitAnswer} />
          ) : (
            <Button
              title={
                currentQuestion < questions.length - 1
                  ? 'Next Question →'
                  : 'See Results'
              }
              onPress={handleNextQuestion}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  icon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  featureText: {
    fontSize: 16,
    color: colors.text,
  },
  configTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  configLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
    marginTop: 16,
  },
  configOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  configOption: {
    flex: 1,
    padding: 16,
    marginHorizontal: 4,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
  },
  configOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '20',
  },
  configOptionText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  configOptionTextSelected: {
    color: colors.primary,
  },
  buttonContainer: {
    marginTop: 20,
  },
  startButton: {
    marginBottom: 16,
  },
  backButton: {
    padding: 16,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    color: colors.primary,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 26,
  },
  optionsContainer: {
    marginTop: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: colors.border,
  },
  selectedOption: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  correctOption: {
    borderColor: '#4CAF50',
    backgroundColor: '#4CAF50' + '20',
  },
  wrongOption: {
    borderColor: '#F44336',
    backgroundColor: '#F44336' + '20',
  },
  optionLetter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    textAlign: 'center',
    lineHeight: 32,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginRight: 12,
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  answerStatus: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  correct: {
    color: '#4CAF50',
  },
  wrong: {
    color: '#F44336',
  },
  explanation: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  resultEmoji: {
    fontSize: 64,
    textAlign: 'center',
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  resultScore: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'center',
  },
  resultPercentage: {
    fontSize: 24,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  resultMessage: {
    fontSize: 18,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  resultTime: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  resultButtons: {
    marginTop: 20,
  },
  newExamButton: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  newExamButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
});
