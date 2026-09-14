import { describe, expect, it } from 'vitest';
import {
  applyCanonicalIds,
  buildIdMap,
  isUuid,
  isValidBackup,
  mergeImportedDocuments,
  parseBackupJson,
  summarizeReport,
  toCanonicalDocumentId,
  toCloudDocumentRow,
  uuidFromSeed,
  type MigrationBackup,
  type MigrationDocument,
  createEmptyReport,
} from './mapper';

const sampleDoc = (overrides: Partial<MigrationDocument> = {}): MigrationDocument => ({
  id: '1770000000-abc123xyz',
  title: 'Networking Notes',
  fileName: 'networking.pdf',
  fileUri: 'file:///docs/networking.pdf',
  fileType: 'application/pdf',
  fileSize: 2048,
  uploadedAt: '2026-03-01T10:00:00.000Z',
  content: 'OSI model has seven layers.',
  summary: 'Intro to OSI',
  ...overrides,
});

describe('data migration mapper', () => {
  it('keeps valid UUIDs and remaps legacy local ids deterministically', () => {
    const uuid = '6f1c2e3a-1111-4111-8111-aaaaaaaaaaaa';
    expect(toCanonicalDocumentId(uuid)).toBe(uuid);
    expect(isUuid(uuid)).toBe(true);

    const first = toCanonicalDocumentId('1770000000-abc123xyz');
    const second = toCanonicalDocumentId('1770000000-abc123xyz');
    expect(first).toBe(second);
    expect(isUuid(first)).toBe(true);
    expect(first).not.toBe('1770000000-abc123xyz');
  });

  it('produces a version-5 style uuid from a seed', () => {
    const id = uuidFromSeed('mindsparkle-doc:demo');
    expect(isUuid(id)).toBe(true);
    expect(id.charAt(14)).toBe('5');
  });

  it('rejects files that are not MindSparkle backups', () => {
    expect(() => parseBackupJson('{not-json')).toThrow(/valid JSON/i);
    expect(() => parseBackupJson(JSON.stringify({ format: 'other' }))).toThrow(
      /not a MindSparkle backup/i
    );
    expect(isValidBackup(null)).toBe(false);
  });

  it('accepts a well-formed backup payload', () => {
    const backup: MigrationBackup = {
      format: 'mindsparkle-backup',
      formatVersion: 1,
      exportedAt: '2026-09-14T00:00:00.000Z',
      sourceAppVersion: '1.0.0',
      dataSchemaVersion: 2,
      documents: [sampleDoc()],
      folders: [
        {
          id: 'folder_1',
          name: 'Cisco',
          emoji: '📚',
          color: '#3B82F6',
          documentIds: ['1770000000-abc123xyz'],
          createdAt: '2026-03-01T10:00:00.000Z',
        },
      ],
      testResults: [
        {
          id: 'test-1',
          documentId: '1770000000-abc123xyz',
          userId: 'user-1',
          score: 80,
          totalQuestions: 10,
          correctAnswers: 8,
          completedAt: '2026-03-02T10:00:00.000Z',
          timeSpent: 120,
          testType: 'quiz',
        },
      ],
      preferences: { '@mindsparkle_theme_mode': 'dark' },
    };

    const parsed = parseBackupJson(JSON.stringify(backup));
    expect(parsed.documents).toHaveLength(1);

    const { backup: remapped, remapped: count } = applyCanonicalIds(parsed);
    expect(count).toBe(1);
    expect(isUuid(remapped.documents[0].id)).toBe(true);
    expect(remapped.folders[0].documentIds[0]).toBe(remapped.documents[0].id);
    expect(remapped.testResults[0].documentId).toBe(remapped.documents[0].id);
  });

  it('merges imports without overwriting documents that already exist', () => {
    const existingUuid = toCanonicalDocumentId('keep-me');
    const existing = new Set([existingUuid]);
    const incoming = [
      sampleDoc({ id: 'keep-me', title: 'Should skip' }),
      sampleDoc({ id: 'brand-new', title: 'Fresh notes' }),
    ];

    const { toInsert, skipped } = mergeImportedDocuments(existing, incoming);
    expect(skipped).toBe(1);
    expect(toInsert).toHaveLength(1);
    expect(toInsert[0].title).toBe('Fresh notes');
    expect(isUuid(toInsert[0].id)).toBe(true);
  });

  it('maps a local document to the current cloud edition row', () => {
    const userId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const row = toCloudDocumentRow(
      sampleDoc({
        content:
          'The OSI model has seven layers: physical, data link, network, transport, session, presentation, and application.',
        extractedData: {
          text: 'The OSI model has seven layers: physical, data link, network, transport, session, presentation, and application.',
          totalPages: 3,
          pages: [{ pageNumber: 1, text: 'Layer 1' }],
          tables: [{ id: 't1', title: 'Layers', headers: ['#', 'Name'], rows: [['1', 'Physical']], pageNumber: 1 }],
        },
      }),
      userId
    );

    expect(row.user_id).toBe(userId);
    expect(row.title).toBe('Networking Notes');
    expect(row.has_text).toBe(true);
    expect(row.page_count).toBe(3);
    expect(row.extraction_status).toBe('extracted');
    expect(isUuid(String(row.id))).toBe(true);
    expect((row.canonical_content as { pages: unknown[] }).pages).toHaveLength(1);
  });

  it('builds an id map only for non-uuid documents', () => {
    const uuid = '6f1c2e3a-1111-4111-8111-aaaaaaaaaaaa';
    const map = buildIdMap([sampleDoc({ id: uuid }), sampleDoc({ id: 'legacy-1' })]);
    expect(map[uuid]).toBeUndefined();
    expect(isUuid(map['legacy-1'])).toBe(true);
  });

  it('summarizes a migration report for the settings UI', () => {
    const report = createEmptyReport('1.0.0');
    report.documentsKept = 4;
    report.documentsImported = 2;
    report.cloudSynced = 3;
    expect(summarizeReport(report)).toContain('4 local documents kept');
    expect(summarizeReport(report)).toContain('2 imported');
    expect(summarizeReport(report)).toContain('3 copied to cloud');
  });
});
