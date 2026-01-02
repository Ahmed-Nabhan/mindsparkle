// Cloud Sync Service - Backup and sync data to Supabase

import { supabase } from './supabase';
import { saveDocument, saveFolder, saveTestResult } from './storage';
import { Document } from '../types/document';
import { Folder } from '../types/folder';
import { TestResult } from '../types/performance';

// Simple event emitter for sync events
type SyncListener = () => void;
const syncListeners: SyncListener[] = [];

export const onDocumentsSync = (listener: SyncListener): (() => void) => {
  syncListeners.push(listener);
  return () => {
    const index = syncListeners.indexOf(listener);
    if (index > -1) syncListeners.splice(index, 1);
  };
};

const notifyDocumentsSync = () => {
  syncListeners.forEach(listener => listener());
};

export interface SyncableData {
  documents: any[];
  folders: any[];
  flashcards: any[];
  testResults: any[];
  achievements: string[];
  settings: any;
}

export interface SyncStatus {
  lastSyncTime: Date | null;
  isSyncing: boolean;
  pendingChanges: number;
  syncError: string | null;
}

class CloudSyncService {
  private userId: string | null = null;
  private syncStatus: SyncStatus = {
    lastSyncTime: null,
    isSyncing: false,
    pendingChanges: 0,
    syncError: null,
  };

  // Initialize with user ID
  async initialize(userId: string): Promise<void> {
    this.userId = userId;
    await this.getLastSyncTime();
  }

  // Set user ID
  setUserId(userId: string): void {
    this.userId = userId;
  }

  // Get current sync status
  getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  // Get last sync time from Supabase
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
      console.error('Error getting last sync time:', error);
      return null;
    }
  }

  // Upload documents to cloud
  async uploadDocuments(documents: any[]): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.isSyncing = true;

      for (const doc of documents) {
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
            created_at: doc.createdAt || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (error) throw error;
      }

      await this.updateLastSyncTime();
      return true;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('Error uploading documents:', error);
      return false;
    } finally {
      this.syncStatus.isSyncing = false;
    }
  }

  // Download documents from cloud
  async downloadDocuments(): Promise<any[]> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.isSyncing = true;

      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('user_id', this.userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const documents = data || [];
      
      // Save downloaded documents to local storage
      for (const doc of documents) {
        try {
          const document: Document = {
            id: doc.id,
            title: doc.title,
            content: doc.content,
            fileType: doc.file_type,
            fileSize: doc.file_size,
            fileName: doc.title, // Fallback
            fileUri: '', // Cannot restore local URI
            uploadedAt: new Date(doc.created_at),
            userId: doc.user_id,
            summary: doc.summary,
            // Add other fields if available in Supabase schema
          };
          await saveDocument(document);
        } catch (e) {
          console.error(`Failed to save synced document ${doc.id}:`, e);
        }
      }

      // Notify listeners that documents were synced
      if (documents.length > 0) {
        console.log('[CloudSync] Notifying UI of', documents.length, 'synced documents');
        notifyDocumentsSync();
      }

      return documents;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('Error downloading documents:', error);
      return [];
    } finally {
      this.syncStatus.isSyncing = false;
    }
  }

  // Upload folders to cloud
  async uploadFolders(folders: any[]): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.isSyncing = true;

      const { error } = await supabase
        .from('folders')
        .upsert(
          folders.map(folder => ({
            id: folder.id,
            user_id: this.userId,
            name: folder.name,
            emoji: folder.emoji,
            color: folder.color,
            parent_folder_id: folder.parentFolderId || null,
            document_count: Array.isArray(folder.documentIds) ? folder.documentIds.length : 0,
            created_at: folder.createdAt || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }))
        );

      if (error) throw error;

      await this.updateLastSyncTime();
      return true;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('Error uploading folders:', error);
      return false;
    } finally {
      this.syncStatus.isSyncing = false;
    }
  }

  // Download folders from cloud
  async downloadFolders(): Promise<any[]> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      const { data, error } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', this.userId);

      if (error) throw error;

      const folders = data || [];
      
      // Save downloaded folders to local storage
      for (const f of folders) {
        try {
          const folder: Folder = {
            id: f.id,
            name: f.name,
            emoji: f.emoji,
            color: f.color,
            documentIds: [], // not stored server-side
            createdAt: new Date(f.created_at),
          };
          await saveFolder(folder);
        } catch (e) {
          console.error(`Failed to save synced folder ${f.id}:`, e);
        }
      }

      return folders;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('Error downloading folders:', error);
      return [];
    }
  }

  // Upload test results to cloud
  async uploadTestResults(results: any[]): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.isSyncing = true;

      const { error } = await supabase
        .from('quiz_results')
        .upsert(
          results.map(result => ({
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
          }))
        );

      if (error) throw error;

      await this.updateLastSyncTime();
      return true;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('Error uploading test results:', error);
      return false;
    } finally {
      this.syncStatus.isSyncing = false;
    }
  }

  // Download test results from cloud
  async downloadTestResults(): Promise<any[]> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
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
          console.error(`Failed to save synced test result ${r.id}:`, e);
        }
      }

      return results;
    } catch (error: any) {
      this.syncStatus.syncError = error.message;
      console.error('Error downloading test results:', error);
      return [];
    }
  }

  // Upload user stats/gamification data
  async uploadUserStats(stats: any): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
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
      console.error('Error uploading user stats:', error);
      return false;
    }
  }

  // Download user stats from cloud
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
      console.error('Error downloading user stats:', error);
      return null;
    }
  }

  // Full sync - upload and download all data
  async fullSync(localData: SyncableData): Promise<SyncableData | null> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      this.syncStatus.isSyncing = true;
      this.syncStatus.syncError = null;

      // Upload local data
      await Promise.all([
        this.uploadDocuments(localData.documents),
        this.uploadFolders(localData.folders),
        this.uploadTestResults(localData.testResults),
        this.uploadUserStats({
          achievements: localData.achievements,
          ...localData.settings,
        }),
      ]);

      // Download cloud data
      const [documents, folders, testResults, stats] = await Promise.all([
        this.downloadDocuments(),
        this.downloadFolders(),
        this.downloadTestResults(),
        this.downloadUserStats(),
      ]);

      await this.updateLastSyncTime();

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
      console.error('Error in full sync:', error);
      return null;
    } finally {
      this.syncStatus.isSyncing = false;
    }
  }

  // Update last sync timestamp
  private async updateLastSyncTime(): Promise<void> {
    if (!this.userId) return;

    const now = new Date();
    
    try {
      await supabase
        .from('sync_metadata')
        .upsert({
          user_id: this.userId,
          last_sync_at: now.toISOString(),
        });

      this.syncStatus.lastSyncTime = now;
    } catch (error) {
      console.error('Error updating sync time:', error);
    }
  }

  // Delete all cloud data for user
  async deleteAllCloudData(): Promise<boolean> {
    if (!this.userId) {
      throw new Error('User not authenticated');
    }

    try {
      await Promise.all([
        supabase.from('documents').delete().eq('user_id', this.userId),
        supabase.from('folders').delete().eq('user_id', this.userId),
        supabase.from('quiz_results').delete().eq('user_id', this.userId),
        supabase.from('user_stats').delete().eq('user_id', this.userId),
        supabase.from('sync_metadata').delete().eq('user_id', this.userId),
      ]);

      return true;
    } catch (error: any) {
      console.error('Error deleting cloud data:', error);
      return false;
    }
  }
}

export const cloudSyncService = new CloudSyncService();
export default cloudSyncService;
