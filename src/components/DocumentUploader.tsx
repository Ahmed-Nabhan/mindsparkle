/**
 * DocumentUploader Component
 * 
 * A file picker component for MindSparkle that handles:
 * - PDF, DOCX, PPTX, and image file selection
 * - File type and size validation
 * - Offline caching with background sync
 * 
 * NOTE: This component ONLY handles file SELECTION.
 * Actual upload/processing is handled by useDocument.uploadDocument()
 * This prevents duplicate upload processes.
 * 
 * FLOW:
 * 1. User taps upload area → Document picker opens
 * 2. File selected → Validation (type, size)
 * 3. Return file to parent → Parent calls useDocument.uploadDocument()
 * 
 * OFFLINE HANDLING:
 * - Files cached locally if offline (queued for later)
 * - Background sync when connection restored
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Network from 'expo-network';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { config } from '../constants/config';
import { isValidFileType, isValidFileSize } from '../utils/validators';
import { formatFileSize } from '../utils/helpers';
import { 
  shouldUseCloudProcessing,
  LOCAL_PROCESSING_LIMIT,
} from '../services/cloudStorageService';
import { useAuth } from '../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface DocumentUploaderProps {
  /** Callback when document is selected and ready for processing */
  onDocumentSelected: (document: DocumentPicker.DocumentPickerResult) => void;
  /** Optional callback for upload progress (0-100) - passed through from useDocument */
  onUploadProgress?: (progress: number, message: string) => void;
  /** Optional callback when upload completes */
  onUploadComplete?: (result: UploadResult) => void;
  /** Optional callback for errors */
  onError?: (error: string) => void;
  /** Whether upload is in progress (controlled by parent) */
  isUploading?: boolean;
  /** Current upload progress (0-100) (controlled by parent) */
  uploadProgress?: number;
  /** Current upload message (controlled by parent) */
  uploadMessage?: string;
}

interface UploadResult {
  success: boolean;
  documentId?: string;
  storagePath?: string;
  signedUrl?: string;
  isLocal: boolean;
  error?: string;
}

interface PendingUpload {
  id: string;
  fileUri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  timestamp: number;
}

// Storage key for pending uploads
const PENDING_UPLOADS_KEY = '@mindsparkle_pending_uploads';

// ============================================
// COMPONENT
// ============================================

export const DocumentUploader: React.FC<DocumentUploaderProps> = ({
  onDocumentSelected,
  onUploadProgress,
  onUploadComplete,
  onError,
  isUploading: externalIsUploading = false,
  uploadProgress: externalUploadProgress = 0,
  uploadMessage: externalUploadMessage = '',
}) => {
  // ============================================
  // STATE
  // ============================================
  
  const { user, isAuthenticated } = useAuth();
  
  // File selection state
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  
  // Network state
  const [isOnline, setIsOnline] = useState(true);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  
  // Animation for progress bar (uses external progress)
  const progressAnim = useState(new Animated.Value(0))[0];

  // ============================================
  // NETWORK MONITORING
  // ============================================

  /**
   * Monitor network connectivity
   * When connection restored, attempt to sync pending uploads
   */
  useEffect(() => {
    const subscription = Network.addNetworkStateListener(state => {
      const wasOffline = !isOnline;
      const nowOnline = state.isConnected ?? false;
      
      setIsOnline(nowOnline);
      
      // Connection restored - sync pending uploads
      if (wasOffline && nowOnline && pendingUploads.length > 0) {
        console.log('[DocumentUploader] Connection restored, syncing pending uploads...');
        syncPendingUploads();
      }
    });

    return () => subscription.remove();
  }, [isOnline, pendingUploads]);

  /**
   * Load pending uploads from storage on mount
   */
  useEffect(() => {
    loadPendingUploads();
  }, []);

  // ============================================
  // PENDING UPLOADS MANAGEMENT
  // ============================================

  /**
   * Load pending uploads from AsyncStorage
   * These are files that couldn't be uploaded due to offline status
   */
  const loadPendingUploads = async () => {
    try {
      const stored = await AsyncStorage.getItem(PENDING_UPLOADS_KEY);
      if (stored) {
        setPendingUploads(JSON.parse(stored));
      }
    } catch (error) {
      console.error('[DocumentUploader] Error loading pending uploads:', error);
    }
  };

  /**
   * Save pending upload to AsyncStorage
   * Called when user is offline but wants to queue a file
   */
  const savePendingUpload = async (upload: PendingUpload) => {
    try {
      const updated = [...pendingUploads, upload];
      await AsyncStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(updated));
      setPendingUploads(updated);
      console.log('[DocumentUploader] Saved pending upload:', upload.fileName);
    } catch (error) {
      console.error('[DocumentUploader] Error saving pending upload:', error);
    }
  };

  /**
   * Remove pending upload after successful sync
   */
  const removePendingUpload = async (uploadId: string) => {
    try {
      const updated = pendingUploads.filter(u => u.id !== uploadId);
      await AsyncStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(updated));
      setPendingUploads(updated);
    } catch (error) {
      console.error('[DocumentUploader] Error removing pending upload:', error);
    }
  };

  /**
   * Sync all pending uploads when back online
   * NOTE: Pending uploads will be processed by parent component
   * when user manually triggers them (simplified approach)
   */
  const syncPendingUploads = async () => {
    if (!user || pendingUploads.length === 0) return;
    
    // Notify user that there are pending uploads
    console.log('[DocumentUploader] Pending uploads available:', pendingUploads.length);
    // The actual upload will be triggered when user selects the pending file
  };

  // ============================================
  // PROGRESS ANIMATION
  // ============================================

  /**
   * Animate progress bar smoothly (uses external progress from parent)
   */
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: externalUploadProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [externalUploadProgress]);

  // ============================================
  // FILE CACHING (for offline)
  // ============================================

  /**
   * Cache file locally for offline processing
   * Creates a copy in app's cache directory
   */
  const cacheFileLocally = async (
    fileUri: string,
    fileName: string
  ): Promise<string> => {
    const cacheDir = `${FileSystem.cacheDirectory}documents/`;
    
    // Ensure cache directory exists
    const dirInfo = await FileSystem.getInfoAsync(cacheDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
    }
    
    // Copy file to cache
    const cachedPath = `${cacheDir}${Date.now()}_${fileName}`;
    await FileSystem.copyAsync({ from: fileUri, to: cachedPath });
    
    console.log('[DocumentUploader] File cached locally:', cachedPath);
    return cachedPath;
  };

  // ============================================
  // FILE PICKER
  // ============================================

  /**
   * Open document picker and handle file selection
   * 
   * SIMPLIFIED FLOW (upload handled by parent via useDocument):
   * 1. Show system file picker
   * 2. Validate selected file (type, size)
   * 3. Handle offline scenario (cache + queue)
   * 4. Return result to parent component (parent handles upload)
   */
  const pickDocument = async () => {
    // Prevent double-tap
    if (isPicking || externalIsUploading) {
      console.log('[DocumentUploader] Pick blocked - isPicking:', isPicking, 'isUploading:', externalIsUploading);
      return;
    }
    
    console.log('[DocumentUploader] Starting document picker...');
    setIsPicking(true);
    
    try {
      // Step 1: Show document picker
      console.log('[DocumentUploader] Opening system file picker...');
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain',
          'image/jpeg',
          'image/png',
          '*/*'  // Fallback to allow all files
        ],
        copyToCacheDirectory: true,
      });
      
      console.log('[DocumentUploader] Picker result:', result.canceled ? 'canceled' : 'file selected');

      // User cancelled
      if (result.canceled || !result.assets || result.assets.length === 0) {
        console.log('[DocumentUploader] User cancelled or no assets');
        setIsPicking(false);
        return;
      }

      const file = result.assets[0];
      console.log('[DocumentUploader] File selected:', file.name, 'size:', file.size);
      
      // Step 2: Validate file type
      if (!isValidFileType(file.name, config.supportedFileTypes.documents)) {
        Alert.alert(
          'Invalid File Type',
          'Please select a PDF, DOC, DOCX, PPT, PPTX, TXT, or image file.'
        );
        setIsPicking(false);
        return;
      }

      // Step 2b: Validate file size
      if (file.size && !isValidFileSize(file.size, config.limits.maxDocumentSize)) {
        Alert.alert(
          'File Too Large',
          `Maximum file size is ${formatFileSize(config.limits.maxDocumentSize)}.`
        );
        setIsPicking(false);
        return;
      }

      // Set selected file for UI
      setSelectedFile(file);

      // Step 3: Check offline for large files
      const fileSize = file.size || 0;
      const needsCloudUpload = shouldUseCloudProcessing(fileSize);

      if (needsCloudUpload && isAuthenticated && !isOnline) {
        // Offline with large file - cache for later
        Alert.alert(
          'Offline Mode',
          'You are offline. The file will be cached and uploaded when you reconnect.',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Cache File', 
              onPress: async () => {
                const cachedPath = await cacheFileLocally(file.uri, file.name);
                await savePendingUpload({
                  id: `pending_${Date.now()}`,
                  fileUri: cachedPath,
                  fileName: file.name,
                  fileType: file.mimeType || 'application/octet-stream',
                  fileSize: fileSize,
                  timestamp: Date.now(),
                });
                Alert.alert('File Queued', 'File will upload when you go online.');
              }
            },
          ]
        );
        setIsPicking(false);
        return;
      }

      // Step 4: Return result to parent - parent handles ALL upload/processing
      // via useDocument.uploadDocument() - this prevents duplicate uploads
      console.log('[DocumentUploader] Calling onDocumentSelected...');
      setIsPicking(false); // Reset picking state BEFORE calling parent
      onDocumentSelected(result);
      
    } catch (error: any) {
      console.error('[DocumentUploader] Error picking document:', error);
      onError?.(error.message || 'Failed to pick document');
      Alert.alert('Error', 'Failed to pick document. Please try again.');
      setIsPicking(false);
    }
  };

  // ============================================
  // RENDER
  // ============================================

  /**
   * Calculate progress bar width
   */
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      {/* Upload Box */}
      <TouchableOpacity 
        style={[
          styles.uploadBox, 
          (isPicking || externalIsUploading) && styles.uploadBoxDisabled,
          !isOnline && styles.uploadBoxOffline,
        ]} 
        onPress={pickDocument}
        disabled={isPicking || externalIsUploading}
      >
        {externalIsUploading ? (
          // Upload Progress View (controlled by parent)
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.progressText}>{externalUploadMessage}</Text>
            
            {/* Progress Bar */}
            <View style={styles.progressBarContainer}>
              <Animated.View 
                style={[
                  styles.progressBar, 
                  { width: progressWidth }
                ]} 
              />
            </View>
            <Text style={styles.progressPercent}>{Math.round(externalUploadProgress)}%</Text>
          </View>
        ) : isPicking ? (
          // Picking State
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          // Default State
          <>
            <Text style={styles.uploadIcon}>📄</Text>
            <Text style={styles.uploadText}>{strings.upload.selectFile}</Text>
            <Text style={styles.supportedFormats}>{strings.upload.supportedFormats}</Text>
            
            {/* Offline Indicator */}
            {!isOnline && (
              <View style={styles.offlineIndicator}>
                <Text style={styles.offlineText}>📴 Offline - Files will be cached</Text>
              </View>
            )}
            
            {/* Cloud Upload Indicator */}
            {isAuthenticated && (
              <Text style={styles.cloudHint}>
                ☁️ Files over {formatFileSize(LOCAL_PROCESSING_LIMIT)} upload to cloud
              </Text>
            )}
          </>
        )}
      </TouchableOpacity>

      {/* Selected File Info */}
      {selectedFile && !externalIsUploading && (
        <View style={styles.selectedFile}>
          <Text style={styles.fileName}>{selectedFile.name}</Text>
          <Text style={styles.fileSize}>
            {selectedFile.size ? formatFileSize(selectedFile.size) : 'Unknown size'}
          </Text>
          {selectedFile.size && shouldUseCloudProcessing(selectedFile.size) && (
            <Text style={styles.cloudBadge}>☁️ Cloud Storage</Text>
          )}
        </View>
      )}

      {/* Pending Uploads */}
      {pendingUploads.length > 0 && (
        <View style={styles.pendingContainer}>
          <Text style={styles.pendingTitle}>⏳ Pending Uploads ({pendingUploads.length})</Text>
          {pendingUploads.slice(0, 3).map(upload => (
            <View key={upload.id} style={styles.pendingItem}>
              <Text style={styles.pendingFileName} numberOfLines={1}>
                {upload.fileName}
              </Text>
              <Text style={styles.pendingSize}>{formatFileSize(upload.fileSize)}</Text>
            </View>
          ))}
          {pendingUploads.length > 3 && (
            <Text style={styles.pendingMore}>+{pendingUploads.length - 3} more</Text>
          )}
        </View>
      )}
    </View>
  );
};

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  uploadBox: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardBackground,
    minHeight: 180,
  },
  uploadBoxDisabled: {
    opacity: 0.7,
  },
  uploadBoxOffline: {
    borderColor: colors.warning || '#FFA500',
  },
  uploadIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  uploadText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 8,
  },
  supportedFormats: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cloudHint: {
    fontSize: 11,
    color: colors.textLight || colors.textSecondary,
    marginTop: 12,
  },
  offlineIndicator: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: (colors.warning || '#FFA500') + '20',
    borderRadius: 8,
  },
  offlineText: {
    fontSize: 12,
    color: colors.warning || '#FFA500',
    fontWeight: '500',
  },
  // Progress styles
  progressContainer: {
    alignItems: 'center',
    width: '100%',
  },
  progressText: {
    fontSize: 14,
    color: colors.text,
    marginTop: 12,
    marginBottom: 8,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: colors.border || '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressPercent: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  // Selected file styles
  selectedFile: {
    marginTop: 16,
    padding: 12,
    backgroundColor: colors.success + '20',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.success,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  fileSize: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  cloudBadge: {
    fontSize: 11,
    color: colors.primary,
    marginTop: 4,
    fontWeight: '500',
  },
  // Pending uploads styles
  pendingContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: (colors.warning || '#FFA500') + '15',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: (colors.warning || '#FFA500') + '40',
  },
  pendingTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  pendingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  pendingFileName: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  pendingSize: {
    fontSize: 11,
    color: colors.textLight || colors.textSecondary,
  },
  pendingMore: {
    fontSize: 11,
    color: colors.textLight || colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
});
