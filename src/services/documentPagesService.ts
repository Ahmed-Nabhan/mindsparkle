import { supabase } from './supabase';
import { createDocAssetsSignedUrl } from './documentOutputsService';

export type DocumentPageRow = {
  page_index: number;
  status?: string | null;
  kind?: string | null;
  method?: string | null;
  error?: string | null;
  text_length?: number | null;
};

export type DocumentPageBlockRow = {
  id: string;
  page_index: number;
  block_index: number;
  block_type: string;
  text: string | null;
  data: any;
  status?: string | null;
  confidence?: number | null;
};

export async function getDocumentPageCount(documentId: string): Promise<number> {
  const { data, error } = await supabase
    .from('documents')
    .select('page_count')
    .eq('id', documentId)
    .maybeSingle();

  const docCount = !error ? Number((data as any)?.page_count ?? 0) : 0;

  // Fall back to extracted pages if the document row is missing/incorrect.
  // This avoids showing absurd counts (e.g., thousands) when only a few pages exist.
  const { data: pagesData, error: pagesErr } = await supabase
    .from('document_pages')
    .select('page_index')
    .eq('document_id', documentId)
    .order('page_index', { ascending: false })
    .limit(1);

  const maxExtracted = (!pagesErr && Array.isArray(pagesData) && pagesData.length > 0)
    ? Number((pagesData[0] as any)?.page_index ?? 0)
    : 0;

  const safeDocCount = Number.isFinite(docCount) && docCount > 0 ? Math.floor(docCount) : 0;
  const safeExtracted = Number.isFinite(maxExtracted) && maxExtracted > 0 ? Math.floor(maxExtracted) : 0;

  // Heuristic:
  // - If extraction hasn't populated page rows yet (e.g. only 1 page), prefer the document's page_count.
  // - If page_count is absurdly larger than extracted pages (common bad metadata), prefer extracted.
  if (safeDocCount > 0 && safeExtracted > 0) {
    // If we have extracted more pages than the document claims (often bad metadata), trust extracted.
    if (safeDocCount <= 2 && safeExtracted > safeDocCount) return safeExtracted;

    // If extraction hasn't populated page rows yet (e.g. only 1-2 pages exist so far), prefer the document's page_count.
    if (safeExtracted <= 2) return safeDocCount;

    // If extracted pages are significantly larger than the document's page_count,
    // treat the document's page_count as likely wrong (common for PPTX/Office docs).
    if (safeDocCount <= 2 && safeExtracted > 2) return safeExtracted;
    const extractedMuchLarger = safeExtracted > safeDocCount * 2 + 2;
    if (extractedMuchLarger) return safeExtracted;

    const docLooksAbsurd = safeDocCount > 1000 && safeDocCount > safeExtracted * 3 + 50;
    if (docLooksAbsurd) return safeExtracted;
    return safeDocCount;
  }

  if (safeDocCount > 0) return safeDocCount;
  if (safeExtracted > 0) return safeExtracted;
  return 0;
}

export async function listDocumentPages(documentId: string): Promise<DocumentPageRow[]> {
  const { data, error } = await supabase
    .from('document_pages')
    .select('page_index,status,kind,method,error,text_length')
    .eq('document_id', documentId)
    .order('page_index', { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data as any;
}

export async function listDocumentPageBlocks(documentId: string, pageIndex: number): Promise<DocumentPageBlockRow[]> {
  const { data, error } = await supabase
    .from('document_page_blocks')
    .select('id,page_index,block_index,block_type,text,data,status,confidence')
    .eq('document_id', documentId)
    .eq('page_index', pageIndex)
    .order('block_index', { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data as any;
}

export function normalizePageTextFromBlocks(blocks: DocumentPageBlockRow[]): string {
  const parts: string[] = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b) continue;
    if (b.block_type !== 'paragraph' && b.block_type !== 'table') continue;
    const t = String(b.text || '').trim();
    if (!t) continue;
    parts.push(t);
  }
  // Avoid runaway context.
  return parts.join('\n\n').slice(0, 7000);
}

export async function getSignedPageImageUrl(documentId: string, pageIndex: number): Promise<string | null> {
  const name = `${documentId}/page_${String(pageIndex).padStart(3, '0')}.png`;
  const imagePath = `doc_assets/${name}`;
  return await createDocAssetsSignedUrl(imagePath, 1800);
}

export async function findPageIndexForTopic(documentId: string, topic: string): Promise<number | null> {
  const raw = String(topic || '').trim();
  if (!raw) return null;

  const words = raw
    .split(/[^a-z0-9\u0600-\u06FF]+/i)
    .map(w => w.trim())
    .filter(w => w.length >= 4);

  const stop = new Set([
    'this', 'that', 'with', 'from', 'into', 'your', 'their', 'about', 'overview', 'introduction',
    'and', 'the', 'for', 'are', 'was', 'were', 'can', 'will',
  ]);

  const strongWords = words.filter(w => !stop.has(w.toLowerCase())).slice(0, 8);

  // Try the full topic first, then a few strong keywords.
  const candidates = [raw, ...strongWords]
    .map(s => String(s).trim())
    .filter(Boolean)
    .slice(0, 5);

  for (const q of candidates) {
    try {
      const { data, error } = await supabase
        .from('document_page_blocks')
        .select('page_index')
        .eq('document_id', documentId)
        .ilike('text', `%${q}%`)
        .order('page_index', { ascending: true })
        .limit(1);

      if (!error && Array.isArray(data) && data.length > 0) {
        const n = Number((data[0] as any)?.page_index ?? 0);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      // try next
    }
  }

  // OR-search across multiple keywords for higher recall.
  if (strongWords.length > 0) {
    const orParts = strongWords
      .slice(0, 6)
      .map(w => `text.ilike.%${w}%`)
      .join(',');

    try {
      const { data, error } = await supabase
        .from('document_page_blocks')
        .select('page_index')
        .eq('document_id', documentId)
        .or(orParts)
        .order('page_index', { ascending: true })
        .limit(1);

      if (!error && Array.isArray(data) && data.length > 0) {
        const n = Number((data[0] as any)?.page_index ?? 0);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      // ignore
    }
  }

  return null;
}
