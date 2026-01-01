import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument } from '../hooks/useDocument';
import { generateSummary } from '../services/openai';
import { updateDocumentSummary } from '../services/storage';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type SummaryScreenProps = MainDrawerScreenProps<'Summary'>;

export const SummaryScreen: React.FC = () => {
  const route = useRoute<SummaryScreenProps['route']>();
  const navigation = useNavigation<any>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [summaryImage, setSummaryImage] = useState<string | null>(null);
  const [displaySummary, setDisplaySummary] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  useEffect(() => {
    loadDocumentAndSummary();
  }, []);

  // Parse summary for images whenever it changes
  useEffect(() => {
    if (summary) {
      // Check for markdown image at the start: ![Alt](Url)
      const imgMatch = summary.match(/^!\[.*?\]\((.*?)\)\n\n/);
      if (imgMatch) {
        setSummaryImage(imgMatch[1]);
        setDisplaySummary(summary.replace(imgMatch[0], ''));
      } else {
        setSummaryImage(null);
        setDisplaySummary(summary);
      }
    } else {
      setSummaryImage(null);
      setDisplaySummary('');
    }
  }, [summary]);

  const loadDocumentAndSummary = async () => {
    const doc = await getDocument(route.params. documentId);
    setDocument(doc);
    
    if (doc?. summary) {
      setSummary(doc. summary);
    }
    setIsLoading(false);
  };

  const handleProgress = (prog: number, message:  string) => {
    setProgress(prog);
    setProgressMessage(message);
  };

  const handleGenerateSummary = async () => {
    if (!document) return;
    
    setIsGenerating(true);
    setProgress(0);
    setProgressMessage('Starting...');

    try {
      // Pass existing extracted data to avoid re-uploading to cloud
      const generatedSummary = await generateSummary(
        document.content || '',
        document.chunks,
        handleProgress,
        document.fileUri,
        document.fileType,
        document.pdfCloudUrl,  // Pass existing cloud URL
        document.extractedData  // Pass existing extracted data
      );
      setSummary(generatedSummary);
      
      // Save summary to document for future instant access
      await updateDocumentSummary(document.id, generatedSummary);
    } catch (error:  any) {
      console.error('Error generating summary:', error);
      setSummary('Failed to generate summary:  ' + (error.message || 'Unknown error'));
    } finally {
      setIsGenerating(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading document..." />;
  }

  if (! document) {
    return (
      <View style={styles.container}>
        <Header title="Document Not Found" />
        <View style={styles.content}>
          <Text style={styles.errorText}>Document not found</Text>
        </View>
      </View>
    );
  }

  const handleBack = () => {
    navigation.navigate('DocumentActions', { documentId: route.params.documentId });
  };

  return (
    <View style={styles.container}>
      <Header title="Summary" subtitle={document.title} />
      
      <ScrollView style={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>← Back to Actions</Text>
        </TouchableOpacity>
        {/* File info */}
        {document.isLargeFile && (
          <Card>
            <Text style={styles.infoLabel}>Large Document Detected</Text>
            <Text style={styles.infoText}>
              This document has {document.totalChunks} sections and will be processed in parts.
            </Text>
          </Card>
        )}

        {! summary && ! isGenerating && (
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
            <Text style={styles.progressTitle}>Generating Summary... </Text>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBar, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{progressMessage}</Text>
            <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
          </Card>
        )}

        {summary && ! isGenerating && (
          <Card>
            <Text style={styles.sectionTitle}>AI Summary</Text>
            
            {summaryImage && (
              <Image 
                source={{ uri: summaryImage }} 
                style={styles.summaryImage} 
                resizeMode="cover"
              />
            )}
            
            <Text style={styles.summaryText}>{displaySummary}</Text>
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

const styles = StyleSheet. create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding:  16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  summaryImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: colors.surface,
  },
  summaryText:  {
    fontSize:  16,
    color: colors.text,
    lineHeight: 24,
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color:  colors.primary,
    marginBottom: 4,
  },
  infoText:  {
    fontSize:  14,
    color:  colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color:  colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
  button: {
    marginTop: 8,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  progressBarContainer:  {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color:  colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  progressPercent:  {
    fontSize:  18,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
});
