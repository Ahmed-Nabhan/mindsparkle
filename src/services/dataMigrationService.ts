/**
 * Migrates data from a working MindSparkle install into the current edition.
 *
 * - Version upgrades no longer wipe local documents.
 * - Users can export a JSON backup from the old app and import it here.
 * - Signed-in users can copy the local library into the current cloud schema.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Document } from '../types/document';
import { Folder } from '../types/folder';
import { TestResult } from '../types/performance';
import { supabase } from './supabase';
import {
  claimDocumentsForUser,
  getAllFolders,
  getAllTestResults,
  getDocumentsForMigration,
  rekeyDocumentId,
  saveDocument,
  saveFolder,
  upsertTestResult,
} from './storage';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  DATA_SCHEMA_VERSION,
  MigrationBackup,
  MigrationDocument,
  MigrationReport,
  applyCanonicalIds,
  createEmptyReport,
  mergeImportedDocuments,
  needsIdRemap,
  parseBackupJson,
  toCanonicalDocumentId,
  toCloudDocumentRow,
} from './dataMigration/mapper';

export const APP_VERSION_KEY = '@mindsparkle_app_version';
export const SCHEMA_VERSION_KEY = '@mindsparkle_data_schema_version';
export const LAST_MIGRATION_REPORT_KEY = '@mindsparkle_last_migration_report';
export const CURRENT_APP_VERSION = '1.20.1';

const PREFERENCE_KEYS = [
  '@mindsparkle_theme_mode',
  '@mindsparkle_folders',
  '@mindsparkle_streak',
  '@mindsparkle_xp',
  '@mindsparkle_achievements',
  '@mindsparkle_daily_activity',
  '@mindsparkle_level',
  '@mindsparkle_notification_settings',
  'chatMind:v1',
  'videoLanguage',
  'videoUseAnimations',
  'subtitleLanguage',
];

let inFlight: Promise<MigrationReport> | null = null;

const documentToMigration = (doc: Document): MigrationDocument => ({
  id: doc.id,
  title: doc.title,
  fileName: doc.fileName,
  fileUri: doc.fileUri,
  fileType: doc.fileType,
  fileSize: doc.fileSize,
  uploadedAt: doc.uploadedAt instanceof Date ? doc.uploadedAt.toISOString() : String(doc.uploadedAt),
  content: doc.content,
  summary: doc.summary,
  summaryModules: doc.summaryModules,
  summaryPaged: doc.summaryPaged,
  userId: doc.userId,
  pdfCloudUrl: doc.pdfCloudUrl,
  extractedData: doc.extractedData,
});

async function collectPreferences(): Promise<Record<string, string | null>> {
  const preferences: Record<string, string | null> = {};
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const extraChatKeys = allKeys.filter(key => key.startsWith('docChat:v1'));
    const keys = Array.from(new Set([...PREFERENCE_KEYS, ...extraChatKeys]));
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [key, value] of pairs) {
      preferences[key] = value;
    }
  } catch (error) {
    console.warn('[DataMigration] Failed to collect preferences:', error);
  }
  return preferences;
}

export async function exportLocalBackup(): Promise<MigrationBackup> {
  const [documents, folders, testResults, preferences] = await Promise.all([
    getDocumentsForMigration(),
    getAllFolders(),
    getAllTestResults(),
    collectPreferences(),
  ]);

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceAppVersion: CURRENT_APP_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    documents: documents.map(documentToMigration),
    folders: folders.map((folder: Folder) => ({
      id: folder.id,
      name: folder.name,
      emoji: folder.emoji,
      color: folder.color,
      documentIds: folder.documentIds || [],
      createdAt:
        folder.createdAt instanceof Date ? folder.createdAt.toISOString() : String(folder.createdAt),
    })),
    testResults: testResults.map((result: TestResult) => ({
      id: result.id,
      documentId: result.documentId,
      userId: result.userId,
      score: result.score,
      totalQuestions: result.totalQuestions,
      correctAnswers: result.correctAnswers,
      completedAt:
        result.completedAt instanceof Date
          ? result.completedAt.toISOString()
          : String(result.completedAt),
      timeSpent: result.timeSpent,
      testType: result.testType,
    })),
    preferences,
  };
}

function downloadJsonOnWeb(json: string, fileName: string): void {
  const g = globalThis as any;
  const blob = new g.Blob([json], { type: 'application/json' });
  const url = g.URL.createObjectURL(blob);
  const anchor = g.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  g.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  g.URL.revokeObjectURL(url);
}

export async function shareBackupFile(): Promise<{ fileName: string; documentCount: number }> {
  const backup = await exportLocalBackup();
  const json = JSON.stringify(backup, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `mindsparkle-backup-${stamp}.json`;

  if (Platform.OS === 'web') {
    downloadJsonOnWeb(json, fileName);
    return { fileName, documentCount: backup.documents.length };
  }

  const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!directory) {
    throw new Error('File storage is not available on this device.');
  }
  const fileUri = `${directory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, json);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Export MindSparkle data',
      UTI: 'public.json',
    });
  }

  return { fileName, documentCount: backup.documents.length };
}

async function persistBackup(backup: MigrationBackup, report: MigrationReport): Promise<void> {
  const existing = await getDocumentsForMigration();
  const existingIds = new Set(existing.map(doc => doc.id));
  const { backup: canonical } = applyCanonicalIds(backup);
  const { toInsert, skipped } = mergeImportedDocuments(existingIds, canonical.documents);
  report.documentsSkipped += skipped;

  for (const doc of toInsert) {
    await saveDocument({
      id: doc.id,
      title: doc.title,
      fileName: doc.fileName,
      fileUri: doc.fileUri,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      uploadedAt: new Date(doc.uploadedAt),
      content: doc.content,
      summary: doc.summary,
      summaryModules: doc.summaryModules as any,
      summaryPaged: doc.summaryPaged as any,
      userId: doc.userId,
      pdfCloudUrl: doc.pdfCloudUrl,
      extractedData: doc.extractedData as any,
    });
    report.documentsImported += 1;
  }

  for (const folder of canonical.folders) {
    await saveFolder({
      id: folder.id,
      name: folder.name,
      emoji: folder.emoji || '📁',
      color: folder.color || '#3B82F6',
      documentIds: folder.documentIds || [],
      createdAt: new Date(folder.createdAt),
    });
    report.foldersImported += 1;
  }

  for (const result of canonical.testResults) {
    await upsertTestResult({
      id: result.id,
      documentId: result.documentId,
      userId: result.userId,
      score: result.score,
      totalQuestions: result.totalQuestions,
      correctAnswers: result.correctAnswers,
      completedAt: new Date(result.completedAt),
      timeSpent: result.timeSpent,
      testType: result.testType as TestResult['testType'],
    });
    report.testResultsImported += 1;
  }

  const preferenceEntries = Object.entries(canonical.preferences || {}).filter(
    ([, value]) => typeof value === 'string' && value.length > 0
  );
  if (preferenceEntries.length > 0) {
    await AsyncStorage.multiSet(preferenceEntries as [string, string][]);
    report.preferencesRestored += preferenceEntries.length;
  }
}

export async function importBackupFromJson(raw: string): Promise<MigrationReport> {
  const backup = parseBackupJson(raw);
  const report = createEmptyReport(backup.sourceAppVersion || null);
  await persistBackup(backup, report);
  await saveReport(report);
  return report;
}

export async function pickAndImportBackup(): Promise<MigrationReport | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  let raw = '';
  if (Platform.OS === 'web' && typeof (asset as any).file?.text === 'function') {
    raw = await (asset as any).file.text();
  } else if (asset.uri) {
    raw = await FileSystem.readAsStringAsync(asset.uri);
  }
  if (!raw) {
    throw new Error('Could not read the selected backup file.');
  }
  return importBackupFromJson(raw);
}

async function canonicalizeLocalIds(report: MigrationReport): Promise<void> {
  const documents = await getDocumentsForMigration();
  report.documentsKept = documents.length;
  for (const doc of documents) {
    if (!needsIdRemap(doc.id)) continue;
    const nextId = toCanonicalDocumentId(doc.id);
    try {
      await rekeyDocumentId(doc.id, nextId);
      report.documentsRemapped += 1;
    } catch (error: any) {
      report.errors.push(`Could not remap ${doc.title}: ${error?.message || error}`);
    }
  }
}

async function syncLocalDocumentsToCloud(userId: string, report: MigrationReport): Promise<void> {
  const documents = await getDocumentsForMigration();
  const { data: cloudRows, error } = await supabase
    .from('documents')
    .select('id')
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) {
    report.errors.push(`Cloud lookup failed: ${error.message}`);
    return;
  }

  const existing = new Set((cloudRows || []).map(row => String(row.id)));

  for (const doc of documents) {
    const cloudId = toCanonicalDocumentId(doc.id);
    if (existing.has(cloudId)) {
      report.cloudSkipped += 1;
      continue;
    }

    const row = toCloudDocumentRow(documentToMigration(doc), userId);
    const { error: upsertError } = await supabase.from('documents').upsert(row);
    if (upsertError) {
      const legacyRow = {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: row.content,
        file_type: row.file_type,
        file_size: row.file_size,
        file_uri: row.file_uri,
        summary: row.summary,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      const retry = await supabase.from('documents').upsert(legacyRow);
      if (retry.error) {
        report.errors.push(`${doc.title}: ${retry.error.message}`);
        continue;
      }
    }
    report.cloudSynced += 1;
    existing.add(cloudId);
  }
}

async function saveReport(report: MigrationReport): Promise<void> {
  try {
    await AsyncStorage.setItem(
      LAST_MIGRATION_REPORT_KEY,
      JSON.stringify({ ...report, completedAt: new Date().toISOString() })
    );
  } catch {
    // Non-fatal
  }
}

export async function getLastMigrationReport(): Promise<
  (MigrationReport & { completedAt?: string }) | null
> {
  try {
    const raw = await AsyncStorage.getItem(LAST_MIGRATION_REPORT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function migrateLocalDataToCurrentEdition(options?: {
  userId?: string | null;
  syncToCloud?: boolean;
}): Promise<MigrationReport> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const storedVersion = await AsyncStorage.getItem(APP_VERSION_KEY);
    const storedSchema = await AsyncStorage.getItem(SCHEMA_VERSION_KEY);
    const report = createEmptyReport(storedVersion || storedSchema);
    console.log(
      `[DataMigration] Upgrading local library to edition ${CURRENT_APP_VERSION} (schema ${DATA_SCHEMA_VERSION})`
    );

    try {
      await canonicalizeLocalIds(report);

      if (options?.userId) {
        await claimDocumentsForUser(options.userId);
        if (options.syncToCloud) {
          await syncLocalDocumentsToCloud(options.userId, report);
        }
      }

      await AsyncStorage.setItem(SCHEMA_VERSION_KEY, String(DATA_SCHEMA_VERSION));
      await AsyncStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION);
      await saveReport(report);
    } catch (error: any) {
      report.errors.push(error?.message || String(error));
      await saveReport(report);
    }

    return report;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function runStartupDataMigration(): Promise<void> {
  const storedSchema = await AsyncStorage.getItem(SCHEMA_VERSION_KEY);
  const storedVersion = await AsyncStorage.getItem(APP_VERSION_KEY);
  const needsUpgrade =
    storedSchema !== String(DATA_SCHEMA_VERSION) || storedVersion !== CURRENT_APP_VERSION;

  if (!needsUpgrade) {
    return;
  }

  await migrateLocalDataToCurrentEdition({ syncToCloud: false });
}

export { DATA_SCHEMA_VERSION };
