import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument } from '../hooks/useDocument';
import { generateStudyGuide } from '../services/openai';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type StudyScreenProps = MainDrawerScreenProps<'Study'>;

export const StudyScreen: React.FC = () => {
  const route = useRoute<StudyScreenProps['route']>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [studyGuide, setStudyGuide] = useState<string>('');
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

  const handleGenerateStudyGuide = async () => {
    if (!document?.content) return;
    
    setIsGenerating(true);
    try {
      const guide = await generateStudyGuide(document.content);
      setStudyGuide(guide);
    } catch (error) {
      console.error('Error generating study guide:', error);
      setStudyGuide('Study Guide:\n\n1. Key Concepts\n2. Important Terms\n3. Practice Questions\n4. Summary\n\n(AI generation placeholder)');
    } finally {
      setIsGenerating(false);
    }
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

  return (
    <View style={styles.container}>
      <Header title="Study Mode" subtitle={document.title} />
      
      <ScrollView style={styles.content}>
        <Card>
          <Text style={styles.icon}>📚</Text>
          <Text style={styles.title}>AI-Assisted Study</Text>
          <Text style={styles.description}>
            Generate a comprehensive study guide from your document with key concepts, terms, and practice questions.
          </Text>
        </Card>

        {!studyGuide && !isGenerating && (
          <Button
            title="Generate Study Guide"
            onPress={handleGenerateStudyGuide}
            style={styles.button}
          />
        )}

        {isGenerating && (
          <Card>
            <LoadingSpinner message="Generating study guide..." />
          </Card>
        )}

        {studyGuide && !isGenerating && (
          <Card>
            <Text style={styles.sectionTitle}>Study Guide</Text>
            <Text style={styles.guideText}>{studyGuide}</Text>
          </Card>
        )}
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  guideText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
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
