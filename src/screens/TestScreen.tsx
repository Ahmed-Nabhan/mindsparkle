import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument } from '../hooks/useDocument';
import { usePerformance } from '../hooks/usePerformance';
import { generateQuiz } from '../services/openai';
import { generateId } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';
import type { QuizQuestion, TestResult } from '../types/performance';

type TestScreenProps = MainDrawerScreenProps<'Test'>;

export const TestScreen: React.FC = () => {
  const route = useRoute<TestScreenProps['route']>();
  const { getDocument } = useDocument();
  const { saveResult } = usePerformance();
  const [document, setDocument] = useState<Document | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    loadDocument();
  }, []);

  const loadDocument = async () => {
    const doc = await getDocument(route.params.documentId);
    setDocument(doc);
    setIsLoading(false);
  };

  const handleGenerateQuiz = async () => {
    if (!document?.content) return;
    
    setIsGenerating(true);
    try {
      const quiz = await generateQuiz(document.content, 5);
      setQuestions(quiz);
    } catch (error) {
      console.error('Error generating quiz:', error);
      // Fallback to sample questions
      setQuestions([
        {
          id: '1',
          question: 'What is the main topic of this document?',
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correctAnswer: 0,
        },
        {
          id: '2',
          question: 'Which concept is emphasized?',
          options: ['Concept 1', 'Concept 2', 'Concept 3', 'Concept 4'],
          correctAnswer: 1,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswerSelect = (answerIndex: number) => {
    const newAnswers = [...selectedAnswers];
    newAnswers[currentQuestion] = answerIndex;
    setSelectedAnswers(newAnswers);
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleSubmit = async () => {
    const correctAnswers = questions.filter(
      (q, index) => q.correctAnswer === selectedAnswers[index]
    ).length;
    
    const score = (correctAnswers / questions.length) * 100;
    
    const result: TestResult = {
      id: generateId(),
      documentId: document?.id || '',
      userId: 'current-user', // Would come from auth
      score,
      totalQuestions: questions.length,
      correctAnswers,
      completedAt: new Date(),
      timeSpent: 300, // Would track actual time
      testType: 'quiz',
    };

    await saveResult(result);
    setShowResults(true);
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading document..." />;
  }

  if (!document) {
    return (
      <View style={styles.container}>
        <Header title="Document Not Found" />
        <View style={styles.content}>
          <Text style={styles.errorText}>Document not found</Text>
        </View>
      </View>
    );
  }

  if (showResults) {
    const correctAnswers = questions.filter(
      (q, index) => q.correctAnswer === selectedAnswers[index]
    ).length;
    const score = (correctAnswers / questions.length) * 100;

    return (
      <View style={styles.container}>
        <Header title="Test Results" subtitle={document.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.resultIcon}>
              {score >= 70 ? '🎉' : score >= 50 ? '👍' : '📚'}
            </Text>
            <Text style={styles.resultTitle}>Your Score</Text>
            <Text style={styles.resultScore}>{score.toFixed(0)}%</Text>
            <Text style={styles.resultDetails}>
              {correctAnswers} out of {questions.length} correct
            </Text>
          </Card>
        </ScrollView>
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <View style={styles.container}>
        <Header title="Test" subtitle={document.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.icon}>✏️</Text>
            <Text style={styles.title}>AI-Generated Quiz</Text>
            <Text style={styles.description}>
              Test your knowledge with AI-generated questions based on your document.
            </Text>
          </Card>

          {isGenerating ? (
            <LoadingSpinner message="Generating quiz..." />
          ) : (
            <Button
              title="Generate Quiz"
              onPress={handleGenerateQuiz}
              style={styles.button}
            />
          )}
        </ScrollView>
      </View>
    );
  }

  const question = questions[currentQuestion];

  return (
    <View style={styles.container}>
      <Header 
        title={`Question ${currentQuestion + 1}/${questions.length}`}
        subtitle={document.title}
      />
      
      <ScrollView style={styles.content}>
        <Card>
          <Text style={styles.questionText}>{question.question}</Text>
          
          <View style={styles.optionsContainer}>
            {question.options.map((option, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.option,
                  selectedAnswers[currentQuestion] === index && styles.selectedOption,
                ]}
                onPress={() => handleAnswerSelect(index)}
              >
                <Text
                  style={[
                    styles.optionText,
                    selectedAnswers[currentQuestion] === index && styles.selectedOptionText,
                  ]}
                >
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <View style={styles.navigation}>
          {currentQuestion > 0 && (
            <Button
              title="Previous"
              onPress={handlePrevious}
              variant="outline"
              style={styles.navButton}
            />
          )}
          
          {currentQuestion < questions.length - 1 ? (
            <Button
              title="Next"
              onPress={handleNext}
              style={styles.navButton}
              disabled={selectedAnswers[currentQuestion] === undefined}
            />
          ) : (
            <Button
              title="Submit"
              onPress={handleSubmit}
              style={styles.navButton}
              disabled={selectedAnswers.length !== questions.length}
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
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 24,
    lineHeight: 26,
  },
  optionsContainer: {
    marginTop: 8,
  },
  option: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: 12,
    backgroundColor: colors.background,
  },
  selectedOption: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  optionText: {
    fontSize: 16,
    color: colors.text,
  },
  selectedOptionText: {
    color: colors.primary,
    fontWeight: '600',
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  navButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  resultIcon: {
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
    marginBottom: 8,
  },
  resultDetails: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
  button: {
    margin: 16,
  },
});
