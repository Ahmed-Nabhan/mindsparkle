import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { DocumentSelector } from '../components/DocumentSelector';
import { useDocument } from '../hooks/useDocument';
import { callApi, generateInterview } from '../services/apiService';
import type { Document } from '../types/document';

type InterviewMode = 'select' | 'config' | 'practice' | 'feedback';
type QuestionType = 'all' | 'technical' | 'conceptual' | 'behavioral';

interface InterviewQuestion {
  question: string;
  type: 'technical' | 'conceptual' | 'behavioral' | string;
  sampleAnswer?: string;
  tips?: string[];
}

export const InterviewScreen: React.FC = () => {
  const { getDocument } = useDocument();

  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [mode, setMode] = useState<InterviewMode>('select');
  const [questionType, setQuestionType] = useState<QuestionType>('all');
  const [questionCount, setQuestionCount] = useState(5);

  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const [aiFeedback, setAiFeedback] = useState<{ score: number; feedback: string; strengths: string[]; improvements: string[] } | null>(null);
  const [isGettingFeedback, setIsGettingFeedback] = useState(false);
  const [feedbackScores, setFeedbackScores] = useState<number[]>([]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'technical':
        return '💻';
      case 'conceptual':
        return '🧠';
      case 'behavioral':
        return '🎯';
      default:
        return '❓';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'technical':
        return '#2196F3';
      case 'conceptual':
        return '#9C27B0';
      case 'behavioral':
        return '#FF9800';
      default:
        return colors.primary;
    }
  };

  const buildInterviewContext = (doc: Document | null): string => {
    if (!doc) return '';

    const MAX_CONTEXT = 120000;
    const MAX_PAGE_SNIPPET = 4000;

    let contentToUse = doc.content || '';

    if ((!contentToUse || contentToUse.trim().length < 100) && (doc as any).extractedData?.pages) {
      let acc = '';
      for (const p of (doc as any).extractedData.pages as any[]) {
        if (acc.length >= MAX_CONTEXT) break;
        const t = String(p?.text || '').trim();
        if (!t) continue;
        acc += (acc ? '\n\n' : '') + t.slice(0, MAX_PAGE_SNIPPET);
      }
      contentToUse = acc;
    }

    if ((!contentToUse || contentToUse.trim().length < 100) && (doc as any).extractedData?.text) {
      contentToUse = String((doc as any).extractedData.text || '');
    }

    if ((!contentToUse || contentToUse.trim().length < 100) && Array.isArray((doc as any).chunks) && (doc as any).chunks.length > 0) {
      contentToUse = (doc as any).chunks.join('\n\n');
    }

    return String(contentToUse || '').slice(0, MAX_CONTEXT);
  };

  const handleDocumentSelect = (document: Document) => {
    setSelectedDocument(document);
    setMode('config');
  };

  const resetPracticeState = () => {
    setCurrentQuestion(0);
    setUserAnswer('');
    setShowAnswer(false);
    setAiFeedback(null);
    setIsGettingFeedback(false);
  };

  const generateInterviewQuestions = async () => {
    let docToUse: Document | null = selectedDocument;
    try {
      if (selectedDocument?.id) {
        const full = await getDocument(selectedDocument.id);
        if (full) docToUse = full;
      }
    } catch {
      // ignore
    }

    const contentToUse = buildInterviewContext(docToUse);
    if (!contentToUse || contentToUse.trim().length < 50) {
      Alert.alert(
        'Content Not Available',
        'Could not extract text from this document. It may be:\n\n• A scanned PDF (image-only)\n• Password protected\n• Corrupted\n\nTry uploading a text-based PDF or different document.'
      );
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Generating interview questions...');

    try {
      const generated = await generateInterview(contentToUse, questionCount, questionType);

      const normalizeType = (t: string) => {
        const s = String(t || '').toLowerCase();
        if (s.includes('behavior')) return 'behavioral';
        if (s.includes('concept')) return 'conceptual';
        if (s.includes('scenario')) return 'technical';
        if (s.includes('tech')) return 'technical';
        return 'technical';
      };

      const normalizedAll: InterviewQuestion[] = (generated || [])
        .map((q: any) => {
          const keyPoints = Array.isArray(q?.keyPoints) ? q.keyPoints.map((t: any) => String(t)) : [];
          const tips = Array.isArray(q?.tips)
            ? q.tips.map((t: any) => String(t))
            : keyPoints;

          const sampleAnswer = q?.sampleAnswer
            ? String(q.sampleAnswer)
            : (q?.expectedAnswer
              ? String(q.expectedAnswer)
              : (keyPoints.length > 0
                ? `Key points:\n- ${keyPoints.join('\n- ')}`
                : (q?.followUp ? `Follow-up: ${String(q.followUp)}` : '')));

          return {
            question: String(q?.question || '').trim(),
            type: normalizeType(q?.type || 'technical'),
            sampleAnswer,
            tips,
          };
        })
        .filter(q => q.question.length > 0);

      const normalized = questionType && questionType !== 'all'
        ? normalizedAll.filter(q => q.type === questionType)
        : normalizedAll;

      if (normalized.length === 0) {
        Alert.alert(
          'No Questions Generated',
          'Try again, or choose a different document. If this is a scanned PDF, make sure OCR extracted text.'
        );
        return;
      }

      setQuestions(normalized);
      setAnswers(new Array(normalized.length).fill(''));
      setFeedbackScores(new Array(normalized.length).fill(0));
      resetPracticeState();
      setMode('practice');
    } catch (error: any) {
      console.error('Error generating questions:', error);
      Alert.alert('Error', error?.message || 'Failed to generate interview questions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    const trimmed = userAnswer.trim();
    if (!trimmed) return;

    const newAnswers = [...answers];
    newAnswers[currentQuestion] = trimmed;
    setAnswers(newAnswers);

    if (trimmed.length > 10) {
      setIsGettingFeedback(true);
      try {
        const q = questions[currentQuestion];
        const feedbackPrompt = `Evaluate this interview answer and provide feedback.\n\nQuestion: ${q.question}\nQuestion Type: ${q.type}\nSample/Expected Answer: ${q.sampleAnswer || ''}\n\nUser's Answer: ${trimmed}\n\nProvide a JSON response with:\n{\n  \"score\": <number 1-10>,\n  \"feedback\": \"<2-3 sentences of overall feedback>\",\n  \"strengths\": [\"<strength 1>\", \"<strength 2>\"],\n  \"improvements\": [\"<improvement suggestion 1>\", \"<improvement suggestion 2>\"]\n}\n\nBe encouraging but honest. Only return the JSON.`;

        const response = await callApi('interview', { content: feedbackPrompt, temperature: 0.3 });
        const responseText = (response as any).response || response;
        const jsonMatch = typeof responseText === 'string' ? responseText.match(/\{[\s\S]*\}/) : null;
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          setAiFeedback(parsed);
          const nextScores = [...feedbackScores];
          nextScores[currentQuestion] = Number(parsed?.score || 0);
          setFeedbackScores(nextScores);
        } else {
          setAiFeedback(null);
        }
      } catch (error) {
        console.error('Error getting AI feedback:', error);
        setAiFeedback(null);
      } finally {
        setIsGettingFeedback(false);
      }
    }

    setShowAnswer(true);
  };

  const handleNextQuestion = () => {
    setShowAnswer(false);
    setUserAnswer('');
    setAiFeedback(null);

    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      setMode('feedback');
    }
  };

  const handleRetry = () => {
    resetPracticeState();
    setAnswers(new Array(questions.length).fill(''));
    setFeedbackScores(new Array(questions.length).fill(0));
    setMode('practice');
  };

  const handleNewInterview = () => {
    setSelectedDocument(null);
    setQuestions([]);
    setAnswers([]);
    setFeedbackScores([]);
    resetPracticeState();
    setMode('select');
  };

  const submitDisabled = useMemo(() => {
    if (showAnswer) return true;
    return userAnswer.trim().length === 0;
  }, [showAnswer, userAnswer]);

  if (isLoading) {
    return <LoadingSpinner message={loadingMessage} />;
  }

  if (mode === 'select') {
    return (
      <View style={styles.container}>
        <Header title="Interview Tests" subtitle="Prepare for technical interviews" />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.icon}>💼</Text>
            <Text style={styles.title}>Interview Preparation</Text>
            <Text style={styles.description}>
              Practice with AI-generated interview questions based on your study materials.
            </Text>
          </Card>

          <DocumentSelector
            onDocumentSelect={handleDocumentSelect}
            title="Select Study Material"
            subtitle="Choose a document to generate interview questions from"
          />

          <Card>
            <Text style={styles.sectionTitle}>Interview Categories</Text>

            <View style={styles.categoryItem}>
              <Text style={styles.categoryIcon}>💻</Text>
              <View style={styles.categoryContent}>
                <Text style={styles.categoryTitle}>Technical Questions</Text>
                <Text style={styles.categoryDescription}>Programming, algorithms, and problem-solving</Text>
              </View>
            </View>

            <View style={styles.categoryItem}>
              <Text style={styles.categoryIcon}>🧠</Text>
              <View style={styles.categoryContent}>
                <Text style={styles.categoryTitle}>Conceptual Questions</Text>
                <Text style={styles.categoryDescription}>Theory, concepts, and best practices</Text>
              </View>
            </View>

            <View style={styles.categoryItem}>
              <Text style={styles.categoryIcon}>🎯</Text>
              <View style={styles.categoryContent}>
                <Text style={styles.categoryTitle}>Behavioral Questions</Text>
                <Text style={styles.categoryDescription}>Situation-based and experience questions</Text>
              </View>
            </View>
          </Card>
        </ScrollView>
      </View>
    );
  }

  if (mode === 'config') {
    return (
      <View style={styles.container}>
        <Header title="Configure Interview" subtitle={selectedDocument?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.configTitle}>Interview Settings</Text>

            <Text style={styles.configLabel}>Question Type</Text>
            <View style={styles.typeOptions}>
              {(['all', 'technical', 'conceptual', 'behavioral'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeOption, questionType === type && styles.typeOptionSelected]}
                  onPress={() => setQuestionType(type)}
                >
                  <Text style={styles.typeIcon}>{type === 'all' ? '📋' : getTypeIcon(type)}</Text>
                  <Text style={[styles.typeText, questionType === type && styles.typeTextSelected]}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.configLabel}>Number of Questions</Text>
            <View style={styles.configOptions}>
              {[3, 5, 7, 10].map((count) => (
                <TouchableOpacity
                  key={count}
                  style={[styles.configOption, questionCount === count && styles.configOptionSelected]}
                  onPress={() => setQuestionCount(count)}
                >
                  <Text style={[styles.configOptionText, questionCount === count && styles.configOptionTextSelected]}>
                    {count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          <View style={styles.buttonContainer}>
            <Button title="Start Practice" onPress={generateInterviewQuestions} style={styles.startButton} />
            <TouchableOpacity style={styles.backButton} onPress={() => setMode('select')}>
              <Text style={styles.backButtonText}>← Choose Different Document</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (mode === 'feedback') {
    return (
      <View style={styles.container}>
        <Header title="Practice Complete" subtitle={selectedDocument?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.resultEmoji}>🎉</Text>
            <Text style={styles.resultTitle}>Great Practice Session!</Text>
            <Text style={styles.resultSubtitle}>You've completed {questions.length} interview questions</Text>
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Review Your Answers</Text>
            {questions.map((q, index) => (
              <View key={index} style={styles.reviewItem}>
                <View style={styles.reviewHeader}>
                  <Text style={[styles.reviewType, { color: getTypeColor(q.type) }]}>
                    {getTypeIcon(q.type)} {String(q.type)}
                  </Text>
                  <Text style={styles.reviewNumber}>Q{index + 1}</Text>
                </View>
                <Text style={styles.reviewQuestion}>{q.question}</Text>
                <Text style={styles.reviewLabel}>Your Answer:</Text>
                <Text style={styles.reviewAnswer}>{answers[index] || '(No answer provided)'}</Text>
              </View>
            ))}
          </Card>

          <View style={styles.buttonContainer}>
            <Button title="🔄 Practice Again" onPress={handleRetry} />
            <TouchableOpacity style={styles.newButton} onPress={handleNewInterview}>
              <Text style={styles.newButtonText}>📝 New Interview</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  const question = questions[currentQuestion];

  return (
    <View style={styles.container}>
      <Header title={`Question ${currentQuestion + 1}/${questions.length}`} subtitle={selectedDocument?.title} />
      <ScrollView style={styles.content}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((currentQuestion + 1) / questions.length) * 100}%` }]} />
        </View>

        <Card>
          <View style={styles.questionHeader}>
            <Text style={[styles.questionType, { color: getTypeColor(question.type) }]}> 
              {getTypeIcon(question.type)} {String(question.type).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.questionText}>{question.question}</Text>
        </Card>

        <Card>
          <Text style={styles.answerLabel}>Your Answer</Text>
          <TextInput
            style={styles.answerInput}
            multiline
            numberOfLines={6}
            placeholder="Type your answer here..."
            placeholderTextColor={colors.textSecondary}
            value={userAnswer}
            onChangeText={setUserAnswer}
            editable={!showAnswer}
          />
        </Card>

        {showAnswer && (
          <>
            {isGettingFeedback && (
              <Card>
                <View style={styles.feedbackLoading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.feedbackLoadingText}>Analyzing your answer...</Text>
                </View>
              </Card>
            )}

            {aiFeedback && (
              <Card>
                <View style={styles.feedbackHeader}>
                  <Text style={styles.feedbackTitle}>🤖 AI Feedback</Text>
                  <View
                    style={[
                      styles.scoreBadge,
                      {
                        backgroundColor:
                          aiFeedback.score >= 7 ? '#d4edda' : aiFeedback.score >= 5 ? '#fff3cd' : '#f8d7da',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.scoreText,
                        {
                          color:
                            aiFeedback.score >= 7
                              ? '#155724'
                              : aiFeedback.score >= 5
                                ? '#856404'
                                : '#721c24',
                        },
                      ]}
                    >
                      {aiFeedback.score}/10
                    </Text>
                  </View>
                </View>

                <Text style={styles.feedbackText}>{aiFeedback.feedback}</Text>

                {aiFeedback.strengths?.length ? (
                  <View style={styles.feedbackSection}>
                    <Text style={styles.feedbackSectionTitle}>✅ Strengths</Text>
                    {aiFeedback.strengths.map((s, i) => (
                      <Text key={i} style={styles.feedbackItem}>• {s}</Text>
                    ))}
                  </View>
                ) : null}

                {aiFeedback.improvements?.length ? (
                  <View style={styles.feedbackSection}>
                    <Text style={styles.feedbackSectionTitle}>💡 Areas to Improve</Text>
                    {aiFeedback.improvements.map((s, i) => (
                      <Text key={i} style={styles.feedbackItem}>• {s}</Text>
                    ))}
                  </View>
                ) : null}
              </Card>
            )}

            {(question.sampleAnswer || (question.tips && question.tips.length > 0)) && (
              <Card>
                {!!question.sampleAnswer && (
                  <>
                    <Text style={styles.sampleAnswerTitle}>💡 Sample Answer</Text>
                    <Text style={styles.sampleAnswerText}>{question.sampleAnswer}</Text>
                  </>
                )}

                {!!question.tips?.length && (
                  <>
                    <Text style={styles.tipsTitle}>📌 Tips</Text>
                    {question.tips.map((tip, index) => (
                      <View key={index} style={styles.tipItem}>
                        <Text style={styles.tipBullet}>•</Text>
                        <Text style={styles.tipText}>{tip}</Text>
                      </View>
                    ))}
                  </>
                )}
              </Card>
            )}
          </>
        )}

        <View style={styles.buttonContainer}>
          {!showAnswer ? (
            <Button title="Submit Answer" onPress={handleSubmitAnswer} disabled={submitDisabled} />
          ) : (
            <Button
              title={currentQuestion < questions.length - 1 ? 'Next Question →' : 'See Summary'}
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
    marginBottom: 16,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  categoryIcon: {
    fontSize: 36,
    marginRight: 16,
  },
  categoryContent: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  categoryDescription: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  configTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  configLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    marginTop: 16,
  },
  typeOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  typeOption: {
    width: '48%',
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.cardBackground,
  },
  typeIcon: {
    fontSize: 20,
    marginBottom: 6,
  },
  typeText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  typeTextSelected: {
    color: colors.primary,
  },
  configOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  configOption: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  configOptionSelected: {
    borderColor: colors.primary,
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
  questionHeader: {
    marginBottom: 12,
  },
  questionType: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 26,
  },
  answerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  answerInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    minHeight: 140,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  feedbackLoading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedbackLoadingText: {
    marginLeft: 12,
    color: colors.textSecondary,
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  feedbackTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  scoreText: {
    fontWeight: '800',
  },
  feedbackText: {
    color: colors.text,
    lineHeight: 20,
  },
  feedbackSection: {
    marginTop: 12,
  },
  feedbackSectionTitle: {
    fontWeight: '700',
    marginBottom: 6,
    color: colors.text,
  },
  feedbackItem: {
    color: colors.text,
    marginBottom: 4,
  },
  sampleAnswerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  sampleAnswerText: {
    color: colors.text,
    lineHeight: 20,
    marginBottom: 12,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  tipBullet: {
    marginRight: 8,
    color: colors.text,
  },
  tipText: {
    flex: 1,
    color: colors.text,
    lineHeight: 20,
  },
  resultEmoji: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    color: colors.text,
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  reviewItem: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewType: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  reviewNumber: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: 'bold',
  },
  reviewQuestion: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  reviewLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  reviewAnswer: {
    fontSize: 14,
    color: colors.text,
    fontStyle: 'italic',
  },
  newButton: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  newButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
});
