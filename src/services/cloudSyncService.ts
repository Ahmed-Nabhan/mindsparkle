/**
 * Cloud Sync Service for MindSparkle
 * 
 * Handles bidirectional sync between local storage and Supabase cloud:
 * - Offline-first architecture with local caching via AsyncStorage
 * - Automatic sync queue for pending changes
 * - Conflict resolution using timestamps and versioning
 * - Real-time sync status updates via event listeners
 * - Background sync when connection is restored
 * 
 * SYNC ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    Sync Flow Diagram                            │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  LOCAL STORAGE (AsyncStorage)     CLOUD (Supabase PostgreSQL)   │
 * │        │                                   │                    │
 * │        │──── User makes changes ────>      │                    │
 * │        │                                   │                    │
 * │  [Check Network]                           │                    │
 * │        │                                   │                    │
 * │  ONLINE?─────Yes───> Upload to cloud ─────>│                    │
 * │        │                                   │                    │
 * │        No                                  │                    │
 * │        │                                   │                    │
 * │  [Add to Sync Queue]                       │                    │
 * │        │                                   │                    │
 * │  [Network Restored]                        │                    │
 * │        │                                   │                    │
 * │  [Process Queue] ──────────────────────────>│                   │
 * │        │                                   │                    │
 * │  [Conflict Detection]                      │                    │
 * │        │                                   │                    │
 * │  [Resolve: Last-Write-Wins + Versioning]   │                    │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * CONFLICT RESOLUTION STRATEGY:
 * 1. Compare timestamps (updated_at)
 * 2. Most recent change wins
 * 3. Version number increments on each update
 * 4. User can manually resolve if needed
 * 
 * @module services/cloudSyncService
 */

import { supabase } from './supabase';
import { saveDocument, saveFolder, saveTestResult } from './storage';
import { Document } from '../types/document';
import { Folder } from '../types/folder';
import { TestResult } from '../types/performance';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import type { EventSubscription } from 'expo-modules-core';

// ============================================
// CONSTANTS
// ============================================

/**
 * AsyncStorage keys for offline caching
 */
const STORAGE_KEYS = {
  SYNC_QUEUE: '@mindsparkle_sync_queue',
  PENDING_CHANGES: '@mindsparkle_pending_changes',
  LAST_SYNC_TIME: '@mindsparkle_last_sync',
  CACHED_DOCUMENTS: '@mindsparkle_cached_docs',
  CACHED_FOLDERS: '@mindsparkle_cached_folders',
  SYNC_CONFLICTS: '@mindsparkle_conflicts',
  LOCAL_VERSION: '@mindsparkle_local_version',
};

/**
 * Sync operation types for queue
 */
type SyncOperation = 'create' | 'update' | 'delete';
type SyncEntityType = 'document' | 'folder' | 'testResult' | 'userStats';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Item queued for sync when back online
 */
export interface QueuedSyncItem {
  id: string;
  entityType: SyncEntityType;
  operation: SyncOperation;
  data: any;
  localVersion: number;
  timestamp: number;
  retryCount: number;
}

/**
 * Sync conflict requiring resolution
 */
export interface SyncConflict {
  id: string;
  entityType: SyncEntityType;
  localData: any;
  cloudData: any;
  localTimestamp: number;
  cloudTimestamp: number;
  resolvedBy?: 'local' | 'cloud' | 'manual';
}

/**
 * Data types that can be synced
 */
export interface SyncableData {
  documents: any[];
  folders: any[];
  flashcards: any[];
  testResults: any[];
  achievements: string[];
  settings: any;
}

/**
 * Current sync status for UI display
 */
export interface SyncStatus {
  lastSyncTime: Date | null;
  isSyncing: boolean;
  isOnline: boolean;
  pendingChanges: number;
  syncError: string | null;
  syncProgress: number; // 0-100
  currentOperation: string | null;
  conflicts: SyncConflict[];
}

/**
 * Listener callback types
 */
type SyncStatusListener = (status: SyncStatus) => void;
type SyncListener = () => void;

// ============================================
// EVENT LISTENERS
// ============================================

/**
 * Listeners for sync status changes
 * UI components subscribe to receive real-time updates
 */
const syncStatusListeners: SyncStatusListener[] = [];
const syncListeners: SyncListener[] = [];

/**
 * Subscribe to sync status changes
 * 
 * @param listener - Callback function receiving SyncStatus
 * @returns Unsubscribe function
 * 
 * @example
 * const unsubscribe = onSyncStatusChange((status) => {
 *   console.log('Sync status:', status.isSyncing);
 * });
 * // Later: unsubscribe();
 */
export const onSyncStatusChange = (listener: SyncStatusListener): (() => void) => {
  syncStatusListeners.push(listener);
  return () => {
    const index = syncStatusListeners.indexOf(listener);
    if (index > -1) syncStatusListeners.splice(index, 1);
  };
};

/**
 * Subscribe to document sync completion events
 * Legacy API - use onSyncStatusChange for more details
 */
export const onDocumentsSync = (listener: SyncListener): (() => void) => {
  syncListeners.push(listener);
  return () => {
    const index = syncListeners.indexOf(listener);
    if (index > -1) syncListeners.splice(index, 1);
  };
};

/**
 * Notify all status listeners of changes
 */
const notifySyncStatusChange = (status: SyncStatus): void => {
  syncStatusListeners.forEach(listener => {
    try {
      listener(status);
    } catch (error) {
      console.error('[CloudSync] Error in status listener:', error);
    }
  });
};

/**
 * Notify document sync listeners
 */
const notifyDocumentsSync = (): void => {
  syncListeners.forEach(listener => {
    try {
      listener();
    } catch (error) {
      console.error('[CloudSync] Error in sync listener:', error);
    }
  });
};

// ============================================
// CLOUD SYNC SERVICE CLASS
// ============================================

/**
 * CloudSyncService - Manages all sync operations
 * 
 * Features:
 * - Offline queue management
 * - Automatic sync on network restore
 * - Conflict detection and resolution
 * - Progress tracking
 * - Real-time status updates
 */
class CloudSyncService {
  // ========================================
  // INSTANCE PROPERTIES
  // ========================================
  
  private userId: string | null = null;
  private networkUnsubscribe: EventSubscription | null = null;
  
  /**
   * Current sync status
   * Updated throughout sync operations
   */
  private syncStatus: SyncStatus = {
    lastSyncTime: null,
    isSyncing: false,
    isOnline: true,
    pendingChanges: 0,
    syncError: null,
    syncProgress: 0,
    currentOperation: null,
    conflicts: [],
  };

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize sync service with user ID
   * Sets up network monitoring and loads cached state
   * 
   * @param userId - Authenticated user's ID
   * 
   * @example
   * await cloudSyncService.initialize(user.id);
   */
  async initialize(userId: string): Promise<void> {
    console.log('[CloudSync] Initializing for user:', userId);
    this.userId = userId;
    
    // Load cached sync state
    await this.loadCachedState();
    
    // Setup network monitoring
    this.setupNetworkMonitoring();
    
    // Get last sync time from server
    await this.getLastSyncTime();
    
    // Check for pending changes
    await this.loadPendingChanges();
    
    this.notifyStatusChange();
  }

  /**
   * Set user ID without full initialization
   */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * Get current sync status
   * Returns a copy to prevent external mutation
   */
  getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  // ========================================
  // NETWORK MONITORING
  // ========================================

  /**
   * Setup network state monitoring
   * Automatically syncs when connection is restored
   */
  private setupNetworkMonitoring(): void {
    // Unsubscribe from previous listener if exists
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe.remove();
    }

    this.networkUnsubscribe = Network.addNetworkStateListener((state: Network.NetworkState) => {
      const wasOffline = !this.syncStatus.isOnline;
      const isNowOnline = state.isConnected ?? false;
      
      this.syncStatus.isOnline = isNowOnline;
      
      console.log(`[CloudSync] Network state: ${isNowOnline ? 'ONLINE' : 'OFFLINE'}`);
      
      // Connection restored - process pending sync queue
      if (wasOffline && isNowOnline && this.syncStatus.pendingChanges > 0) {
        console.log('[CloudSync] Connection restored, processing sync queue...');
        this.processSyncQueue();
      }
      
      this.notifyStatusChange();
    });
  }

  /**
   * Cleanup network listener
   */
  cleanup(): void {
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe.remove();
      this.networkUnsubscribe = null;
    }
  }

  // ========================================
  // CACHED STATE MANAGEMENT
  // ========================================

  /**
   * Load cached sync state from AsyncStorage
   */
  private async loadCachedState(): Promise<void> {
    try {
      const [lastSyncStr, conflictsStr] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC_TIME),
        AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFLICTS),
      ]);

      if (lastSyncStr) {
        this.syncStatus.lastSyncTime = new Date(lastSyncStr);
      }

      if (conflictsStr) {
        this.syncStatus.conflicts = JSON.parse(conflictsStr);
      }
    } catch (error) {
      console.error('[CloudSync] Error loading cached state:', error);
    }
  }

  /**
   * Load pending changes count from queue
   */
  private async loadPendingChanges(): Promise<void> {
    try {
      const queueStr = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
      if (queueStr) {
        const queue: QueuedSyncItem[] = JSON.parse(queueStr);
        this.syncStatus.pendingChanges = queue.length;
      }
    } catch (error) {
      console.error('[CloudSync] Error loading pending changes:', error);
    }
  }

  /**
   * Notify all listeners of status change
   */
  private notifyStatusChange(): void {
    notifySyncStatusChange(this.getStatus());
  }

  // ========================================
  // SYNC QUEUE MANAGEMENT
  // ========================================

  /**
   * Add item to sync queue for later processing
   * Called when offline or sync fails
   * 
   * @param entityType - Type of entity (document, folder, etc.)
   * @param operation - Operation type (create, update, delete)
   * @param data - Entity data to sync
   */
  async addToSyncQueue(
    entityType: SyncEntityType,
    operation: SyncOperation,
    data: any
  ): Promise<void> {
    try {
      const queueStr = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
      const queue: QueuedSyncItem[] = queueStr ? JSON.parse(queueStr) : [];

      // Get or increment local version
      const versionKey = `${STORAGE_KEYS.LOCAL_VERSION}_${entityType}_${data.id}`;
      const versionStr = await AsyncStorage.getItem(versionKey);
      const localVersion = versionStr ? parseInt(versionStr) + 1 : 1;
      await AsyncStorage.setItem(versionKey, localVersion.toString());

      // Check if item already in queue (update it instead of adding duplicate)
      const existingIndex = queue.findIndex(
        item => item.entityType === entityType && item.data?.id === data.id
      );

      const queueItem: QueuedSyncItem = {
        id: `${entityType}_${data.id}_${Date.now()}`,
        entityType,
        operation,
        data,
        localVersion,
        timestamp: Date.now(),
        retryCount: 0,
      };

      if (existingIndex >= 0) {
        // Update existing queue item
        queue[existingIndex] = queueItem;
      } else {
        // Add new item to queue
        queue.push(queueItem);
      }

      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
      this.syncStatus.pendingChanges = queue.length;
      
      console.log(`[CloudSync] Added to queue: ${operation} ${entityType} (${queue.length} pending)`);
      this.notifyStatusChange();
    } catch (error) {
      console.error('[CloudSync] Error adding to sync queue:', error);
    }
  }

  /**
   * Process all items in sync queue
   * Called when connection is restored
   */
  async processSyncQueue(): Promise<void> {
    if (!this.userId || !this.syncStatus.isOnline) {
      console.log('[CloudSync] Cannot process queue: offline or no user');
      return;
    }

    try {
      const queueStr = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
      if (!queueStr) return;

      const queue: QueuedSyncItem[] = JSON.parse(queueStr);
      if (queue.length === 0) return;

      console.log(`[CloudSync] Processing ${queue.length} queued items...`);
      
      this.syncStatus.isSyncing = true;
      this.syncStatus.syncProgress = 0;
      this.notifyStatusChange();

      const failedItems: QueuedSyncItem[] = [];
      const total = queue.length;

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        this.syncStatus.currentOperation = `Syncing ${item.entityType} (${i + 1}/${total})`;
        this.syncStatus.syncProgress = Math.round((i / total) * 100);
        this.notifyStatusChange();

        try {
          await this.processQueueItem(item);
          console.log(`[CloudSync] Synced: ${item.entityType} ${item.operation}`);
        } catch (error) {
          console.error(`[CloudSync] Failed to sync item:`, error);
          item.retryCount++;
          
          // Keep item in queue if under retry limit
          if (item.retryCount < 3) {
            failedItems.push(item);
          }
        }
      }

      // Save failed items back to queue
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(failedItems));
      this.syncStatus.pendingChanges = failedItems.length;
      this.syncStatus.isSyncing = false;
      this.syncStatus.syncProgress = 100;
      this.syncStatus.currentOperation = null;
      
      if (failedItems.length === 0) {
        await this.updateLastSyncTime();
      }

      this.notifyStatusChange();
      notifyDocumentsSync();

      console.log(`[CloudSync] Queue processed: ${total - failedItems.length} succeeded, ${failedItems.length} failed`);
    } catch (error) {
      console.error('[CloudSync] Error processing sync queue:', error);
      this.syncStatus.isSyncing = false;
      this.syncStatus.syncError = 'Failed to process sync queue';
      this.notifyStatusChange();
    }
  }

  /**
   * Process a single queued sync item
   */
  private async processQueueItem(item: QueuedSyncItem): Promise<void> {
    switch (item.entityType) {
      case 'document':
        if (item.operation === 'delete') {
          await this.deleteDocumentFromCloud(item.data.id);
        } else {
          await this.uploadSingleDocument(item.data, item.localVersion);
        }
        break;
      case 'folder':
        if (item.operation === 'delete') {
          await this.deleteFolderFromCloud(item.data.id);
        } else {
          await this.uploadSingleFolder(item.data);
        }
        break;
      case 'testResult':
        await this.uploadSingleTestResult(item.data);
        break;
      case 'userStats':
        await this.uploadUserStats(item.data);
        break;
    }
  }

  // ========================================
  // CONFLICT RESOLUTION
  // ========================================

  /**
   * Check for conflicts between local and cloud data
   * Uses timestamps to detect concurrent modifications
   * 
   * @param localData - Local version of data
   * @param cloudData - Cloud version of data
   * @param entityType - Type of entity
   * @returns Conflict if detected, null otherwise
   */
  private async checkForConflict(
    localData: any,
    cloudData: any,
    entityType: SyncEntityType
  ): Promise<SyncConflict | null> {
    if (!cloudData) return null;

    const localTimestamp = localData.updatedAt 
      ? new Date(localData.updatedAt).getTime()
      : new Date(localData.createdAt || 0).getTime();
    
    const cloudTimestamp = cloudData.updated_at
      ? new Date(cloudData.updated_at).getTime()
      : new Date(cloudData.created_at || 0).getTime();

    // If cloud version is newer and local was modified, we have a conflict
    if (cloudTimestamp > localTimestamp) {
      // Check if local has pending changes
      const versionKey = `${STORAGE_KEYS.LOCAL_VERSION}_${entityType}_${localData.id}`;
      const localVersion = await AsyncStorage.getItem(versionKey);
      
      if (localVersion && parseInt(localVersion) > 0) {
        return {
          id: localData.id,
          entityType,
          localData,
          cloudData,
          localTimestamp,
          cloudTimestamp,
        };
      }
    }

    return null;
  }

  /**
   * Resolve a sync conflict
   * Uses last-write-wins by default, but can be manual
   * 
   * @param conflict - The conflict to resolve
   * @param resolution - How to resolve ('local', 'cloud', or 'manual')
   */
  async resolveConflict(
    conflict: SyncConflict,
    resolution: 'local' | 'cloud' | 'manual'
  ): Promise<void> {
    try {
      console.log(`[CloudSync] Resolving conflict for ${conflict.entityType}:${conflict.id} -> ${resolution}`);

      if (resolution === 'local') {
        // Push local version to cloud
        await this.addToSyncQueue(
          conflict.entityType,
          'update',
          conflict.localData
        );
      } else if (resolution === 'cloud') {
        // Save cloud version locally
        if (conflict.entityType === 'document') {
          await saveDocument(this.mapCloudDocumentToLocal(conflict.cloudData));
        } else if (conflict.entityType === 'folder') {
          await saveFolder(this.mapCloudFolderToLocal(conflict.cloudData));
        }
      }

      // Remove from conflicts list
      this.syncStatus.conflicts = this.syncStatus.conflicts.filter(
        c => c.id !== conflict.id
      );
      
      await AsyncStorage.setItem(
        STORAGE_KEYS.SYNC_CONFLICTS,
        JSON.stringify(this.syncStatus.conflicts)
      );

      this.notifyStatusChange();
    } catch (error) {
      console.error('[CloudSync] Error resolving conflict:', error);
    }
  }

  /**
   * Auto-resolve conflicts using last-write-wins
   */
  async autoResolveConflicts(): Promise<void> {
    for (const conflict of this.syncStatus.conflicts) {
      // Last-write-wins: newer timestamp wins
      const resolution = conflict.cloudTimestamp > conflict.localTimestamp 
        ? 'cloud' 
        : 'local';
      await this.resolveConflict(conflict, resolution);
    }
  }

  // ========================================
  // HELPER MAPPERS
  // ========================================

  /**
   * Map cloud document format to local Document type
   */
  private mapCloudDocumentToLocal(cloudDoc: any): Document {
    return {
      id: cloudDoc.id,
      title: cloudDoc.title,
      content: cloudDoc.content,
      fileType: cloudDoc.file_type,
      fileSize: cloudDoc.file_size,
      fileName: cloudDoc.title,
      fileUri: '',
      uploadedAt: new Date(cloudDoc.created_at),
      userId: cloudDoc.user_id,
      summary: cloudDoc.summary,
    };
  }

  /**
   * Map cloud folder format to local Folder type
   */
  private mapCloudFolderToLocal(cloudFolder: any): Folder {
    return {
      id: cloudFolder.id,
      name: cloudFolder.name,
      emoji: cloudFolder.emoji,
      color: cloudFolder.color,
      documentIds: [],
      createdAt: new Date(cloudFolder.created_at),
    };
  }

  // ========================================
  // LAST SYNC TIME
  // ========================================

  /**
   * Get last sync time from Supabase
   * Fetches from sync_metadata table
   */
  async getLastSyncTime(): Promise<Date | null> {
    if (!this.userId) return null;

    try {
      const { data, error } = await supabase
        .from('sync_metadata')
        .select('last_sync_at')
        .eq('user_id', this.userId)
        .single();

      if (data && !error && data.last_sync_at) {
        this.syncStatus.lastSyncTime = new Date(data.last_sync_at);
        return this.syncStatus.lastSyncTime;
      }
      return null;
    } catch (error) {
      console.error('[CloudSync] Error getting last sync time:', error);
      return null;
    }
  }

  /**
   * Update last sync timestamp in Supabase and AsyncStorage
   */
  private async updateLastSyncTime(): Promise<void> {
    if (!this.userId) return;

    const now = new Date();
    
    try {
      // Update in Supabase
      await supabase
        .from('sync_metadata')
        .upsert({
          user_id: this.userId,
          last_sync_at: now.toISOString(),
        });

      // Cache locally for offline access
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, now.toISOString());

      this.syncStatus.lastSyncTime = now;
      this.notifyStatusChange();
    } catch (error) {
      console.error('[CloudSync] Error updating sync time:', error);
    }
  }

  // ========================================
  // SINGLE ENTITY OPERATIONS
  // ========================================

  /**
   * Upload a single document to cloud
   * Used by queue processor and direct calls
   * 
   * @param doc - Document to upload
   * @param localVersion - Local version number for conflict tracking
   */
  private async uploadSingleDocument(doc: any, localVersion?: number): Promise<void> {
    if (!this.userId) throw new Error('User not authenticated');

    // First check for conflicts with cloud version
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('*')
      .eq('id', doc.id)
      .eq('user_id', this.userId)
      .single();

    const conflict = await this.checkForConflict(doc, existingDoc, 'document');
    
    if (conflict) {
      // Add to conflicts list for user resolution
      this.syncStatus.conflicts.push(conflict);
      await AsyncStorage.setItem(
        STORAGE_KEYS.SYNC_CONFLICTS,
        JSON.stringify(this.syncStatus.conflicts)
      );
      console.log(`[CloudSync] Conflict detected for document: ${doc.id}`);
      return;
    }

    const { error } = await supabase
      .from('documents')
      .upsert({
        id: doc.id,
        user_id: this.userId,
        title: doc.title,
        content: doc.content,
        file_type: doc.fileType,
        file_size: doc.fileSize,
        file_uri: doc.fileUri || '',
        summary: doc.summary || null,
        folder_id: doc.folderId || null,
        tags: doc.tags || [],
        version: localVersion || 1,
        created_at: doc.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;

    // Clear local version after successful sync
    const versionKey = `${STORAGE_KEYS.LOCAL_VERSION}_document_${doc.id}`;
    await AsyncStorage.removeItem(versionKey);
  }

  /**
   * Upload a single folder to cloud
   */
  private async uploadSingleFolder(folder: any): Promise<void> {
    if (!this.userId) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('folders')
      .upsert({
        id: folder.id,
        user_id: this.userId,
        name: folder.name,
        emoji: folder.emoji,
        color: folder.color,
        parent_folder_id: folder.parentFolderId || null,
        document_count: Array.isArray(folder.documentIds) ? folder.documentIds.length : 0,
        created_at: folder.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
  }

  /**
   * Upload a single test result to cloud
   */
  private async uploadSingleTestResult(result: any): Promise<void> {
    if (!this.userId) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('quiz_results')
      .upsert({
        id: result.id,
        user_id: this.userId,
        document_id: result.documentId,
        quiz_type: result.testType,
        score: result.score,
        total_questions: result.totalQuestions,
        correct_answers: result.correctAnswers,
        time_spent_seconds: result.timeSpent,
        completed_at: result.completedAt,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
  }

  /**
   * Delete a document from cloud
   */
  private async deleteDocumentFromCloud(documentId: string): Promise<void> {
    if (!this.userId) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId)
      .eq('user_id', this.userId);

    if (error) throw error;
  }

  /**
   * Delete a folder from cloud
   */
  private async deleteFolderFromCloud(folderId: string): Promise<void> {
    if (!this.userId) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', this.userId);

    if (error) throw error;
  }

  // ========================================
  // BATCH UPLOAD OPERATIONS
  // ========================================

  /**
   * Upload multiple documents to cloud
   * Queues if offline, syncs immediately if online
   * 
   * @param documents - Array of documents to upload
   * @returns Success status
   * 
   * SYNC FLOW:
   * 1. Check network status
   * 2. If offline → add to queue
   * 3. If online → upload each document
   * 4. Handle conflicts during upload
   * 5. Update sync time on success
   */
  async uploadDocuments(documents: any[]): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    // If offline, queue all documents for later sync
    if (!this.syncStatus.isOnline) {
      console.log('[CloudSync] Offline - queueing documents for later sync');
      for (const doc of documents) {
        await this.addToSyncQueue('document', 'update', doc);
      }
      return true; // Queued successfully
    }

    try {
      this.syncStatus.isSyncing = true;
      this.syncStatus.syncProgress = 0;
      this.syncStatus.currentOperation = 'Uploading documents';
      this.notifyStatusChange();

      const total = documents.length;
      
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        this.syncStatus.syncProgress = Math.round((i / total) * 100);
        this.notifyStatusChange();

        try {
          await this.uploadSingleDocument(doc);
        } catch (error) {
          console.error(`[CloudSync] Failed to upload document ${doc.id}:`, error);
          // Queue for retry
          await this.addToSyncQueue('document', 'update', doc);
        }
      }

      this.syncStatus.syncProgress = 100;
      await this.updateLastSyncTime();
      return true;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error uploading documents:', error);
      return false;
    } finally {
      this.syncStatus.isSyncing = false;
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Download documents from cloud
   * Caches locally for offline access
   * 
   * @returns Array of downloaded documents
   */
  async downloadDocuments(): Promise<any[]> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.isSyncing = true;
      this.syncStatus.currentOperation = 'Downloading documents';
      this.notifyStatusChange();

      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('user_id', this.userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const documents = data || [];
      
      // Save downloaded documents to local storage (offline cache)
      for (const doc of documents) {
        try {
          const document: Document = this.mapCloudDocumentToLocal(doc);
          await saveDocument(document);
        } catch (e) {
          console.error(`[CloudSync] Failed to cache document ${doc.id}:`, e);
        }
      }

      // Cache document IDs for offline reference
      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_DOCUMENTS,
        JSON.stringify(documents.map((d: any) => d.id))
      );

      // Notify listeners that documents were synced
      if (documents.length > 0) {
        console.log('[CloudSync] Downloaded', documents.length, 'documents');
        notifyDocumentsSync();
      }

      return documents;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error downloading documents:', error);
      return [];
    } finally {
      this.syncStatus.isSyncing = false;
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Upload multiple folders to cloud
   */
  async uploadFolders(folders: any[]): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    if (!this.syncStatus.isOnline) {
      console.log('[CloudSync] Offline - queueing folders for later sync');
      for (const folder of folders) {
        await this.addToSyncQueue('folder', 'update', folder);
      }
      return true;
    }

    try {
      this.syncStatus.isSyncing = true;
      this.syncStatus.currentOperation = 'Uploading folders';
      this.notifyStatusChange();

      for (const folder of folders) {
        try {
          await this.uploadSingleFolder(folder);
        } catch (error) {
          console.error(`[CloudSync] Failed to upload folder ${folder.id}:`, error);
          await this.addToSyncQueue('folder', 'update', folder);
        }
      }

      await this.updateLastSyncTime();
      return true;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error uploading folders:', error);
      return false;
    } finally {
      this.syncStatus.isSyncing = false;
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Download folders from cloud
   */
  async downloadFolders(): Promise<any[]> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.currentOperation = 'Downloading folders';
      this.notifyStatusChange();

      const { data, error } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', this.userId);

      if (error) throw error;

      const folders = data || [];
      
      // Save downloaded folders to local storage (offline cache)
      for (const f of folders) {
        try {
          const folder: Folder = this.mapCloudFolderToLocal(f);
          await saveFolder(folder);
        } catch (e) {
          console.error(`[CloudSync] Failed to cache folder ${f.id}:`, e);
        }
      }

      // Cache folder IDs for offline reference
      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_FOLDERS,
        JSON.stringify(folders.map((f: any) => f.id))
      );

      return folders;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error downloading folders:', error);
      return [];
    } finally {
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Upload test results to cloud
   */
  async uploadTestResults(results: any[]): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    if (!this.syncStatus.isOnline) {
      console.log('[CloudSync] Offline - queueing test results for later sync');
      for (const result of results) {
        await this.addToSyncQueue('testResult', 'update', result);
      }
      return true;
    }

    try {
      this.syncStatus.isSyncing = true;
      this.syncStatus.currentOperation = 'Uploading test results';
      this.notifyStatusChange();

      for (const result of results) {
        try {
          await this.uploadSingleTestResult(result);
        } catch (error) {
          console.error(`[CloudSync] Failed to upload test result ${result.id}:`, error);
          await this.addToSyncQueue('testResult', 'update', result);
        }
      }

      await this.updateLastSyncTime();
      return true;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error uploading test results:', error);
      return false;
    } finally {
      this.syncStatus.isSyncing = false;
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Download test results from cloud
   */
  async downloadTestResults(): Promise<any[]> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.currentOperation = 'Downloading test results';
      this.notifyStatusChange();

      const { data, error } = await supabase
        .from('quiz_results')
        .select('*')
        .eq('user_id', this.userId)
        .order('completed_at', { ascending: false });

      if (error) throw error;

      const results = data || [];
      
      // Save downloaded test results to local storage
      for (const r of results) {
        try {
          const result: TestResult = {
            id: r.id,
            documentId: r.document_id,
            userId: r.user_id,
            score: r.score,
            totalQuestions: r.total_questions,
            correctAnswers: r.correct_answers ?? Math.round((r.score / 100) * r.total_questions),
            completedAt: new Date(r.completed_at),
            timeSpent: r.time_spent_seconds,
            testType: r.quiz_type,
          };
          await saveTestResult(result);
        } catch (e) {
          console.error(`[CloudSync] Failed to cache test result ${r.id}:`, e);
        }
      }

      return results;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error downloading test results:', error);
      return [];
    } finally {
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  // ========================================
  // USER STATS OPERATIONS
  // ========================================

  /**
   * Upload user stats/gamification data to cloud
   */
  async uploadUserStats(stats: any): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    if (!this.syncStatus.isOnline) {
      console.log('[CloudSync] Offline - queueing user stats for later sync');
      await this.addToSyncQueue('userStats', 'update', stats);
      return true;
    }

    try {
      const { error } = await supabase
        .from('user_stats')
        .upsert({
          user_id: this.userId,
          total_xp: stats.totalXP,
          current_level: stats.level,
          current_streak: stats.currentStreak,
          longest_streak: stats.longestStreak,
          achievements: stats.achievements,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      return true;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error uploading user stats:', error);
      return false;
    }
  }

  /**
   * Download user stats from cloud
   */
  async downloadUserStats(): Promise<any | null> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      const { data, error } = await supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', this.userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      return data;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error downloading user stats:', error);
      return null;
    }
  }

  // ========================================
  // FULL SYNC OPERATION
  // ========================================

  /**
   * Full sync - upload and download all data
   * Performs bidirectional sync with conflict detection
   * 
   * @param localData - All local data to sync
   * @returns Merged cloud data or null on error
   * 
   * FULL SYNC FLOW:
   * ┌────────────────────────────────────────┐
   * │ 1. Process pending sync queue first   │
   * │ 2. Upload local documents             │
   * │ 3. Upload local folders               │
   * │ 4. Upload test results                │
   * │ 5. Upload user stats                  │
   * │ 6. Download cloud documents           │
   * │ 7. Download cloud folders             │
   * │ 8. Download cloud test results        │
   * │ 9. Download cloud user stats          │
   * │ 10. Resolve any conflicts             │
   * │ 11. Update sync timestamp             │
   * └────────────────────────────────────────┘
   */
  async fullSync(localData: SyncableData): Promise<SyncableData | null> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    // Cannot do full sync if offline
    if (!this.syncStatus.isOnline) {
      console.log('[CloudSync] Cannot perform full sync - offline');
      this.syncStatus.syncError = 'Cannot sync - no internet connection';
      this.notifyStatusChange();
      return null;
    }

    try {
      this.syncStatus.isSyncing = true;
      this.syncStatus.syncError = null;
      this.syncStatus.syncProgress = 0;
      this.syncStatus.currentOperation = 'Starting full sync';
      this.notifyStatusChange();

      // Step 1: Process any pending items in queue first
      console.log('[CloudSync] Processing pending queue...');
      this.syncStatus.currentOperation = 'Processing pending changes';
      this.syncStatus.syncProgress = 5;
      this.notifyStatusChange();
      await this.processSyncQueue();

      // Step 2: Upload local data (40% of progress)
      console.log('[CloudSync] Uploading local data...');
      this.syncStatus.currentOperation = 'Uploading local data';
      this.syncStatus.syncProgress = 10;
      this.notifyStatusChange();

      await Promise.all([
        this.uploadDocuments(localData.documents),
        this.uploadFolders(localData.folders),
        this.uploadTestResults(localData.testResults),
        this.uploadUserStats({
          achievements: localData.achievements,
          ...localData.settings,
        }),
      ]);

      this.syncStatus.syncProgress = 50;
      this.notifyStatusChange();

      // Step 3: Download cloud data (40% of progress)
      console.log('[CloudSync] Downloading cloud data...');
      this.syncStatus.currentOperation = 'Downloading cloud data';
      this.notifyStatusChange();

      const [documents, folders, testResults, stats] = await Promise.all([
        this.downloadDocuments(),
        this.downloadFolders(),
        this.downloadTestResults(),
        this.downloadUserStats(),
      ]);

      this.syncStatus.syncProgress = 90;
      this.notifyStatusChange();

      // Step 4: Auto-resolve any conflicts with last-write-wins
      if (this.syncStatus.conflicts.length > 0) {
        console.log('[CloudSync] Auto-resolving conflicts...');
        this.syncStatus.currentOperation = 'Resolving conflicts';
        await this.autoResolveConflicts();
      }

      // Step 5: Update sync time
      await this.updateLastSyncTime();
      
      this.syncStatus.syncProgress = 100;
      this.syncStatus.currentOperation = 'Sync complete';
      this.notifyStatusChange();

      console.log('[CloudSync] Full sync complete');

      return {
        documents,
        folders,
        flashcards: [], // Flashcards are derived from documents
        testResults,
        achievements: stats?.achievements || [],
        settings: stats || {},
      };
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('[CloudSync] Error in full sync:', error);
      return null;
    } finally {
      this.syncStatus.isSyncing = false;
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  // ========================================
  // DELETE OPERATIONS
  // ========================================

  /**
   * Delete all cloud data for user
   * Used for account deletion or data reset
   */
  async deleteAllCloudData(): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.isSyncing = true;
      this.syncStatus.currentOperation = 'Deleting cloud data';
      this.notifyStatusChange();

      await Promise.all([
        supabase.from('documents').delete().eq('user_id', this.userId),
        supabase.from('folders').delete().eq('user_id', this.userId),
        supabase.from('quiz_results').delete().eq('user_id', this.userId),
        supabase.from('user_stats').delete().eq('user_id', this.userId),
        supabase.from('sync_metadata').delete().eq('user_id', this.userId),
      ]);

      // Clear local cache
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.SYNC_QUEUE,
        STORAGE_KEYS.PENDING_CHANGES,
        STORAGE_KEYS.LAST_SYNC_TIME,
        STORAGE_KEYS.CACHED_DOCUMENTS,
        STORAGE_KEYS.CACHED_FOLDERS,
        STORAGE_KEYS.SYNC_CONFLICTS,
      ]);

      this.syncStatus.lastSyncTime = null;
      this.syncStatus.pendingChanges = 0;
      this.syncStatus.conflicts = [];
      
      console.log('[CloudSync] All cloud data deleted');
      return true;
    } catch (error: any) {
      console.error('[CloudSync] Error deleting cloud data:', error);
      return false;
    } finally {
      this.syncStatus.isSyncing = false;
      this.syncStatus.currentOperation = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Clear the sync queue
   * Used when user wants to discard pending changes
   */
  async clearSyncQueue(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.SYNC_QUEUE);
      this.syncStatus.pendingChanges = 0;
      this.notifyStatusChange();
      console.log('[CloudSync] Sync queue cleared');
    } catch (error) {
      console.error('[CloudSync] Error clearing sync queue:', error);
    }
  }

  /**
   * Manually trigger sync
   * Can be called by user from settings
   */
  async manualSync(): Promise<boolean> {
    if (this.syncStatus.isSyncing) {
      console.log('[CloudSync] Sync already in progress');
      return false;
    }

    if (!this.syncStatus.isOnline) {
      console.log('[CloudSync] Cannot sync - offline');
      return false;
    }

    console.log('[CloudSync] Starting manual sync...');
    await this.processSyncQueue();
    return true;
  }
}

// ============================================
// EXPORTS
// ============================================

/**
 * Singleton instance of CloudSyncService
 * Use this for all sync operations
 */
export const cloudSyncService = new CloudSyncService();
export default cloudSyncService;
