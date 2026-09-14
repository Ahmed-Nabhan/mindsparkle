/**
 * Pure helpers for migrating MindSparkle data from an existing install
 * into the current app edition. Kept free of React Native / SQLite so
 * the mapping rules can be unit-tested in Node.
 */

export const BACKUP_FORMAT = 'mindsparkle-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const DATA_SCHEMA_VERSION = 3;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MigrationDocument = {
  id: string;
  title: string;
  fileName: string;
  fileUri: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  content?: string;
  summary?: string;
  summaryModules?: unknown;
  summaryPaged?: unknown;
  userId?: string;
  pdfCloudUrl?: string;
  extractedData?: {
    text?: string;
    pages?: Array<{ pageNumber?: number; text?: string }>;
    images?: unknown[];
    tables?: Array<{
      id?: string;
      title?: string;
      headers?: string[];
      rows?: string[][];
      pageNumber?: number;
    }>;
    equations?: string[];
    totalPages?: number;
  };
};

export type MigrationFolder = {
  id: string;
  name: string;
  emoji?: string;
  color?: string;
  documentIds: string[];
  createdAt: string;
};

export type MigrationTestResult = {
  id: string;
  documentId: string;
  userId: string;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  completedAt: string;
  timeSpent: number;
  testType: string;
};

export type MigrationBackup = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  sourceAppVersion: string;
  dataSchemaVersion: number;
  documents: MigrationDocument[];
  folders: MigrationFolder[];
  testResults: MigrationTestResult[];
  preferences: Record<string, string | null>;
};

export type MigrationReport = {
  fromVersion: string | null;
  toSchemaVersion: number;
  documentsKept: number;
  documentsImported: number;
  documentsSkipped: number;
  documentsRemapped: number;
  foldersImported: number;
  testResultsImported: number;
  preferencesRestored: number;
  cloudSynced: number;
  cloudSkipped: number;
  errors: string[];
};

export function createEmptyReport(fromVersion: string | null): MigrationReport {
  return {
    fromVersion,
    toSchemaVersion: DATA_SCHEMA_VERSION,
    documentsKept: 0,
    documentsImported: 0,
    documentsSkipped: 0,
    documentsRemapped: 0,
    foldersImported: 0,
    testResultsImported: 0,
    preferencesRestored: 0,
    cloudSynced: 0,
    cloudSkipped: 0,
    errors: [],
  };
}

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Expand an arbitrary seed into hex so non-UUID local ids can be upserted
 * into the cloud `documents.id` UUID column without colliding across reruns.
 */
function hexHash(seed: string, length: number): string {
  let h1 = 2166136261;
  let h2 = 16777619;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
    h2 = (h2 + Math.imul(h1, i + 1)) >>> 0;
  }
  let hex = '';
  let a = h1 >>> 0;
  let b = h2 >>> 0;
  while (hex.length < length) {
    a = Math.imul(a ^ (a >>> 16), 2246822507) >>> 0;
    b = Math.imul(b ^ (b >>> 13), 3266489909) >>> 0;
    hex += a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  return hex.slice(0, length);
}

export function uuidFromSeed(seed: string): string {
  const hex = hexHash(seed, 32);
  const variantByte = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variantByte}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function toCanonicalDocumentId(localId: string): string {
  if (isUuid(localId)) return localId.toLowerCase();
  return uuidFromSeed(`mindsparkle-doc:${localId}`);
}

export function needsIdRemap(localId: string): boolean {
  return !isUuid(localId);
}

export function isValidBackup(input: unknown): input is MigrationBackup {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<MigrationBackup>;
  return (
    value.format === BACKUP_FORMAT &&
    typeof value.formatVersion === 'number' &&
    value.formatVersion >= 1 &&
    Array.isArray(value.documents) &&
    Array.isArray(value.folders) &&
    Array.isArray(value.testResults) &&
    !!value.preferences &&
    typeof value.preferences === 'object'
  );
}

export function parseBackupJson(raw: string): MigrationBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Backup file is not valid JSON.');
  }
  if (!isValidBackup(parsed)) {
    throw new Error('This file is not a MindSparkle backup.');
  }
  return parsed;
}

export function normalizeDocument(raw: Record<string, unknown>): MigrationDocument | null {
  const id = String(raw.id || '').trim();
  const title = String(raw.title || raw.fileName || '').trim();
  if (!id || !title) return null;

  const uploadedAt =
    typeof raw.uploadedAt === 'string'
      ? raw.uploadedAt
      : raw.uploadedAt instanceof Date
        ? raw.uploadedAt.toISOString()
        : new Date().toISOString();

  return {
    id,
    title,
    fileName: String(raw.fileName || title),
    fileUri: String(raw.fileUri || ''),
    fileType: String(raw.fileType || 'application/octet-stream'),
    fileSize: Number(raw.fileSize) || 0,
    uploadedAt,
    content: typeof raw.content === 'string' ? raw.content : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    summaryModules: raw.summaryModules,
    summaryPaged: raw.summaryPaged,
    userId: typeof raw.userId === 'string' ? raw.userId : undefined,
    pdfCloudUrl: typeof raw.pdfCloudUrl === 'string' ? raw.pdfCloudUrl : undefined,
    extractedData:
      raw.extractedData && typeof raw.extractedData === 'object'
        ? (raw.extractedData as MigrationDocument['extractedData'])
        : undefined,
  };
}

export function mergeImportedDocuments(
  existingIds: Set<string>,
  incoming: MigrationDocument[]
): { toInsert: MigrationDocument[]; skipped: number } {
  const toInsert: MigrationDocument[] = [];
  let skipped = 0;
  const seen = new Set(existingIds);

  for (const doc of incoming) {
    const canonicalId = toCanonicalDocumentId(doc.id);
    const alreadyHave = seen.has(doc.id) || seen.has(canonicalId);
    if (alreadyHave) {
      skipped += 1;
      continue;
    }
    const next = { ...doc, id: canonicalId };
    toInsert.push(next);
    seen.add(canonicalId);
  }

  return { toInsert, skipped };
}

export function remapFolderDocumentIds(
  folders: MigrationFolder[],
  idMap: Record<string, string>
): MigrationFolder[] {
  return folders.map(folder => ({
    ...folder,
    documentIds: (folder.documentIds || []).map(id => idMap[id] || toCanonicalDocumentId(id)),
  }));
}

export function remapTestResultDocumentIds(
  results: MigrationTestResult[],
  idMap: Record<string, string>
): MigrationTestResult[] {
  return results.map(result => ({
    ...result,
    documentId: idMap[result.documentId] || toCanonicalDocumentId(result.documentId),
  }));
}

export function buildIdMap(documents: MigrationDocument[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const doc of documents) {
    const next = toCanonicalDocumentId(doc.id);
    if (next !== doc.id) map[doc.id] = next;
  }
  return map;
}

export function applyCanonicalIds(backup: MigrationBackup): {
  backup: MigrationBackup;
  remapped: number;
} {
  const idMap = buildIdMap(backup.documents);
  const remapped = Object.keys(idMap).length;
  const documents = backup.documents.map(doc => ({
    ...doc,
    id: toCanonicalDocumentId(doc.id),
  }));
  return {
    remapped,
    backup: {
      ...backup,
      documents,
      folders: remapFolderDocumentIds(backup.folders, idMap),
      testResults: remapTestResultDocumentIds(backup.testResults, idMap),
    },
  };
}

function wordCount(text: string | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function toCloudDocumentRow(
  doc: MigrationDocument,
  userId: string
): Record<string, unknown> {
  const extractedText = doc.extractedData?.text || doc.content || '';
  const content = String(doc.content || extractedText || '').slice(0, 100_000);
  const pageCount =
    doc.extractedData?.totalPages ||
    doc.extractedData?.pages?.length ||
    1;
  const now = new Date().toISOString();

  const row: Record<string, unknown> = {
    id: toCanonicalDocumentId(doc.id),
    user_id: userId,
    title: doc.title,
    content,
    extracted_text: extractedText.slice(0, 500_000) || null,
    file_type: doc.fileType,
    file_size: doc.fileSize,
    file_uri: doc.pdfCloudUrl || doc.fileUri || '',
    summary: doc.summary || null,
    has_text: content.length > 0,
    text_length: content.length,
    page_count: pageCount,
    word_count: wordCount(extractedText || content),
    extraction_status: content.length > 50 ? 'extracted' : 'uploaded',
    created_at: doc.uploadedAt || now,
    updated_at: now,
  };

  if (doc.extractedData) {
    row.canonical_content = {
      fullText: extractedText,
      pages: (doc.extractedData.pages || []).map(page => ({
        pageNumber: page.pageNumber || 1,
        text: page.text || '',
        blocks: [],
      })),
      tables: (doc.extractedData.tables || []).map((table, index) => ({
        id: table.id || `table-${index + 1}`,
        pageNumber: table.pageNumber || 1,
        title: table.title,
        headers: table.headers || [],
        rows: (table.rows || []).map(cells => ({
          cells: (cells || []).map(text => ({ text })),
        })),
        confidence: 0.8,
      })),
      figures: [],
      formFields: [],
    };
  }

  return row;
}

export function summarizeReport(report: MigrationReport): string {
  const parts = [
    `${report.documentsKept} local document${report.documentsKept === 1 ? '' : 's'} kept`,
  ];
  if (report.documentsImported) {
    parts.push(`${report.documentsImported} imported`);
  }
  if (report.documentsSkipped) {
    parts.push(`${report.documentsSkipped} already present`);
  }
  if (report.cloudSynced) {
    parts.push(`${report.cloudSynced} copied to cloud`);
  }
  if (report.errors.length) {
    parts.push(`${report.errors.length} issue${report.errors.length === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}
