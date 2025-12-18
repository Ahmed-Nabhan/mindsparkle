import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument } from '../hooks/useDocument';
import { generateVideoScript } from '../services/openai';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type VideoScreenProps = MainDrawerScreenProps<'Video'>;

export const VideoScreen: React.FC = () => {
  const route = useRoute<VideoScreenProps['route']>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [videoScript, setVideoScript] = useState<string>('');
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

  const handleGenerateVideo = async () => {
    if (!document?.content) return;
    
    setIsGenerating(true);
    try {
      const script = await generateVideoScript(document.content);
      setVideoScript(script);
    } catch (error) {
      console.error('Error generating video script:', error);
      setVideoScript('Video Script Preview:\n\nIntroduction: [AI-generated introduction]\nKey Points: [Main concepts]\nConclusion: [Summary]\n\n(Full AI video generation coming soon)');
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
      <Header title="AI Video" subtitle={document.title} />
      
      <ScrollView style={styles.content}>
        <Card>
          <Text style={styles.icon}>🎥</Text>
          <Text style={styles.title}>AI Video Generation</Text>
          <Text style={styles.description}>
            Generate an AI-powered video summary of your document. Perfect for visual learners!
          </Text>
        </Card>

        {!videoScript && !isGenerating && (
          <Button
            title="Generate Video"
            onPress={handleGenerateVideo}
            style={styles.button}
          />
        )}

        {isGenerating && (
          <Card>
            <LoadingSpinner message="Generating video script..." />
          </Card>
        )}

        {videoScript && !isGenerating && (
          <Card>
            <Text style={styles.sectionTitle}>Video Script</Text>
            <Text style={styles.scriptText}>{videoScript}</Text>
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>
                📹 Video player will be integrated here
              </Text>
            </View>
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
  scriptText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
    marginBottom: 16,
  },
  placeholder: {
    backgroundColor: colors.cardBackground,
    padding: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  placeholderText: {
    fontSize: 16,
    color: colors.textSecondary,
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
