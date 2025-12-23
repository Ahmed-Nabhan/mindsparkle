import * as SQLite from 'expo-sqlite';
import { Document } from '../types/document';
import { TestResult } from '../types/performance';

const db = SQLite. openDatabaseSync('mindsparkle.db');

export const initDatabase = async (): Promise<void> => {
  try {
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
        userId TEXT
      );
    `);
    console.log('Documents table created');

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
    console.log('Test results table created');
  } catch (error) {
    console. error('Error creating tables:', error);
    throw error;
  }
};

export const saveDocument = async (document: Document): Promise<void> => {
  try {
    await db. runAsync(
      `INSERT INTO documents (id, title, fileName, fileUri, fileType, fileSize, uploadedAt, content, summary, userId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        document. id,
        document.title,
        document.fileName,
        document.fileUri,
        document. fileType,
        document.fileSize,
        document.uploadedAt.toISOString(),
        document.content || '',
        document.summary || '',
        document.userId || '',
      ]
    );
  } catch (error) {
    console.error('Error saving document:', error);
    throw error;
  }
};

export const getAllDocuments = async (): Promise<Document[]> => {
  try {
    const rows = await db.getAllAsync<any>(
      'SELECT * FROM documents ORDER BY uploadedAt DESC;'
    );
    return rows.map(row => ({
      ... row,
      uploadedAt: new Date(row.uploadedAt),
    }));
  } catch (error) {
    console.error('Error fetching documents:', error);
    throw error;
  }
};

export const getDocumentById = async (id: string): Promise<Document | null> => {
  try {
    const row = await db.getFirstAsync<any>(
      'SELECT * FROM documents WHERE id = ?;',
      [id]
    );
    if (row) {
      return {
        ...row,
        uploadedAt:  new Date(row. uploadedAt),
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching document:', error);
    throw error;
  }
};

export const saveTestResult = async (result: TestResult): Promise<void> => {
  try {
    await db. runAsync(
      `INSERT INTO test_results (id, documentId, userId, score, totalQuestions, correctAnswers, completedAt, timeSpent, testType)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? );`,
      [
        result.id,
        result. documentId,
        result.userId,
        result.score,
        result.totalQuestions,
        result.correctAnswers,
        result. completedAt.toISOString(),
        result.timeSpent,
        result.testType,
      ]
    );
  } catch (error) {
    console.error('Error saving test result:', error);
    throw error;
  }
};

export const getAllTestResults = async (): Promise<TestResult[]> => {
  try {
    const rows = await db.getAllAsync<any>(
      'SELECT * FROM test_results ORDER BY completedAt DESC;'
    );
    return rows.map(row => ({
      ...row,
      completedAt: new Date(row.completedAt),
    }));
  } catch (error) {
    console.error('Error fetching test results:', error);
    throw error;
  }
};
