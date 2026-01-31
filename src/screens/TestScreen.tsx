import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { DocumentSelector } from '../components/DocumentSelector';
import { useDocument } from '../hooks/useDocument';
import { usePerformance } from '../hooks/usePerformance';
import { generateQuiz } from '../services/openai';
import { supabase } from '../services/supabase';
import { generateId } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';
import type { QuizQuestion, TestResult } from '../types/performance';

type TestScreenProps = MainDrawerScreenProps<'Test'>;

export const TestScreen: React.FC = () => {
  const route = useRoute<TestScreenProps['route']>();
  const navigation = useNavigation<TestScreenProps['navigation']>();
  const { getDocument } = useDocument();
  const { saveResult } = usePerformance();
  const [document, setDocument] = useState<Document | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [mode, setMode] = useState<'select' | 'config' | 'test' | 'results'>('select');
  const [questionCount, setQuestionCount] = useState(5);
  const focusTopics = (route.params as any)?.focusTopics as string[] | undefined;

  // Check if we came from DocumentActions with a documentId
  useEffect(() => {
    const docId = route.params?.documentId;
    if (docId) {
      loadDocumentFromParams(docId);
    }
  }, []);

  const loadDocumentFromParams = async (docId: string) => {
    setIsLoading(true);
    const doc = await getDocument(docId);
    if (doc) {
      setDocument(doc);
      setMode('config');
    }
    setIsLoading(false);
  };

  const handleDocumentSelect = (doc: Document) => {
    setDocument(doc);
    setMode('config');
  };

  const handleGenerateQuiz = async () => {
    setIsGenerating(true);
    setLoadingMessage('Loading document content...');
    
    console.log('[TestScreen] Starting quiz generation for document:', document?.id);
    console.log('[TestScreen] Local content length:', document?.content?.length || 0);
    
    // ENHANCED: Try multiple sources for content
    let contentToUse = document?.content || '';
    
    // Fallback 1: Try extracted data pages
    if ((!contentToUse || contentToUse.length < 100) && document?.extractedData?.pages) {
      const MAX_CONTEXT = 250000;
      const MAX_PAGE_SNIPPET = 4000;
      let acc = '';
      for (const p of document.extractedData.pages as any[]) {
        if (acc.length >= MAX_CONTEXT) break;
        const t = String(p?.text || '').trim();
        if (!t) continue;
        acc += (acc ? '\n\n' : '') + t.slice(0, MAX_PAGE_SNIPPET);
      }
      contentToUse = acc;
      console.log('[TestScreen] Using extractedData.pages:', contentToUse.length, 'chars');
    }
    
    // Fallback 2: Try extracted data text
    if ((!contentToUse || contentToUse.length < 100) && document?.extractedData?.text) {
      contentToUse = document.extractedData.text;
      console.log('[TestScreen] Using extractedData.text:', contentToUse.length, 'chars');
    }

    // Add structured context (tables / image captions) if available
    if (document?.extractedData && contentToUse && contentToUse.length < 250000) {
      try {
        const tables = Array.isArray(document.extractedData.tables) ? document.extractedData.tables.slice(0, 15) : [];
        const images = Array.isArray(document.extractedData.images) ? document.extractedData.images.slice(0, 20) : [];
        const tableText = tables.length
          ? '\n\nTABLES (extracted):\n' + tables.map((t: any) => {
              const headers = Array.isArray(t.headers) ? t.headers.join(' | ') : '';
              const rows = Array.isArray(t.rows) ? t.rows.slice(0, 10).map((r: any) => (Array.isArray(r) ? r.join(' | ') : String(r))).join('\n') : '';
              return `- ${t.title || 'Table'} (p.${t.pageNumber || '?'})\n${headers}\n${rows}`;
            }).join('\n\n')
          : '';
        const imageText = images.length
          ? '\n\nIMAGES (captions):\n' + images.map((img: any) => `- (p.${img.pageNumber || '?'}) ${String(img.caption || '').trim()}`).filter(Boolean).join('\n')
          : '';

        const combined = `${contentToUse}${tableText}${imageText}`;
        contentToUse = combined.slice(0, 300000);
      } catch {
        // ignore
      }
    }
    
    // Fallback 3: Try chunks
    if ((!contentToUse || contentToUse.length < 100) && document?.chunks && document.chunks.length > 0) {
      contentToUse = document.chunks.join('\n\n');
      console.log('[TestScreen] Using chunks:', contentToUse.length, 'chars');
    }
    
    console.log('[TestScreen] Content before cloud fetch:', contentToUse?.length || 0, 'chars');
    
    // Fallback 4: Try fetching from cloud if local content is truncated or missing
    if (!contentToUse || contentToUse.length < 100 || contentToUse.includes('[TRUNCATED]')) {
      try {
        setLoadingMessage('Fetching content from cloud...');
        console.log('[TestScreen] Fetching from cloud for document:', document?.id);
        const { data: cloudDoc, error } = await supabase
          .from('documents')
          .select('extracted_text, content')
          .eq('id', document?.id)
          .single();
        
        console.log('[TestScreen] Cloud fetch result:', error ? 'ERROR' : 'SUCCESS', 
          'extracted_text:', cloudDoc?.extracted_text?.length || 0,
          'content:', cloudDoc?.content?.length || 0);
        
        if (!error && cloudDoc) {
          const cloudContent = cloudDoc.extracted_text || cloudDoc.content;
          if (cloudContent && cloudContent.length > (contentToUse?.length || 0)) {
            contentToUse = cloudContent;
            console.log('[TestScreen] Using cloud content:', contentToUse.length, 'chars');
          }
        } else if (error) {
          console.log('[TestScreen] Cloud fetch error:', error);
        }
      } catch (cloudError) {
        console.log('[TestScreen] Cloud fetch failed:', cloudError);
      }
    }
    
    console.log('[TestScreen] Final content length:', contentToUse?.length || 0, 'chars');
    
    // Final check
    if (!contentToUse || contentToUse.trim().length < 50) {
      setIsGenerating(false);
      Alert.alert(
        'Content Not Available', 
        'Could not extract text from this document. It may be:\n\n• A scanned PDF (image-only)\n• Password protected\n• Corrupted\n\nTry uploading a text-based PDF or different document.'
      );
      return;
    }

    setLoadingMessage('Generating quiz questions...');

    try {
      const quiz = await generateQuiz(
        contentToUse,
        document?.chunks,
        questionCount,
        (progress, message) => setLoadingMessage(message),
        document?.fileUri,
        document?.fileType,
        document?.extractedData,
        focusTopics
      );

      if (quiz && quiz.length > 0) {
        setQuestions(quiz);
        setSelectedAnswers(new Array(quiz.length).fill(-1));
        setMode('test');
      } else {
        Alert.alert('Error', 'Failed to generate questions');
      }
    } catch (error: any) {
      console.error('Error generating quiz:', error);
      Alert.alert('Error', error.message || 'Failed to generate quiz');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswerSelect = (answerIndex: number) => {
    if (showAnswer) return;
    const newAnswers = [...selectedAnswers];
    newAnswers[currentQuestion] = answerIndex;
    setSelectedAnswers(newAnswers);
  };

  const handleSubmitAnswer = () => {
    if (selectedAnswers[currentQuestion] === -1) {
      Alert.alert('Select an Answer', 'Please select an answer before continuing.');
      return;
    }
    setShowAnswer(true);
  };

  const handleNext = () => {
    setShowAnswer(false);
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      handleSubmitTest();
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setShowAnswer(false);
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleSubmitTest = async () => {
    const correctAnswers = questions.filter(
      (q, index) => q.correctAnswer === selectedAnswers[index]
    ).length;

    const score = (correctAnswers / questions.length) * 100;

    const result: TestResult = {
      id: generateId(),
      documentId: document?.id || '',
      userId: 'current-user',
      score,
      totalQuestions: questions.length,
      correctAnswers,
      completedAt: new Date(),
      timeSpent: 300,
      testType: 'quiz',
    };

    await saveResult(result);
    setMode('results');
  };

  const handleRetakeTest = () => {
    setSelectedAnswers(new Array(questions.length).fill(-1));
    setCurrentQuestion(0);
    setShowAnswer(false);
    setMode('test');
  };

  const handleNewTest = () => {
    setDocument(null);
    setQuestions([]);
    setCurrentQuestion(0);
    setSelectedAnswers([]);
    setShowAnswer(false);
    setMode('select');
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
    return <LoadingSpinner message="Loading document..." />;
  }

  if (isGenerating) {
    return <LoadingSpinner message={loadingMessage} />;
  }

  // Document Selection Mode
  if (mode === 'select') {
    return (
      <View style={styles.container}>
        <Header title="Quick Test" subtitle="Test your knowledge" />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.icon}>✏️</Text>
            <Text style={styles.title}>AI-Generated Quiz</Text>
            <Text style={styles.description}>
              Test your understanding with AI-generated questions based on your study materials.
            </Text>
          </Card>

          <DocumentSelector
            onDocumentSelect={handleDocumentSelect}
            title="Select Study Material"
            subtitle="Choose a document to generate quiz questions from"
          />

          <Card>
            <Text style={styles.sectionTitle}>Features</Text>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>🤖</Text>
              <Text style={styles.featureText}>AI-powered question generation</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>📝</Text>
              <Text style={styles.featureText}>Multiple choice questions</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>💡</Text>
              <Text style={styles.featureText}>Instant feedback with explanations</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>📈</Text>
              <Text style={styles.featureText}>Track your progress</Text>
            </View>
          </Card>
        </ScrollView>
      </View>
    );
  }

  // Configuration Mode
  if (mode === 'config') {
    return (
      <View style={styles.container}>
        <Header title="Configure Test" subtitle={document?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.configTitle}>Test Settings</Text>

            <Text style={styles.configLabel}>Number of Questions</Text>
            <View style={styles.configOptions}>
              {[3, 5, 7, 10].map((count) => (
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
          </Card>

          <View style={styles.buttonContainer}>
            <Button
              title="Start Test"
              onPress={handleGenerateQuiz}
              style={styles.startButton}
            />
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setMode('select')}
            >
              <Text style={styles.backButtonText}>← Choose Different Document</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Results Mode
  if (mode === 'results') {
    const correctAnswers = questions.filter(
      (q, index) => q.correctAnswer === selectedAnswers[index]
    ).length;
    const score = (correctAnswers / questions.length) * 100;

    let resultEmoji = '🏆';
    let resultMessage = 'Excellent work!';
    if (score < 80) {
      resultEmoji = '👍';
      resultMessage = 'Good job!';
    }
    if (score < 60) {
      resultEmoji = '📚';
      resultMessage = 'Keep practicing!';
    }
    if (score < 40) {
      resultEmoji = '💪';
      resultMessage = 'Review and try again!';
    }

    return (
      <View style={styles.container}>
        <Header title="Test Results" subtitle={document?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.resultEmoji}>{resultEmoji}</Text>
            <Text style={styles.resultTitle}>Test Complete!</Text>
            <Text style={styles.resultScore}>{score.toFixed(0)}%</Text>
            <Text style={styles.resultDetails}>
              {correctAnswers} out of {questions.length} correct
            </Text>
            <Text style={styles.resultMessage}>{resultMessage}</Text>
          </Card>

          <View style={styles.resultButtons}>
            <Button title="🔄 Retake Test" onPress={handleRetakeTest} />
            <TouchableOpacity style={styles.newTestButton} onPress={handleNewTest}>
              <Text style={styles.newTestButtonText}>📝 New Test</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Test Mode
  const question = questions[currentQuestion];

  return (
    <View style={styles.container}>
      <Header
        title={`Question ${currentQuestion + 1}/${questions.length}`}
        subtitle={document?.title}
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
            {question.explanation && (
              <Text style={styles.explanation}>{question.explanation}</Text>
            )}
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
              onPress={handleNext}
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
    marginBottom: 16,
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
    marginBottom: 40,
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
  resultDetails: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  resultMessage: {
    fontSize: 18,
    color: colors.text,
    textAlign: 'center',
  },
  resultButtons: {
    marginTop: 20,
  },
  newTestButton: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  newTestButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
});
