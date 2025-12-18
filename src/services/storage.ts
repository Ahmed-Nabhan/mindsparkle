import * as SQLite from 'expo-sqlite';
import { Document } from '../types/document';
import { TestResult } from '../types/performance';

const db = SQLite.openDatabase('mindsparkle.db');

/**
 * Initialize database tables
 */
export const initDatabase = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      // Documents table
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS documents (
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
        );`,
        [],
        () => console.log('Documents table created'),
        (_, error) => {
          console.error('Error creating documents table:', error);
          return false;
        }
      );
      
      // Test results table
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS test_results (
          id TEXT PRIMARY KEY,
          documentId TEXT NOT NULL,
          userId TEXT NOT NULL,
          score REAL NOT NULL,
          totalQuestions INTEGER NOT NULL,
          correctAnswers INTEGER NOT NULL,
          completedAt TEXT NOT NULL,
          timeSpent INTEGER NOT NULL,
          testType TEXT NOT NULL
        );`,
        [],
        () => console.log('Test results table created'),
        (_, error) => {
          console.error('Error creating test results table:', error);
          return false;
        }
      );
    }, reject, resolve);
  });
};

/**
 * Save document to local storage
 */
export const saveDocument = (document: Document): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO documents (id, title, fileName, fileUri, fileType, fileSize, uploadedAt, content, summary, userId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          document.id,
          document.title,
          document.fileName,
          document.fileUri,
          document.fileType,
          document.fileSize,
          document.uploadedAt.toISOString(),
          document.content || '',
          document.summary || '',
          document.userId || '',
        ],
        () => resolve(),
        (_, error) => {
          console.error('Error saving document:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

/**
 * Get all documents from local storage
 */
export const getAllDocuments = (): Promise<Document[]> => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM documents ORDER BY uploadedAt DESC;',
        [],
        (_, { rows }) => {
          const documents = rows._array.map(row => ({
            ...row,
            uploadedAt: new Date(row.uploadedAt),
          }));
          resolve(documents);
        },
        (_, error) => {
          console.error('Error fetching documents:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

/**
 * Get document by ID
 */
export const getDocumentById = (id: string): Promise<Document | null> => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM documents WHERE id = ?;',
        [id],
        (_, { rows }) => {
          if (rows.length > 0) {
            const doc = rows._array[0];
            resolve({
              ...doc,
              uploadedAt: new Date(doc.uploadedAt),
            });
          } else {
            resolve(null);
          }
        },
        (_, error) => {
          console.error('Error fetching document:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

/**
 * Save test result
 */
export const saveTestResult = (result: TestResult): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
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
        ],
        () => resolve(),
        (_, error) => {
          console.error('Error saving test result:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

/**
 * Get all test results
 */
export const getAllTestResults = (): Promise<TestResult[]> => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM test_results ORDER BY completedAt DESC;',
        [],
        (_, { rows }) => {
          const results = rows._array.map(row => ({
            ...row,
            completedAt: new Date(row.completedAt),
          }));
          resolve(results);
        },
        (_, error) => {
          console.error('Error fetching test results:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};
