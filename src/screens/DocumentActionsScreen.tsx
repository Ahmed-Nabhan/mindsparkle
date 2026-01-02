import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Header } from '../components/Header';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import { useDocumentContext } from '../context/DocumentContext';
import { usePremiumContext } from '../context/PremiumContext';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

/**
 * DocumentActionsScreen - Shows available actions for a document
 * 
 * REAL-TIME INTEGRATION:
 * - Subscribes to document-specific changes on mount
 * - Receives instant updates when AI processing completes
 * - Unsubscribes on unmount to prevent memory leaks
 * 
 * @component
 */

type DocumentActionsScreenProps = MainDrawerScreenProps<'DocumentActions'>;

export const DocumentActionsScreen:  React.FC = () => {
  const route = useRoute<DocumentActionsScreenProps['route']>();
  const navigation = useNavigation<DocumentActionsScreenProps['navigation']>();
  const { getDocument } = useDocument();
  const { isPremium, features, canAccessFeature } = usePremiumContext();
  
  // Get real-time context values
  const { 
    subscribeToDocument, 
    unsubscribeFromDocument,
    documentAnalysis,
    documentSummaries,
    isProcessing,
    processingMessage,
    loadStoredAIData,
  } = useDocumentContext();
  
  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Load document and subscribe to real-time updates on mount
   * This ensures we get instant updates when:
   * - AI processing status changes
   * - New summaries are generated
   * - Knowledge graph is built
   */
  useEffect(() => {
    const documentId = route.params.documentId;
    
    // Load initial document data
    loadDocument();
    
    // Subscribe to real-time updates for this document
    // This creates a Supabase Realtime channel for document_analysis, ai_summaries, etc.
    subscribeToDocument(documentId);
    
    // Also load any existing AI data from Supabase
    loadStoredAIData(documentId);
    
    // Cleanup: Unsubscribe when leaving this screen
    // CRITICAL: Prevents memory leaks from orphaned WebSocket connections
    return () => {
      console.log('[DocumentActionsScreen] Cleaning up - unsubscribing from document');
      unsubscribeFromDocument();
    };
  }, [route.params.documentId]);

  const loadDocument = async () => {
    const doc = await getDocument(route.params.documentId);
    setDocument(doc);
    setIsLoading(false);
  };

  const handleSummarize = () => {
    if (!document) return;
    navigation.navigate('Summary', { documentId: document.id });
  };

  const handleStudy = () => {
    if (!document) return;
    navigation.navigate('Study', { documentId: document.id });
  };

  const handleGenerateVideo = () => {
    if (!document) return;
    // Video generation is FREE for everyone!
    navigation.navigate('Video', { 
      documentId: document.id,
      content: document.content || '',
      fileUri: document.fileUri || '',
      pdfCloudUrl: document.pdfCloudUrl,
      extractedData: document.extractedData,
    });
  };

  const handleTest = () => {
    if (!document) return;
    navigation.navigate('Test', { documentId: document.id });
  };

  const handleLabs = () => {
    if (!document) return;
    navigation.navigate('Labs', { documentId: document.id });
  };

  const handleFlashcards = () => {
    if (!document) return;
    navigation.navigate('Flashcards', { 
      documentId: document.id,
      documentTitle: document.title,
    });
  };

  const handleChat = () => {
    if (!document) return;
    if (!isPremium && features.maxChatMessages !== -1) {
      navigation.navigate('Paywall', { source: 'chat' });
      return;
    }
    navigation.navigate('Chat', { 
      documentId: document.id,
      documentContent: document.content,
      documentTitle: document.title,
    });
  };

  const handleAudio = () => {
    if (!document) return;
    if (!features.canUseAudioSummary) {
      navigation.navigate('Paywall', { source: 'audio' });
      return;
    }
    navigation.navigate('AudioPlayer', { 
      documentId: document.id,
      content: document.content || '',
      title: document.title,
    });
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
      <Header title={document.title} subtitle="Choose an action" />
      
      {/* Real-time AI Processing Indicator */}
      {isProcessing && (
        <View style={styles.processingBanner}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.processingText}>{processingMessage || 'Processing...'}</Text>
        </View>
      )}
      
      {/* Vendor Detection Badge - Shows when AI has analyzed the document */}
      {documentAnalysis && documentAnalysis.vendorName && (
        <View style={styles.vendorBadge}>
          <Text style={styles.vendorLabel}>📚 Detected:</Text>
          <Text style={styles.vendorName}>{documentAnalysis.vendorName}</Text>
          {documentAnalysis.certificationDetected && (
            <Text style={styles.certBadge}>{documentAnalysis.certificationDetected}</Text>
          )}
        </View>
      )}
      
      {/* AI Summaries Available Indicator */}
      {documentSummaries.length > 0 && !isProcessing && (
        <View style={styles.summariesBadge}>
          <Text style={styles.summariesText}>
            ✨ {documentSummaries.length} AI-generated content{documentSummaries.length > 1 ? 's' : ''} available
          </Text>
        </View>
      )}
      
      <ScrollView style={styles.content}>
        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>📝</Text>
          <Text style={styles.actionTitle}>{strings.actions.summarize}</Text>
          <Text style={styles.actionDescription}>
            Get an AI-generated summary of your document
          </Text>
          <Button title={strings.actions.summarize} onPress={handleSummarize} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>📚</Text>
          <Text style={styles.actionTitle}>{strings.actions.study}</Text>
          <Text style={styles.actionDescription}>
            Study with AI-assisted learning tools
          </Text>
          <Button title={strings.actions.study} onPress={handleStudy} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>🎥</Text>
          <Text style={styles.actionTitle}>{strings.actions.generateVideo}</Text>
          <Text style={styles.actionDescription}>
            Create an AI video summary with narration
          </Text>
          <Button title={strings.actions.generateVideo} onPress={handleGenerateVideo} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>✏️</Text>
          <Text style={styles.actionTitle}>{strings.actions.test}</Text>
          <Text style={styles.actionDescription}>
            Take an AI-generated quiz
          </Text>
          <Button title={strings.actions.test} onPress={handleTest} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>🔬</Text>
          <Text style={styles.actionTitle}>{strings.actions.labs}</Text>
          <Text style={styles.actionDescription}>
            Access interactive labs and exercises
          </Text>
          <Button title={strings.actions.labs} onPress={handleLabs} />
        </Card>

        {/* New Feature Cards */}
        <Card style={styles.actionCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.actionIcon}>🃏</Text>
            {!isPremium && <Text style={styles.proBadge}>Limited</Text>}
          </View>
          <Text style={styles.actionTitle}>Flashcards</Text>
          <Text style={styles.actionDescription}>
            Generate AI flashcards with spaced repetition
          </Text>
          <Button title="Create Flashcards" onPress={handleFlashcards} />
        </Card>

        <Card style={styles.actionCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.actionIcon}>💬</Text>
            {!isPremium && <Text style={styles.proBadge}>PRO</Text>}
          </View>
          <Text style={styles.actionTitle}>AI Chat</Text>
          <Text style={styles.actionDescription}>
            Ask questions about your document
          </Text>
          <Button title="Start Chat" onPress={handleChat} />
        </Card>

        <Card style={styles.actionCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.actionIcon}>🎧</Text>
            {!isPremium && <Text style={styles.proBadge}>PRO</Text>}
          </View>
          <Text style={styles.actionTitle}>Listen</Text>
          <Text style={styles.actionDescription}>
            Convert your document to audio
          </Text>
          <Button title="Listen Now" onPress={handleAudio} />
        </Card>
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
  // Real-time processing banner styles
  processingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 10,
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  // Vendor detection badge styles
  vendorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardBackground,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  vendorLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  vendorName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  certBadge: {
    fontSize: 11,
    backgroundColor: colors.secondary,
    color: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  // AI summaries available badge
  summariesBadge: {
    backgroundColor: '#E8F5E9',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#C8E6C9',
  },
  summariesText: {
    fontSize: 13,
    color: '#2E7D32',
    textAlign: 'center',
  },
  actionCard:  {
    alignItems: 'center',
    marginVertical: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  proBadge: {
    backgroundColor: colors.secondary,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionIcon: {
    fontSize: 48,
    marginBottom:  12,
  },
  actionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  actionDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom:  16,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
});
