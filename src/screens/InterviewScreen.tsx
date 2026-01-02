import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { DocumentSelector } from '../components/DocumentSelector';
import { LoadingSpinner } from '../components/LoadingSpinner';
import apiService, { callApi } from '../services/apiService';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type InterviewScreenProps = MainDrawerScreenProps<'Interview'>;

interface InterviewQuestion {
  question: string;
  type: 'technical' | 'conceptual' | 'behavioral';
  sampleAnswer: string;
  tips: string[];
}

export const InterviewScreen: React.FC = () => {
  const navigation = useNavigation<InterviewScreenProps['navigation']>();
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [mode, setMode] = useState<'select' | 'config' | 'practice' | 'feedback'>('select');
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [questionType, setQuestionType] = useState<'all' | 'technical' | 'conceptual' | 'behavioral'>('all');
  const [questionCount, setQuestionCount] = useState(5);
  const [answers, setAnswers] = useState<string[]>([]);
  
  // New states for AI feedback
  const [aiFeedback, setAiFeedback] = useState<{ score: number; feedback: string; strengths: string[]; improvements: string[] } | null>(null);
  const [isGettingFeedback, setIsGettingFeedback] = useState(false);
  const [feedbackScores, setFeedbackScores] = useState<number[]>([]);

  const handleDocumentSelect = (document: Document) => {
    setSelectedDocument(document);
    setMode('config');
  };

  const generateInterviewQuestions = async () => {
    // ENHANCED: Try multiple sources for content
    let contentToUse = selectedDocument?.content || '';
    
    // Fallback 1: Try extracted data pages
    if (!contentToUse && selectedDocument?.extractedData?.pages) {
      contentToUse = selectedDocument.extractedData.pages
        .map(p => p.text || '')
        .join('\n\n');
    }
    
    // Fallback 2: Try extracted data text
    if (!contentToUse && selectedDocument?.extractedData?.text) {
      contentToUse = selectedDocument.extractedData.text;
    }
    
    // Fallback 3: Try chunks
    if (!contentToUse && selectedDocument?.chunks && selectedDocument.chunks.length > 0) {
      contentToUse = selectedDocument.chunks.join('\n\n');
    }
    
    // Final check
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
      const typeFilter = questionType === 'all' ? '' : `Focus on ${questionType} questions.`;
      const prompt = `Based on this document content, generate ${questionCount} interview questions that would help someone prepare for a job interview related to this material. ${typeFilter}

Document content:
${contentToUse.substring(0, 8000)}

Return a JSON array with this format:
[
  {
    "question": "The interview question",
    "type": "technical|conceptual|behavioral",
    "sampleAnswer": "A good sample answer",
    "tips": ["Tip 1", "Tip 2", "Tip 3"]
  }
]

Only return the JSON array, no other text.`;

      const response = await callApi('interview', {
        content: prompt,
        temperature: 0.3
      });
      
      // Parse the response - the API returns { response: "..." }
      const responseText = response.response || response;
      const jsonMatch = typeof responseText === 'string' ? responseText.match(/\[[\s\S]*\]/) : null;
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        setQuestions(parsed);
        setAnswers(new Array(parsed.length).fill(''));
        setMode('practice');
      } else {
        throw new Error('Failed to parse questions');
      }
    } catch (error: any) {
      console.error('Error generating questions:', error);
      Alert.alert('Error', error.message || 'Failed to generate interview questions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    const newAnswers = [...answers];
    newAnswers[currentQuestion] = userAnswer;
    setAnswers(newAnswers);
    
    // Get AI feedback on the answer
    if (userAnswer.trim().length > 10) {
      setIsGettingFeedback(true);
      try {
        const question = questions[currentQuestion];
        const feedbackPrompt = `Evaluate this interview answer and provide feedback.

Question: ${question.question}
Question Type: ${question.type}
Sample/Expected Answer: ${question.sampleAnswer}

User's Answer: ${userAnswer}

Provide a JSON response with:
{
  "score": <number 1-10>,
  "feedback": "<2-3 sentences of overall feedback>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement suggestion 1>", "<improvement suggestion 2>"]
}

Be encouraging but honest. Only return the JSON.`;

        const response = await callApi('interview', {
          content: feedbackPrompt,
          temperature: 0.3
        });
        
        const responseText = response.response || response;
        const jsonMatch = typeof responseText === 'string' ? responseText.match(/\{[\s\S]*\}/) : null;
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          setAiFeedback(parsed);
          
          // Store score for summary
          const newScores = [...feedbackScores];
          newScores[currentQuestion] = parsed.score;
          setFeedbackScores(newScores);
        }
      } catch (error) {
        console.error('Error getting AI feedback:', error);
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
    setCurrentQuestion(0);
    setUserAnswer('');
    setShowAnswer(false);
    setAnswers(new Array(questions.length).fill(''));
    setMode('practice');
  };

  const handleNewInterview = () => {
    setSelectedDocument(null);
    setQuestions([]);
    setCurrentQuestion(0);
    setUserAnswer('');
    setShowAnswer(false);
    setAnswers([]);
    setMode('select');
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'technical': return '💻';
      case 'conceptual': return '🧠';
      case 'behavioral': return '🎯';
      default: return '❓';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'technical': return '#2196F3';
      case 'conceptual': return '#9C27B0';
      case 'behavioral': return '#FF9800';
      default: return colors.primary;
    }
  };

  if (isLoading) {
    return <LoadingSpinner message={loadingMessage} />;
  }

  // Document Selection Mode
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
                <Text style={styles.categoryDescription}>
                  Programming, algorithms, and problem-solving
                </Text>
              </View>
            </View>

            <View style={styles.categoryItem}>
              <Text style={styles.categoryIcon}>🧠</Text>
              <View style={styles.categoryContent}>
                <Text style={styles.categoryTitle}>Conceptual Questions</Text>
                <Text style={styles.categoryDescription}>
                  Theory, concepts, and best practices
                </Text>
              </View>
            </View>

            <View style={styles.categoryItem}>
              <Text style={styles.categoryIcon}>🎯</Text>
              <View style={styles.categoryContent}>
                <Text style={styles.categoryTitle}>Behavioral Questions</Text>
                <Text style={styles.categoryDescription}>
                  Situation-based and experience questions
                </Text>
              </View>
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
        <Header title="Configure Interview" subtitle={selectedDocument?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.configTitle}>Interview Settings</Text>

            <Text style={styles.configLabel}>Question Type</Text>
            <View style={styles.typeOptions}>
              {(['all', 'technical', 'conceptual', 'behavioral'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.typeOption,
                    questionType === type && styles.typeOptionSelected,
                  ]}
                  onPress={() => setQuestionType(type)}
                >
                  <Text style={styles.typeIcon}>
                    {type === 'all' ? '📋' : getTypeIcon(type)}
                  </Text>
                  <Text
                    style={[
                      styles.typeText,
                      questionType === type && styles.typeTextSelected,
                    ]}
                  >
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
              title="Start Practice"
              onPress={generateInterviewQuestions}
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

  // Feedback Mode
  if (mode === 'feedback') {
    return (
      <View style={styles.container}>
        <Header title="Practice Complete" subtitle={selectedDocument?.title} />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.resultEmoji}>🎉</Text>
            <Text style={styles.resultTitle}>Great Practice Session!</Text>
            <Text style={styles.resultSubtitle}>
              You've completed {questions.length} interview questions
            </Text>
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Review Your Answers</Text>
            {questions.map((q, index) => (
              <View key={index} style={styles.reviewItem}>
                <View style={styles.reviewHeader}>
                  <Text style={[styles.reviewType, { color: getTypeColor(q.type) }]}>
                    {getTypeIcon(q.type)} {q.type}
                  </Text>
                  <Text style={styles.reviewNumber}>Q{index + 1}</Text>
                </View>
                <Text style={styles.reviewQuestion}>{q.question}</Text>
                <Text style={styles.reviewLabel}>Your Answer:</Text>
                <Text style={styles.reviewAnswer}>
                  {answers[index] || '(No answer provided)'}
                </Text>
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

  // Practice Mode
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
          <View style={styles.questionHeader}>
            <Text style={[styles.questionType, { color: getTypeColor(question.type) }]}>
              {getTypeIcon(question.type)} {question.type.toUpperCase()}
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
            {/* AI Feedback Card */}
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
                  <View style={[styles.scoreBadge, { backgroundColor: aiFeedback.score >= 7 ? '#d4edda' : aiFeedback.score >= 5 ? '#fff3cd' : '#f8d7da' }]}>
                    <Text style={[styles.scoreText, { color: aiFeedback.score >= 7 ? '#155724' : aiFeedback.score >= 5 ? '#856404' : '#721c24' }]}>
                      {aiFeedback.score}/10
                    </Text>
                  </View>
                </View>
                
                <Text style={styles.feedbackText}>{aiFeedback.feedback}</Text>
                
                {aiFeedback.strengths && aiFeedback.strengths.length > 0 && (
                  <View style={styles.feedbackSection}>
                    <Text style={styles.feedbackSectionTitle}>✅ Strengths</Text>
                    {aiFeedback.strengths.map((s, i) => (
                      <Text key={i} style={styles.feedbackItem}>• {s}</Text>
                    ))}
                  </View>
                )}
                
                {aiFeedback.improvements && aiFeedback.improvements.length > 0 && (
                  <View style={styles.feedbackSection}>
                    <Text style={styles.feedbackSectionTitle}>💡 Areas to Improve</Text>
                    {aiFeedback.improvements.map((s, i) => (
                      <Text key={i} style={styles.feedbackItem}>• {s}</Text>
                    ))}
                  </View>
                )}
              </Card>
            )}
            
            <Card>
              <Text style={styles.sampleAnswerTitle}>💡 Sample Answer</Text>
              <Text style={styles.sampleAnswerText}>{question.sampleAnswer}</Text>
              
              <Text style={styles.tipsTitle}>📌 Tips</Text>
              {question.tips.map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <View style={styles.buttonContainer}>
          {!showAnswer ? (
            <Button title="Submit Answer" onPress={handleSubmitAnswer} />
          ) : (
            <Button
              title={
                currentQuestion < questions.length - 1
                  ? 'Next Question →'
                  : 'See Summary'
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
    lineHeight: 20,
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
  typeOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 2,
    borderColor: colors.border,
  },
  typeOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '20',
  },
  typeIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  typeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  typeTextSelected: {
    color: colors.primary,
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
    color: colors.textSecondary,
    marginBottom: 12,
  },
  answerInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.text,
    minHeight: 150,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sampleAnswerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  sampleAnswerText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
    marginBottom: 20,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  tipBullet: {
    color: colors.primary,
    fontSize: 16,
    marginRight: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
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
  resultSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  reviewItem: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
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
    fontWeight: '600',
    color: colors.text,
  },
  feedbackLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  feedbackLoadingText: {
    marginLeft: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  feedbackTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  scoreBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  scoreText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  feedbackText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
    marginBottom: 16,
  },
  feedbackSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  feedbackSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  feedbackItem: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    marginLeft: 8,
    marginBottom: 4,
  },
});
