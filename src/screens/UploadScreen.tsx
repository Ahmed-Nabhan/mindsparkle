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
  Modal,
  Dimensions,
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
import { useDocumentContext } from '../context/DocumentContext';
import { usePremiumContext } from '../context/PremiumContext';
import { useAuth } from '../context/AuthContext';
import { onDocumentsSync } from '../services/cloudSyncService';
import { supabase } from '../services/supabase';
import { formatDate, formatFileSize } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/**
 * UploadScreen - Document upload and management screen
 * 
 * REAL-TIME INTEGRATION:
 * - Subscribes to documents table changes for instant list updates
 * - Shows newly uploaded documents immediately without refresh
 * - Reflects document deletions from other devices in real-time
 * - Unsubscribes on unmount to prevent memory leaks
 * 
 * REAL-TIME FLOW:
 * ┌───────────────────────────────────────────────────────────────┐
 * │ User uploads document on Device A                             │
 * │                    │                                          │
 * │                    ▼                                          │
 * │ ┌─────────────────────────────────────────────────────────┐   │
 * │ │ Supabase documents table INSERT                          │   │
 * │ └─────────────────────────────────────────────────────────┘   │
 * │                    │                                          │
 * │         ┌─────────┴─────────┐                                │
 * │         ▼                   ▼                                │
 * │ ┌─────────────────┐ ┌─────────────────┐                      │
 * │ │ Device A        │ │ Device B        │                      │
 * │ │ (local update)  │ │ (realtime push) │                      │
 * │ └─────────────────┘ └─────────────────┘                      │
 * │         │                   │                                │
 * │         └─────────┬─────────┘                                │
 * │                   ▼                                          │
 * │         Both show new document instantly                     │
 * └───────────────────────────────────────────────────────────────┘
 * 
 * @component
 */

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
  const { documents, uploadDocument, isLoading, uploadProgress, uploadMessage, refreshDocuments, removeDocument, removeAllDocuments } = useDocument();
  const { isPremium, features, dailyDocumentCount, incrementDocumentCount } = usePremiumContext();
  const { isAuthenticated, user } = useAuth();
  const { isRealtimeConnected } = useDocumentContext();
  
  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState('');
  const [uploadCancelled, setUploadCancelled] = useState(false);
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null);
  const [isBackgroundUpload, setIsBackgroundUpload] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  
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
  const uploadCancelledRef = useRef(false);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressRef = useRef({ progress: 0, time: Date.now() });
  
  // Real-time subscription ref - stored for cleanup
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  
  // Track app state for background uploads
  const appState = useRef(AppState.currentState);

  // Check if user can upload more documents
  const canUploadMore = isPremium || features.maxDocuments === -1 || dailyDocumentCount < features.maxDocuments;

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

  // ========================================
  // SUPABASE REALTIME SUBSCRIPTION
  // ========================================
  
  /**
   * Subscribe to Supabase Realtime for documents table changes
   * This provides instant UI updates when:
   * - New documents are uploaded (even from other devices)
   * - Documents are deleted
   * - Document metadata is updated (title, summary, etc.)
   * 
   * IMPORTANT: We filter by user_id to only receive updates for
   * the current user's documents (respects RLS policies)
   */
  useEffect(() => {
    // Only subscribe when authenticated
    if (!isAuthenticated || !user?.id) {
      console.log('[UploadScreen] Not authenticated, skipping realtime subscription');
      return;
    }

    console.log('[UploadScreen] Setting up Realtime subscription for documents');

    // Create a Supabase Realtime channel for documents table
    // Filter by user_id to only receive updates for current user's documents
    realtimeChannelRef.current = supabase
      .channel('upload-screen-documents')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'documents',
          filter: `user_id=eq.${user.id}`, // Only this user's documents
        },
        (payload: RealtimePostgresChangesPayload<{ [key: string]: any }>) => {
          console.log('[UploadScreen] Realtime update:', payload.eventType);
          
          // Refresh the document list on any change
          // This ensures the UI stays in sync with the database
          switch (payload.eventType) {
            case 'INSERT':
              console.log('[UploadScreen] New document detected:', payload.new?.title);
              // Refresh to show new document
              refreshDocuments();
              break;
              
            case 'UPDATE':
              console.log('[UploadScreen] Document updated:', payload.new?.title);
              // Refresh to show updated metadata
              refreshDocuments();
              break;
              
            case 'DELETE':
              console.log('[UploadScreen] Document deleted:', payload.old?.id);
              // Refresh to remove deleted document
              refreshDocuments();
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log('[UploadScreen] Realtime channel status:', status);
      });

    // Cleanup function - CRITICAL for preventing memory leaks
    // Removes the WebSocket channel when component unmounts
    return () => {
      console.log('[UploadScreen] Cleaning up Realtime subscription');
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [isAuthenticated, user?.id, refreshDocuments]);

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
            uploadCancelledRef.current = true;
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
    // Do not force-clear cancel flag here; the caller (new upload) will reset it.
    setIsBackgroundUpload(false);
    progressAnim.setValue(0);
    lastProgressRef.current = { progress: 0, time: Date.now() };
  };

  const handleDocumentSelected = async (result: any) => {
    console.log('[UploadScreen] handleDocumentSelected called');
    if (result.canceled || !result.assets || result.assets.length === 0) {
      console.log('[UploadScreen] No file selected or cancelled');
      return;
    }

    // Check document limit for free users
    if (!canUploadMore) {
      console.log('[UploadScreen] Document limit reached');
      Alert.alert(
        '📚 Document Limit Reached',
        `Free users can upload up to ${features.maxDocuments} documents per day. Upgrade to Pro for unlimited documents!`,
        [
          { text: 'Maybe Later', style: 'cancel' },
          { text: 'Upgrade to Pro', onPress: () => navigation.navigate('Paywall', { source: 'documents' }) },
        ]
      );
      return;
    }

    const file = result.assets[0];
    const fileSize = file.size || 0;
    console.log('[UploadScreen] Starting upload for:', file.name, 'size:', fileSize);
    
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
    uploadCancelledRef.current = false;
    
    setIsUploading(true);
    setUploadCancelled(false);
    setCurrentProgress(0);
    setCurrentMessage('Starting upload...');
    
    console.log(`[UploadScreen] Calling uploadDocument... (isPremium: ${isPremium})`);
    const uploadResult = await uploadDocument(
      file.name,
      file.uri,
      file.mimeType || 'application/octet-stream',
      fileSize,
      (progress, message) => {
        if (!uploadCancelledRef.current) {
          setCurrentProgress(progress);
          setCurrentMessage(message);
        }
      },
      isPremium, // Pass Pro status for premium Adobe OCR
      uploadAbortRef.current?.signal
    );
    console.log('[UploadScreen] uploadDocument returned:', uploadResult.success ? 'success' : 'failed');

    if (uploadCancelledRef.current) {
      console.log('[UploadScreen] Upload was cancelled');
      return;
    }

    resetUploadState();

    if (uploadResult.success) {
      incrementDocumentCount();
      const uploadedId = uploadResult.document?.id;
      const uploadedTitle = uploadResult.document?.title;

      // If folders are available, offer to save this document into a folder.
      if (features.canCreateFolders && uploadedId && uploadedTitle) {
        Alert.alert(
          '✅ Upload Complete!',
          'Save this document to a folder?',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Choose Folder',
              onPress: () => {
                navigation.navigate('Folders', {
                  selectMode: true,
                  documentId: uploadedId,
                  documentTitle: uploadedTitle,
                });
              },
            },
          ]
        );
      } else {
        Alert.alert(
          '✅ Upload Complete!',
          'Document uploaded and processed successfully. All features are now ready.',
          [{ text: 'OK' }]
        );
      }
    } else {
      Alert.alert('Upload Failed', uploadResult.error || 'Failed to upload document');
    }
  };

  const handleDocumentPress = (document: Document) => {
    console.log('[UploadScreen] Document pressed:', document.id);
    navigation.navigate('DocumentActions', { documentId: document.id });
  };

  const handleDeleteDocument = (document: Document) => {
    console.log('[UploadScreen] Delete document requested:', document.id);
    Alert.alert(
      '🗑️ Delete Document',
      `Are you sure you want to delete "${document.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const success = await removeDocument(document.id);
            if (success) {
              Alert.alert('Deleted', 'Document has been deleted.');
            } else {
              Alert.alert('Error', 'Failed to delete document.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllDocuments = () => {
    if (documents.length === 0) {
      Alert.alert('No Documents', 'There are no documents to delete.');
      return;
    }
    Alert.alert(
      '🗑️ Delete All Documents',
      `Are you sure you want to delete ALL ${documents.length} documents? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            const success = await removeAllDocuments();
            if (success) {
              Alert.alert('Deleted', 'All documents have been deleted.');
            } else {
              Alert.alert('Error', 'Failed to delete documents.');
            }
          },
        },
      ]
    );
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
                {typeof item.extractedData.totalPages === 'number' && item.extractedData.totalPages > 1 && (
                  <>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.metaText}>{item.extractedData.totalPages} pages</Text>
                  </>
                )}
              </>
            )}
          </View>
        </View>
        <TouchableOpacity 
          onPress={() => handleDeleteDocument(item)}
          style={styles.deleteButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={20} color="#E53935" />
        </TouchableOpacity>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </View>
    </Card>
  );

  // Calculate progress width for modal
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  // Don't show loading spinner - let users see the upload interface immediately
  // Documents will load in the background

  return (
    <View style={styles.container}>
      <Header title={strings.upload.title} />
      
      <View style={styles.content}>
        <DocumentUploader 
          onDocumentSelected={handleDocumentSelected}
          isUploading={isUploading}
          uploadProgress={currentProgress}
          uploadMessage={currentMessage}
        />

        {/* Document limit indicator for free users */}
        {!isPremium && features.maxDocuments !== -1 && (
          <View style={styles.limitBanner}>
            <Ionicons name="document-text-outline" size={16} color={colors.secondary} />
            <Text style={styles.limitText}>
              {dailyDocumentCount}/{features.maxDocuments} uploads today
              {!canUploadMore && ' • Upgrade for unlimited'}
            </Text>
          </View>
        )}

        <View style={styles.listContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Documents</Text>
            <View style={styles.headerRight}>
              {documents.length > 0 && (
                <TouchableOpacity
                  onPress={handleDeleteAllDocuments}
                  style={styles.deleteAllButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="trash-outline" size={14} color="#E53935" />
                  <Text style={styles.deleteAllText}>Delete All</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.documentCount}>{documents.length} files</Text>
            </View>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deleteAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  deleteAllText: {
    fontSize: 12,
    color: '#E53935',
    fontWeight: '600',
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
  deleteButton: {
    padding: 8,
    marginRight: 4,
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
  // Modal styles for upload progress box
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  modalCloseButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 4,
    zIndex: 1,
  },
  modalPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    width: '100%',
    marginBottom: 16,
  },
  modalPreviewIcon: {
    width: 48,
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalPreviewInfo: {
    flex: 1,
    marginLeft: 12,
  },
  modalPreviewName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  modalPreviewSize: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalUploadIcon: {
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  modalStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  modalStatusText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 10,
    flex: 1,
    textAlign: 'center',
  },
  modalProgressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  modalProgressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  modalProgressText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
    marginTop: 12,
  },
  modalStatsContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  modalStatText: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  modalCancelButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
  },
  modalCancelText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '500',
  },
  modalMinimizeButton: {
    position: 'absolute',
    right: 48,
    top: 12,
    zIndex: 20,
  },
  minimizedChip: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'center',
    marginVertical: 8,
  },
  minimizedText: {
    color: colors.text,
    fontWeight: '600',
  },
});
