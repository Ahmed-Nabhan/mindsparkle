import * as SQLite from 'expo-sqlite';
import { Document, ExtractedData } from '../types/document';
import { TestResult } from '../types/performance';
import { Folder } from '../types/folder';

const dbPromise = SQLite.openDatabaseAsync('mindsparkle.db');
let schemaInitPromise: Promise<void> | null = null;

const initializeSchema = async (): Promise<void> => {
  const db = await dbPromise;
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
        summaryModulesJson TEXT,
        summaryPagedJson TEXT,
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

    try {
      await db.execAsync('ALTER TABLE documents ADD COLUMN summaryModulesJson TEXT;');
    } catch (error) {
      // Column already exists
    }

    try {
      await db.execAsync('ALTER TABLE documents ADD COLUMN summaryPagedJson TEXT;');
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

const getDb = async () => {
  if (!schemaInitPromise) {
    schemaInitPromise = initializeSchema();
  }
  await schemaInitPromise;
  return await dbPromise;
};

export const initDatabase = async (): Promise<void> => {
  await getDb();
};

export const saveDocument = async (document: Document): Promise<void> => {
  try {
    const db = await getDb();
    // extractedData can be extremely large (full per-page text). Keep local storage lightweight
    // to avoid slow DB reads and JSON parsing during navigation.
    let extractedDataJson = '';
    if (document.extractedData) {
      const MAX_EXTRACTED_TEXT = 200_000;
      const MAX_PAGE_TEXT = 5_000;
      const MAX_PAGES_TEXT_TOTAL = 250_000;
      const MAX_IMAGES = 50;
      const MAX_TABLES = 50;
      const MAX_EQUATIONS = 200;

      let totalPageChars = 0;
      const safePages = Array.isArray(document.extractedData.pages)
        ? document.extractedData.pages
            .map(p => ({
              pageNumber: p.pageNumber,
              text: String(p.text || '').slice(0, MAX_PAGE_TEXT),
              images: Array.isArray(p.images) ? p.images.slice(0, 10) : [],
              tables: Array.isArray(p.tables) ? p.tables.slice(0, 5) : [],
            }))
            .filter(p => {
              if (!p.text) return false;
              if (totalPageChars >= MAX_PAGES_TEXT_TOTAL) return false;
              totalPageChars += p.text.length;
              return true;
            })
        : [];

      const safeExtractedData: ExtractedData = {
        ...document.extractedData,
        text: String(document.extractedData.text || '').slice(0, MAX_EXTRACTED_TEXT),
        pages: safePages as any,
        images: Array.isArray(document.extractedData.images) ? document.extractedData.images.slice(0, MAX_IMAGES) : [],
        tables: Array.isArray(document.extractedData.tables) ? document.extractedData.tables.slice(0, MAX_TABLES) : [],
        equations: Array.isArray(document.extractedData.equations) ? document.extractedData.equations.slice(0, MAX_EQUATIONS) : [],
      };

      try {
        extractedDataJson = JSON.stringify(safeExtractedData);
        // Hard cap to protect SQLite and navigation performance.
        const MAX_EXTRACTED_JSON = 900_000;
        if (extractedDataJson.length > MAX_EXTRACTED_JSON) {
          console.warn(`extractedDataJson too large (${extractedDataJson.length} chars). Dropping for local storage.`);
          extractedDataJson = '';
        }
      } catch {
        extractedDataJson = '';
      }
    }
    const summaryModulesJson = document.summaryModules ? JSON.stringify(document.summaryModules) : '';
    const summaryPagedJson = document.summaryPaged ? JSON.stringify(document.summaryPaged) : '';

    let contentToSave = document.content || '';
    // Allow larger documents to be usable offline; the app should still chunk for AI calls.
    const MAX_LOCAL_CONTENT = 2 * 1024 * 1024; // ~2MB chars
    if (contentToSave.length > MAX_LOCAL_CONTENT) {
      console.warn(`Document content too large (${contentToSave.length} chars). Truncating for local storage.`);
      contentToSave = `${contentToSave.substring(0, MAX_LOCAL_CONTENT)}... [TRUNCATED]`;
    }

    // Use INSERT OR REPLACE to handle re-sync of existing documents
    await db.runAsync(
      `INSERT OR REPLACE INTO documents (id, title, fileName, fileUri, fileType, fileSize, uploadedAt, content, summary, summaryModulesJson, summaryPagedJson, userId, pdfCloudUrl, extractedDataJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
        summaryModulesJson,
        summaryPagedJson,
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

export const updateDocumentSummaryModules = async (documentId: string, summaryModules: any[]): Promise<void> => {
  try {
    const db = await getDb();
    const json = summaryModules ? JSON.stringify(summaryModules) : '';
    await db.runAsync('UPDATE documents SET summaryModulesJson = ? WHERE id = ?;', [json, documentId]);
  } catch (error) {
    console.error('Error updating summary modules:', error);
    throw error;
  }
};

export const updateDocumentSummaryPaged = async (documentId: string, summaryPaged: any): Promise<void> => {
  try {
    const db = await getDb();
    const json = summaryPaged ? JSON.stringify(summaryPaged) : '';
    await db.runAsync('UPDATE documents SET summaryPagedJson = ? WHERE id = ?;', [json, documentId]);
  } catch (error) {
    console.error('Error updating paged summary:', error);
    throw error;
  }
};

export const getAllDocuments = async (): Promise<Document[]> => {
  try {
    const db = await getDb();
    // Avoid loading large fields (content/extractedData/summary JSON) in lists.
    const rows = await db.getAllAsync<any>(
      'SELECT id, title, fileName, fileUri, fileType, fileSize, uploadedAt, summary, userId, pdfCloudUrl FROM documents ORDER BY uploadedAt DESC;'
    );
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
      // Guard: old rows may contain huge extractedDataJson which can freeze UI on parse.
      const MAX_PARSE_JSON = 900_000;
      if (String(row.extractedDataJson).length <= MAX_PARSE_JSON) {
        try {
          extractedData = JSON.parse(row.extractedDataJson);
        } catch (error) {
          console.log('Error parsing extractedDataJson:', error);
        }
      } else {
        console.warn(`Skipping extractedDataJson parse (${String(row.extractedDataJson).length} chars) for performance.`);
      }
    }

    let summaryModules: any[] | undefined;
    if (row.summaryModulesJson) {
      try {
        // Keep this reasonably sized; if huge, skip parsing.
        if (String(row.summaryModulesJson).length < 2_000_000) {
          summaryModules = JSON.parse(row.summaryModulesJson);
        }
      } catch (error) {
        console.log('Error parsing summaryModulesJson:', error);
      }
    }

    let summaryPaged: any | undefined;
    if (row.summaryPagedJson) {
      try {
        if (String(row.summaryPagedJson).length < 2_000_000) {
          summaryPaged = JSON.parse(row.summaryPagedJson);
        }
      } catch (error) {
        console.log('Error parsing summaryPagedJson:', error);
      }
    }

    return {
      ...row,
      uploadedAt: new Date(row.uploadedAt),
      pdfCloudUrl: row.pdfCloudUrl || undefined,
      extractedData,
      summaryModules,
      summaryPaged,
    };
  } catch (error) {
    console.error('Error fetching document:', error);
    throw error;
  }
};

export const deleteDocument = async (id: string): Promise<void> => {
  try {
    const db = await getDb();
    await db.runAsync('DELETE FROM documents WHERE id = ?;', [id]);
    console.log('[Storage] Document deleted:', id);
    
    // Also try to soft delete from cloud if it's a UUID (cloud document)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        const { supabase } = await import('./supabase');
        // Try soft delete on documents table (new schema)
        await supabase.rpc('soft_delete_document', { doc_id: id });
        console.log('[Storage] Cloud document soft deleted:', id);
      } catch (cloudError) {
        // Silently fail - cloud document may not exist
        console.log('[Storage] Cloud delete skipped (may not exist):', id);
      }
    }
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
};

export const deleteAllDocuments = async (): Promise<void> => {
  try {
    // 1. Delete all local documents
    const db = await getDb();
    await db.runAsync('DELETE FROM documents;');
    console.log('[Storage] All local documents deleted');
    
    // 2. Soft delete all cloud documents for the current user
    try {
      const { supabase } = await import('./supabase');
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Soft delete all user's documents (set deleted_at)
        const { error } = await supabase
          .from('documents')
          .update({ deleted_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .is('deleted_at', null);
        
        if (error) {
          console.warn('[Storage] Cloud documents soft delete error:', error.message);
        } else {
          console.log('[Storage] All cloud documents soft deleted for user:', user.id);
        }
        
        // Also try cloud_documents table (legacy)
        await supabase
          .from('cloud_documents')
          .update({ deleted_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }
    } catch (cloudError: any) {
      console.warn('[Storage] Cloud delete error:', cloudError.message);
      // Continue - local documents were deleted
    }
  } catch (error) {
    console.error('Error deleting all documents:', error);
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
