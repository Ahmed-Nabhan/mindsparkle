import * as SQLite from 'expo-sqlite';
import { Document, ExtractedData } from '../types/document';
import { TestResult } from '../types/performance';
import { Folder } from '../types/folder';

const dbPromise = SQLite.openDatabaseAsync('mindsparkle.db');
const getDb = async () => dbPromise;

export const initDatabase = async (): Promise<void> => {
  try {
    const db = await getDb();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        fileName TEXT NOT NULL,
        fileUri TEXT NOT NULL,
        fileType TEXT NOT NULL,
        fileSize INTEGER NOT NULL,
        uploadedAt TEXT NOT NULL,
        content TEXT,
        summary TEXT,
        userId TEXT,
        pdfCloudUrl TEXT,
        extractedDataJson TEXT
      );
    `);

    try {
      await db.execAsync('ALTER TABLE documents ADD COLUMN pdfCloudUrl TEXT;');
    } catch (error) {
      // Column already exists
    }

    try {
      await db.execAsync('ALTER TABLE documents ADD COLUMN extractedDataJson TEXT;');
    } catch (error) {
      // Column already exists
    }

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS test_results (
        id TEXT PRIMARY KEY,
        documentId TEXT NOT NULL,
        userId TEXT NOT NULL,
        score REAL NOT NULL,
        totalQuestions INTEGER NOT NULL,
        correctAnswers INTEGER NOT NULL,
        completedAt TEXT NOT NULL,
        timeSpent INTEGER NOT NULL,
        testType TEXT NOT NULL
      );
    `);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT,
        color TEXT,
        documentIds TEXT,
        createdAt TEXT NOT NULL
      );
    `);
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  }
};

export const saveDocument = async (document: Document): Promise<void> => {
  try {
    const db = await getDb();
    const extractedDataJson = document.extractedData ? JSON.stringify(document.extractedData) : '';

    let contentToSave = document.content || '';
    const MAX_LOCAL_CONTENT = 200000; // ~200k chars to avoid memory pressure
    if (contentToSave.length > MAX_LOCAL_CONTENT) {
      console.warn(`Document content too large (${contentToSave.length} chars). Truncating for local storage.`);
      contentToSave = `${contentToSave.substring(0, MAX_LOCAL_CONTENT)}... [TRUNCATED]`;
    }

    // Use INSERT OR REPLACE to handle re-sync of existing documents
    await db.runAsync(
      `INSERT OR REPLACE INTO documents (id, title, fileName, fileUri, fileType, fileSize, uploadedAt, content, summary, userId, pdfCloudUrl, extractedDataJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        document.id,
        document.title,
        document.fileName,
        document.fileUri,
        document.fileType,
        document.fileSize,
        document.uploadedAt.toISOString(),
        contentToSave,
        document.summary || '',
        document.userId || '',
        document.pdfCloudUrl || '',
        extractedDataJson,
      ]
    );
  } catch (error) {
    console.error('Error saving document:', error);
    throw error;
  }
};

export const updateDocumentExtractedData = async (
  documentId: string,
  extractedData: ExtractedData,
  pdfCloudUrl?: string
): Promise<void> => {
  try {
    const db = await getDb();
    const extractedDataJson = JSON.stringify(extractedData);
    await db.runAsync(
      'UPDATE documents SET extractedDataJson = ?, pdfCloudUrl = COALESCE(?, pdfCloudUrl) WHERE id = ?;',
      [extractedDataJson, pdfCloudUrl || null, documentId]
    );
  } catch (error) {
    console.error('Error updating extracted data:', error);
    throw error;
  }
};

export const updateDocumentSummary = async (documentId: string, summary: string): Promise<void> => {
  try {
    const db = await getDb();
    await db.runAsync('UPDATE documents SET summary = ? WHERE id = ?;', [summary, documentId]);
  } catch (error) {
    console.error('Error updating summary:', error);
    throw error;
  }
};

export const getAllDocuments = async (): Promise<Document[]> => {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<any>('SELECT * FROM documents ORDER BY uploadedAt DESC;');
    return rows.map(row => ({
      ...row,
      uploadedAt: new Date(row.uploadedAt),
    }));
  } catch (error) {
    console.error('Error fetching documents:', error);
    throw error;
  }
};

export const getDocumentById = async (id: string): Promise<Document | null> => {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<any>('SELECT * FROM documents WHERE id = ?;', [id]);
    if (!row) {
      return null;
    }

    let extractedData: ExtractedData | undefined;
    if (row.extractedDataJson) {
      try {
        extractedData = JSON.parse(row.extractedDataJson);
      } catch (error) {
        console.log('Error parsing extractedDataJson:', error);
      }
    }

    return {
      ...row,
      uploadedAt: new Date(row.uploadedAt),
      pdfCloudUrl: row.pdfCloudUrl || undefined,
      extractedData,
    };
  } catch (error) {
    console.error('Error fetching document:', error);
    throw error;
  }
};

export const saveTestResult = async (result: TestResult): Promise<void> => {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO test_results (id, documentId, userId, score, totalQuestions, correctAnswers, completedAt, timeSpent, testType)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        result.id,
        result.documentId,
        result.userId,
        result.score,
        result.totalQuestions,
        result.correctAnswers,
        result.completedAt.toISOString(),
        result.timeSpent,
        result.testType,
      ]
    );
  } catch (error) {
    console.error('Error saving test result:', error);
    throw error;
  }
};

export const saveFolder = async (folder: Folder): Promise<void> => {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO folders (id, name, emoji, color, documentIds, createdAt)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        folder.id,
        folder.name,
        folder.emoji,
        folder.color,
        JSON.stringify(folder.documentIds),
        folder.createdAt.toISOString(),
      ]
    );
  } catch (error) {
    console.error('Error saving folder:', error);
    throw error;
  }
};

export const getAllFolders = async (): Promise<Folder[]> => {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<any>('SELECT * FROM folders ORDER BY createdAt DESC;');
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      color: row.color,
      documentIds: JSON.parse(row.documentIds || '[]'),
      createdAt: new Date(row.createdAt),
    }));
  } catch (error) {
    console.error('Error fetching folders:', error);
    return [];
  }
};

export const getAllTestResults = async (): Promise<TestResult[]> => {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<any>('SELECT * FROM test_results ORDER BY completedAt DESC;');
    return rows.map(row => ({
      ...row,
      completedAt: new Date(row.completedAt),
    }));
  } catch (error) {
    console.error('Error fetching test results:', error);
    throw error;
  }
};
