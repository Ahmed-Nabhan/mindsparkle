import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument } from '../hooks/useDocument';
import { generateSummary } from '../services/openai';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type SummaryScreenProps = MainDrawerScreenProps<'Summary'>;

export const SummaryScreen: React.FC = () => {
  const route = useRoute<SummaryScreenProps['route']>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    loadDocumentAndSummary();
  }, []);

  const loadDocumentAndSummary = async () => {
    const doc = await getDocument(route.params.documentId);
    setDocument(doc);
    
    if (doc?.summary) {
      setSummary(doc.summary);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!document?.content) return;
    
    setIsGenerating(true);
    try {
      const generatedSummary = await generateSummary(document.content);
      setSummary(generatedSummary);
    } catch (error) {
      console.error('Error generating summary:', error);
      setSummary('Failed to generate summary. This is a placeholder summary for demonstration purposes.');
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
      <Header title="Summary" subtitle={document.title} />
      
      <ScrollView style={styles.content}>
        {!summary && !isGenerating && (
          <Card>
            <Text style={styles.infoText}>
              No summary available yet. Generate one now!
            </Text>
            <Button
              title="Generate Summary"
              onPress={handleGenerateSummary}
              style={styles.button}
            />
          </Card>
        )}

        {isGenerating && (
          <Card>
            <LoadingSpinner message="Generating summary..." />
          </Card>
        )}

        {summary && !isGenerating && (
          <Card>
            <Text style={styles.sectionTitle}>AI Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
            <Button
              title="Regenerate"
              onPress={handleGenerateSummary}
              variant="outline"
              style={styles.button}
            />
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
  button: {
    marginTop: 8,
  },
});
