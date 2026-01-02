import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Alert, 
  Animated,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { DocumentUploader } from '../components/DocumentUploader';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import { usePremiumContext } from '../context/PremiumContext';
import { useAuth } from '../context/AuthContext';
import { onDocumentsSync } from '../services/cloudSyncService';
import { formatDate, formatFileSize } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type UploadScreenProps = MainDrawerScreenProps<'Upload'>;

interface UploadStats {
  startTime: number;
  bytesUploaded: number;
  totalBytes: number;
  speed: number;
  remainingTime: number;
}

export const UploadScreen: React.FC = () => {
  const navigation = useNavigation<UploadScreenProps['navigation']>();
  const { documents, uploadDocument, isLoading, uploadProgress, uploadMessage, refreshDocuments } = useDocument();
  const { isPremium, features } = usePremiumContext();
  const { isAuthenticated } = useAuth();
  
  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState('');
  const [uploadCancelled, setUploadCancelled] = useState(false);
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null);
  const [isBackgroundUpload, setIsBackgroundUpload] = useState(false);
  
  // File preview state
  const [previewFile, setPreviewFile] = useState<{
    name: string;
    size: number;
    type: string;
    uri: string;
  } | null>(null);
  
  // Animation refs
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const uploadAbortRef = useRef<AbortController | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressRef = useRef({ progress: 0, time: Date.now() });
  
  // Track app state for background uploads
  const appState = useRef(AppState.currentState);

  // Check if user can upload more documents
  const canUploadMore = isPremium || features.maxDocuments === -1 || documents.length < features.maxDocuments;

  // Refresh documents when screen is focused (only if authenticated)
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        refreshDocuments();
      }
    }, [refreshDocuments, isAuthenticated])
  );

  // Listen for cloud sync events (only when authenticated)
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubscribe = onDocumentsSync(() => {
      console.log('[UploadScreen] Cloud sync detected, refreshing documents...');
      refreshDocuments();
    });
    return unsubscribe;
  }, [refreshDocuments, isAuthenticated]);

  // Handle app state changes for background upload
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (isUploading) {
        if (appState.current.match(/active/) && nextAppState === 'background') {
          setIsBackgroundUpload(true);
        } else if (nextAppState === 'active') {
          setIsBackgroundUpload(false);
        }
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, [isUploading]);

  // Animate progress bar
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: currentProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [currentProgress]);

  // Pulse animation for upload indicator
  useEffect(() => {
    if (isUploading) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isUploading]);

  // Calculate upload stats
  useEffect(() => {
    if (isUploading && uploadStats) {
      statsIntervalRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastProgressRef.current.time) / 1000;
        const progressDelta = currentProgress - lastProgressRef.current.progress;
        
        if (elapsed > 0 && progressDelta > 0) {
          const bytesUploaded = (currentProgress / 100) * (uploadStats.totalBytes || 1);
          const bytesInInterval = (progressDelta / 100) * (uploadStats.totalBytes || 1);
          const speed = bytesInInterval / elapsed;
          
          const remainingBytes = (uploadStats.totalBytes || 0) - bytesUploaded;
          const remainingTime = speed > 0 ? remainingBytes / speed : 0;
          
          setUploadStats(prev => prev ? {
            ...prev,
            bytesUploaded,
            speed,
            remainingTime,
          } : null);
          
          lastProgressRef.current = { progress: currentProgress, time: now };
        }
      }, 1000);
      return () => {
        if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      };
    }
  }, [isUploading, currentProgress, uploadStats?.totalBytes]);

  // Format helpers
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 60) return `${Math.ceil(seconds)}s remaining`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m remaining`;
    return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m remaining`;
  };

  const getFileTypeIcon = (mimeType: string): string => {
    if (mimeType.includes('pdf')) return 'document-text';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'easel';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
    if (mimeType.includes('text')) return 'reader';
    return 'document-outline';
  };

  const getFileTypeColor = (mimeType: string): string => {
    if (mimeType.includes('pdf')) return '#E53935';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '#FF6D00';
    if (mimeType.includes('word') || mimeType.includes('document')) return '#1976D2';
    if (mimeType.includes('text')) return '#43A047';
    return colors.primary;
  };

  // Handle cancel upload
  const handleCancelUpload = () => {
    Alert.alert(
      'Cancel Upload?',
      'Are you sure you want to cancel? Progress will be lost.',
      [
        { text: 'Continue Upload', style: 'cancel' },
        { 
          text: 'Cancel Upload', 
          style: 'destructive',
          onPress: () => {
            setUploadCancelled(true);
            uploadAbortRef.current?.abort();
            resetUploadState();
          }
        },
      ]
    );
  };

  // Reset upload state
  const resetUploadState = () => {
    setIsUploading(false);
    setCurrentProgress(0);
    setCurrentMessage('');
    setUploadStats(null);
    setPreviewFile(null);
    setUploadCancelled(false);
    setIsBackgroundUpload(false);
    progressAnim.setValue(0);
    lastProgressRef.current = { progress: 0, time: Date.now() };
  };

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
    const fileSize = file.size || 0;
    
    // Set up preview
    setPreviewFile({
      name: file.name,
      size: fileSize,
      type: file.mimeType || 'application/octet-stream',
      uri: file.uri,
    });
    
    // Initialize upload stats
    setUploadStats({
      startTime: Date.now(),
      bytesUploaded: 0,
      totalBytes: fileSize,
      speed: 0,
      remainingTime: 0,
    });
    
    lastProgressRef.current = { progress: 0, time: Date.now() };
    uploadAbortRef.current = new AbortController();
    
    setIsUploading(true);
    setUploadCancelled(false);
    setCurrentProgress(0);
    setCurrentMessage('Starting upload...');
    
    const uploadResult = await uploadDocument(
      file.name,
      file.uri,
      file.mimeType || 'application/octet-stream',
      fileSize,
      (progress, message) => {
        if (!uploadCancelled) {
          setCurrentProgress(progress);
          setCurrentMessage(message);
        }
      }
    );

    if (uploadCancelled) {
      return;
    }

    resetUploadState();

    if (uploadResult.success) {
      Alert.alert(
        '✅ Upload Complete!', 
        'Document uploaded and processed successfully. All features are now ready.',
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert('Upload Failed', uploadResult.error || 'Failed to upload document');
    }
  };

  const handleDocumentPress = (document: Document) => {
    navigation.navigate('DocumentActions', { documentId: document.id });
  };

  const renderDocument = ({ item }: { item: Document }) => (
    <Card onPress={() => handleDocumentPress(item)}>
      <View style={styles.documentCard}>
        <View style={[styles.fileTypeIndicator, { backgroundColor: getFileTypeColor(item.fileType) + '20' }]}>
          <Ionicons 
            name={getFileTypeIcon(item.fileType) as any} 
            size={24} 
            color={getFileTypeColor(item.fileType)} 
          />
        </View>
        <View style={styles.documentInfo}>
          <Text style={styles.documentTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.documentMeta}>
            <Text style={styles.metaText}>{formatDate(item.uploadedAt)}</Text>
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.metaText}>{formatFileSize(item.fileSize)}</Text>
            {item.extractedData && (
              <>
                <Text style={styles.metaDot}>•</Text>
                <Text style={styles.processedBadge}>✓ Ready</Text>
              </>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </View>
    </Card>
  );

  // Upload progress screen with enhanced UI
  if (isUploading) {
    const progressWidth = progressAnim.interpolate({
      inputRange: [0, 100],
      outputRange: ['0%', '100%'],
    });

    return (
      <View style={styles.container}>
        <Header title="Uploading Document" />
        <View style={styles.uploadingContainer}>
          {/* File Preview Card */}
          {previewFile && (
            <View style={styles.previewCard}>
              <View style={[styles.previewIcon, { backgroundColor: getFileTypeColor(previewFile.type) + '20' }]}>
                <Ionicons 
                  name={getFileTypeIcon(previewFile.type) as any} 
                  size={40} 
                  color={getFileTypeColor(previewFile.type)} 
                />
              </View>
              <View style={styles.previewInfo}>
                <Text style={styles.previewName} numberOfLines={2}>{previewFile.name}</Text>
                <Text style={styles.previewSize}>{formatFileSize(previewFile.size)}</Text>
              </View>
            </View>
          )}

          {/* Progress Card */}
          <View style={styles.progressCard}>
            <Animated.View style={[styles.uploadIconContainer, { transform: [{ scale: pulseAnim }] }]}>
              <Ionicons 
                name={isBackgroundUpload ? 'cloud-upload' : 'cloud-upload-outline'} 
                size={48} 
                color={colors.primary} 
              />
            </Animated.View>
            
            <Text style={styles.uploadingTitle}>
              {isBackgroundUpload ? '☁️ Uploading in Background' : '📤 Uploading Document'}
            </Text>
            
            {/* Status Message */}
            <View style={styles.statusContainer}>
              <ActivityIndicator size="small" color={colors.primary} style={styles.statusSpinner} />
              <Text style={styles.uploadingMessage}>{currentMessage}</Text>
            </View>
            
            {/* Progress Bar */}
            <View style={styles.progressBarContainer}>
              <Animated.View style={[styles.progressBar, { width: progressWidth }]} />
            </View>
            
            {/* Progress Percentage */}
            <Text style={styles.progressText}>{Math.round(currentProgress)}%</Text>
            
            {/* Upload Stats */}
            {uploadStats && uploadStats.speed > 0 && (
              <View style={styles.statsContainer}>
                <View style={styles.statItem}>
                  <Ionicons name="speedometer-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.statText}>{formatSpeed(uploadStats.speed)}</Text>
                </View>
                {uploadStats.remainingTime > 0 && uploadStats.remainingTime < 86400 && (
                  <View style={styles.statItem}>
                    <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                    <Text style={styles.statText}>{formatTimeRemaining(uploadStats.remainingTime)}</Text>
                  </View>
                )}
                <View style={styles.statItem}>
                  <Ionicons name="cloud-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.statText}>
                    {formatFileSize(uploadStats.bytesUploaded)} / {formatFileSize(uploadStats.totalBytes)}
                  </Text>
                </View>
              </View>
            )}
            
            {/* Background Upload Note */}
            {isBackgroundUpload && (
              <View style={styles.backgroundNote}>
                <Ionicons name="information-circle-outline" size={16} color={colors.secondary} />
                <Text style={styles.backgroundNoteText}>
                  Upload continues in background. You can use other apps.
                </Text>
              </View>
            )}

            {/* Cancel Button */}
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancelUpload}>
              <Ionicons name="close-circle-outline" size={20} color={colors.error} />
              <Text style={styles.cancelButtonText}>Cancel Upload</Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.uploadingNote}>
            ✨ This one-time processing enables instant access to all features!
          </Text>
        </View>
      </View>
    );
  }

  // Don't show loading spinner - let users see the upload interface immediately
  // Documents will load in the background

  return (
    <View style={styles.container}>
      <Header title={strings.upload.title} />
      
      <View style={styles.content}>
        <DocumentUploader onDocumentSelected={handleDocumentSelected} />

        {/* Document limit indicator for free users */}
        {!isPremium && features.maxDocuments !== -1 && (
          <View style={styles.limitBanner}>
            <Ionicons name="document-text-outline" size={16} color={colors.secondary} />
            <Text style={styles.limitText}>
              {documents.length}/{features.maxDocuments} documents used
              {!canUploadMore && ' • Upgrade for unlimited'}
            </Text>
          </View>
        )}

        <View style={styles.listContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Documents</Text>
            <Text style={styles.documentCount}>{documents.length} files</Text>
          </View>
          
          {documents.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={64} color={colors.border} />
              <Text style={styles.noDocuments}>{strings.upload.noDocuments}</Text>
              <Text style={styles.emptyHint}>Upload your first document to get started!</Text>
            </View>
          ) : (
            <FlatList
              data={documents}
              renderItem={renderDocument}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  documentCount: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  noDocuments: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.7,
  },
  list: {
    paddingBottom: 16,
  },
  documentCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileTypeIndicator: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  documentInfo: {
    flex: 1,
  },
  documentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  documentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  metaDot: {
    fontSize: 12,
    color: colors.textSecondary,
    marginHorizontal: 6,
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
  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  previewIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  previewInfo: {
    flex: 1,
  },
  previewName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  previewSize: {
    fontSize: 14,
    color: colors.textSecondary,
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
  uploadIconContainer: {
    marginBottom: 16,
  },
  uploadingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusSpinner: {
    marginRight: 8,
  },
  uploadingMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    flex: 1,
  },
  progressBarContainer: {
    width: '100%',
    height: 10,
    backgroundColor: colors.border,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 5,
  },
  progressText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
    marginTop: 12,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
    gap: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 6,
  },
  backgroundNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary + '15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 16,
  },
  backgroundNoteText: {
    fontSize: 12,
    color: colors.secondary,
    marginLeft: 8,
    flex: 1,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    fontSize: 14,
    color: colors.error,
    marginLeft: 6,
    fontWeight: '500',
  },
  uploadingNote: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 24,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: 20,
  },
  limitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary + '15',
    paddingVertical: 10,
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
    marginLeft: 8,
  },
});
