import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { DocumentUploader } from '../components/DocumentUploader';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import { usePremiumContext } from '../context/PremiumContext';
import { formatDate, formatFileSize } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type UploadScreenProps = MainDrawerScreenProps<'Upload'>;

export const UploadScreen: React.FC = () => {
  const navigation = useNavigation<UploadScreenProps['navigation']>();
  const { documents, uploadDocument, isLoading, uploadProgress, uploadMessage } = useDocument();
  const { isPremium, features } = usePremiumContext();
  const [isUploading, setIsUploading] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState('');

  // Check if user can upload more documents
  const canUploadMore = isPremium || features.maxDocuments === -1 || documents.length < features.maxDocuments;

  const handleDocumentSelected = async (result: any) => {
    if (result.canceled || !result.assets || result.assets.length === 0) return;

    // Check document limit for free users
    if (!canUploadMore) {
      Alert.alert(
        '📚 Document Limit Reached',
        `Free users can upload up to ${features.maxDocuments} documents. Upgrade to Pro for unlimited documents!`,
        [
          { text: 'Maybe Later', style: 'cancel' },
          { text: 'Upgrade to Pro', onPress: () => navigation.navigate('Paywall', { source: 'documents' }) },
        ]
      );
      return;
    }

    const file = result.assets[0];
    setIsUploading(true);
    setCurrentProgress(0);
    setCurrentMessage('Starting upload...');
    
    const uploadResult = await uploadDocument(
      file.name,
      file.uri,
      file.mimeType || 'application/octet-stream',
      file.size || 0,
      (progress, message) => {
        setCurrentProgress(progress);
        setCurrentMessage(message);
      }
    );

    setIsUploading(false);

    if (uploadResult.success) {
      Alert.alert('Success', 'Document uploaded and processed! All features are now ready.');
    } else {
      Alert.alert('Error', uploadResult.error || 'Failed to upload document');
    }
  };

  const handleDocumentPress = (document: Document) => {
    navigation.navigate('DocumentActions', { documentId: document.id });
  };

  const renderDocument = ({ item }: { item: Document }) => (
    <Card onPress={() => handleDocumentPress(item)}>
      <View>
        <Text style={styles.documentTitle}>{item.title}</Text>
        <View style={styles.documentMeta}>
          <Text style={styles.metaText}>{formatDate(item.uploadedAt)}</Text>
          <Text style={styles.metaText}>{formatFileSize(item.fileSize)}</Text>
          {item.extractedData && (
            <Text style={styles.processedBadge}>✓ Ready</Text>
          )}
        </View>
      </View>
    </Card>
  );

  if (isUploading) {
    return (
      <View style={styles.container}>
        <Header title={strings.upload.title} />
        <View style={styles.uploadingContainer}>
          <View style={styles.progressCard}>
            <Text style={styles.uploadingTitle}>📄 Processing Document</Text>
            <Text style={styles.uploadingMessage}>{currentMessage}</Text>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBar, { width: `${currentProgress}%` }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(currentProgress)}%</Text>
            <Text style={styles.uploadingNote}>
              This one-time processing enables instant access to all features!
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (isLoading && documents.length === 0) {
    return <LoadingSpinner message="Loading documents..." />;
  }

  return (
    <View style={styles.container}>
      <Header title={strings.upload.title} />
      
      <View style={styles.content}>
        <DocumentUploader onDocumentSelected={handleDocumentSelected} />

        {/* Document limit indicator for free users */}
        {!isPremium && features.maxDocuments !== -1 && (
          <View style={styles.limitBanner}>
            <Text style={styles.limitText}>
              📄 {documents.length}/{features.maxDocuments} documents used
              {!canUploadMore && ' • Upgrade for unlimited'}
            </Text>
          </View>
        )}

        <View style={styles.listContainer}>
          <Text style={styles.sectionTitle}>My Documents</Text>
          {documents.length === 0 ? (
            <Text style={styles.noDocuments}>{strings.upload.noDocuments}</Text>
          ) : (
            <FlatList
              data={documents}
              renderItem={renderDocument}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.list}
            />
          )}
        </View>
      </View>
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
  },
  listContainer: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  noDocuments: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 32,
  },
  list: {
    paddingBottom: 16,
  },
  documentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  documentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  processedBadge: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  uploadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  progressCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  uploadingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  uploadingMessage: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 20,
    textAlign: 'center',
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
    marginTop: 12,
  },
  uploadingNote: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 16,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  limitBanner: {
    backgroundColor: colors.secondary + '15',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.secondary + '30',
  },
  limitText: {
    fontSize: 13,
    color: colors.secondary,
    textAlign: 'center',
    fontWeight: '500',
  },
});
