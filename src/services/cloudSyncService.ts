// Cloud Sync Service - Backup and sync data to Supabase

import { supabase } from './supabase';
import { saveDocument, saveFolder, saveTestResult } from './storage';
import { Document } from '../types/document';
import { Folder } from '../types/folder';
import { TestResult } from '../types/performance';

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
        .from('user_sync')
        .select('last_sync_time')
        .eq('user_id', this.userId)
        .single();

      if (data && !error) {
        this.syncStatus.lastSyncTime = new Date(data.last_sync_time);
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
          .from('user_documents')
          .upsert({
            id: doc.id,
            user_id: this.userId,
            title: doc.title,
            content: doc.content,
            file_type: doc.fileType,
            file_size: doc.fileSize,
            created_at: doc.createdAt,
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
        .from('user_documents')
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
            // Add other fields if available in Supabase schema
          };
          await saveDocument(document);
        } catch (e) {
          console.error(`Failed to save synced document ${doc.id}:`, e);
        }
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
        .from('user_folders')
        .upsert(
          folders.map(folder => ({
            id: folder.id,
            user_id: this.userId,
            name: folder.name,
            emoji: folder.emoji,
            color: folder.color,
            document_ids: folder.documentIds,
            created_at: folder.createdAt,
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
        .from('user_folders')
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
            documentIds: f.document_ids || [], // Assuming array in DB
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
        .from('user_test_results')
        .upsert(
          results.map(result => ({
            id: result.id,
            user_id: this.userId,
            document_id: result.documentId,
            test_type: result.testType,
            score: result.score,
            total_questions: result.totalQuestions,
            time_spent: result.timeSpent,
            completed_at: result.completedAt,
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
        .from('user_test_results')
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
            correctAnswers: Math.round((r.score / 100) * r.total_questions), // Approximate if not stored
            completedAt: new Date(r.completed_at),
            timeSpent: r.time_spent,
            testType: r.test_type,
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
          level: stats.level,
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
        .from('user_sync')
        .upsert({
          user_id: this.userId,
          last_sync_time: now.toISOString(),
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
        supabase.from('user_documents').delete().eq('user_id', this.userId),
        supabase.from('user_folders').delete().eq('user_id', this.userId),
        supabase.from('user_test_results').delete().eq('user_id', this.userId),
        supabase.from('user_stats').delete().eq('user_id', this.userId),
        supabase.from('user_sync').delete().eq('user_id', this.userId),
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
