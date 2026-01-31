// Main AI Service - Uses centralized config and services
// All document extraction happens at upload time via Cloud Document Intelligence
// These functions just use the already-extracted content

import Config from './config';
import ApiService, { summarizeModule as summarizeModuleFn, generateModuleImage as generateModuleImageFn } from './apiService';
import type { DocumentPagedSummary, PagedModule, PagedModuleContent } from '../types/document';

// Helper: Check if text is valid (not garbage or placeholder)
const isValidText = (text: string): boolean => {
  if (!text || text.length < 100) return false;
  
  // For long content, assume it's valid (extraction was successful)
  // Check this FIRST before marker checks to handle large valid documents
  if (text.length > 5000) {
    // Only reject if it starts with a marker (indicating it's entirely placeholder content)
    if (text.startsWith('__CLOUD_PROCESSING__') || 
        text.startsWith('__NEEDS_OCR__') ||
        text.trim().startsWith('[TRUNCATED]')) {
      console.log('[isValidText] Long content but starts with placeholder marker');
      return false;
    }
    console.log('[isValidText] Long content detected, assuming valid');
    return true;
  }
  
  // For shorter content, check for markers anywhere
  if (text.includes('__CLOUD_PROCESSING__')) return false;
  if (text.includes('__NEEDS_OCR__')) return false;
  
  // For shorter content, check for garbage text
  const sample = text.slice(0, 2000);
  let letters = 0, symbols = 0, whitespace = 0;
  
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    const char = sample[i];
    
    // Count ASCII letters
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      letters++;
    }
    // Count Arabic letters (U+0600 to U+06FF)
    else if (code >= 0x0600 && code <= 0x06FF) {
      letters++;
    }
    // Count other Unicode letters (basic check for common ranges)
    else if (code > 127 && /\p{L}/u.test(char)) {
      letters++;
    }
    // Count whitespace
    else if (char === ' ' || char === '\n' || char === '\t' || char === '\r') {
      whitespace++;
    }
    // Count problematic symbols (excluding common punctuation)
    else if (code >= 33 && code <= 126 && !'.,;:\'"!?()-[]/<>@#$%&*+='.includes(char)) {
      symbols++;
    }
  }
  
  const contentLength = sample.length - whitespace;
  if (contentLength === 0) return false;
  
  const letterRatio = letters / contentLength;
  const symbolRatio = symbols / contentLength;
  
  // Valid if more than 15% letters OR less than 50% symbols (more permissive)
  // This handles Arabic/Unicode text that might have lower letter ratios due to diacritics
  const isValid = letterRatio >= 0.15 || symbolRatio < 0.5;
  console.log(`[isValidText] letters: ${letters}, symbols: ${symbols}, contentLen: ${contentLength}, letterRatio: ${letterRatio.toFixed(2)}, symbolRatio: ${symbolRatio.toFixed(2)}, valid: ${isValid}`);
  
  return isValid;
};

// Helper: Get content from document (multiple fallback sources)
// IMPORTANT: Prefer extracted text when it is longer than the locally-stored `content`
// (local SQLite content may be truncated for very large documents).
const getDocumentContent = (content?: string, chunks?: string[], extractedData?: any): string => {
  const direct = String(content || '');
  const chunked = Array.isArray(chunks) && chunks.length > 0 ? chunks.join('\n\n') : '';

  const extractedFullText = String(
    extractedData?.text ||
      extractedData?.canonical?.content?.full_text ||
      extractedData?.canonical?.content?.fullText ||
      extractedData?.canonical?.content?.text ||
      extractedData?.content?.full_text ||
      extractedData?.content?.text ||
      ''
  );

  const extractedPages = extractedData?.pages;
  const extractedPagesWithMarkers = Array.isArray(extractedPages) && extractedPages.length > 0
    ? extractedPages
        .map((p: any) => `=== PAGE ${p.pageNumber || p.pageNum} ===\n${p.text || ''}`)
        .join('\n\n')
    : '';

  const candidates: { name: string; text: string }[] = [
    { name: 'extractedFullText', text: extractedFullText },
    { name: 'extractedPages', text: extractedPagesWithMarkers },
    { name: 'chunks', text: chunked },
    { name: 'direct', text: direct },
  ];

  // Filter out empty and placeholder-only values
  const usable = candidates
    .map((c) => ({ ...c, text: String(c.text || '') }))
    .filter((c) => c.text.length > 100)
    .filter((c) => !c.text.startsWith('__CLOUD_PROCESSING__') && !c.text.startsWith('__NEEDS_OCR__'));

  // Prefer the longest usable content to avoid truncation issues.
  usable.sort((a, b) => b.text.length - a.text.length);
  if (usable.length > 0) {
    const pick = usable[0];
    console.log(`[AI] Using ${pick.name}:`, pick.text.length, 'chars');
    return pick.text;
  }

  // Last resort
  return direct || extractedFullText || chunked || extractedPagesWithMarkers || '';
};

export var generateSummary = async function(
  content: string,
  chunks?: string[],
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string,
  existingPdfUrl?: string,
  existingExtractedData?: any,
  language?: 'en' | 'ar'
): Promise<string> {
  try {
    if (onProgress) onProgress(5, language === 'ar' ? 'جاري تحضير المستند...' : 'Preparing document...');

    var textContent = content || '';
    if (chunks && chunks.length > 0) {
      textContent = chunks.join('\n\n');
    }

    // Helper: Check if text is garbage (custom font encoding)
    const isGarbageText = (text: string): boolean => {
      if (!text || text.length < 100) return true;
      const sample = text.slice(0, 2000);
      let letters = 0, symbols = 0;
      for (let i = 0; i < sample.length; i++) {
        const code = sample.charCodeAt(i);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) letters++;
        else if (code >= 33 && code <= 126 && !'.,;:\'"!?()-[]/<> '.includes(sample[i])) symbols++;
      }
      const letterRatio = letters / sample.length;
      const symbolRatio = symbols / sample.length;
      // If less than 30% letters or more than 30% symbols, it's garbage
      return letterRatio < 0.3 || symbolRatio > 0.3;
    };

    // Check if content is a help message (not actual document content)
    const isHelpMessage = (text: string): boolean => {
      const lower = text.toLowerCase();
      return lower.includes('custom font encoding') || 
             lower.includes('google drive') || 
             lower.includes('google docs') ||
             lower.includes('__needs_ocr__') ||
             lower.includes('dev build') ||
             lower.includes('quick fix') ||
             lower.includes('requires ocr') ||
             lower.includes('npx expo run') ||
             lower.includes('standard text extraction');
    };

    // Return the actual help message directly
    const returnHelpMessage = (lang: 'en' | 'ar' = 'en') => {
      return lang === 'ar'
        ? '# ⚠️ تعذر إنشاء الملخص\n\nهذا المستند يستخدم ترميز خطوط مخصص يتطلب OCR للقراءة.\n\n**الحل:**\n1. ارفع الملف إلى Google Drive\n2. انقر بزر الماوس الأيمن → فتح باستخدام → Google Docs\n3. انسخ النص والصقه في ملف .txt\n4. ارفع ملف .txt بدلاً من ذلك'
        : '# ⚠️ Unable to Generate Summary\n\nThis PDF uses custom font encoding that requires OCR to read properly.\n\n**Quick Fix:**\n1. Upload the PDF to Google Drive\n2. Right-click → Open with → Google Docs\n3. Copy the text and paste into a .txt file\n4. Upload the .txt file instead\n\n*Google Docs will automatically OCR the document for free.*';
    };

    // PRIORITY 1: Use existing extracted data if available (no API calls needed!)
    if (existingExtractedData && existingExtractedData.pages && existingExtractedData.pages.length > 0) {
      var contentWithPages = existingExtractedData.pages.map(function(p: any) {
        var pageNum = p.pageNumber || p.pageNum;
        return '=== PAGE ' + pageNum + ' ===\n' + (p.text || '');
      }).join('\n\n');
      
      // Check if the cached data is garbage or help message
      if (isGarbageText(contentWithPages) || isHelpMessage(contentWithPages)) {
        console.log('[Summary] Cached data is garbage/help message, cannot generate summary');
        if (onProgress) onProgress(100, language === 'ar' ? 'غير قادر على إنشاء ملخص' : 'Unable to generate summary');
        return returnHelpMessage(language);
      }
      
      console.log('Using cached extracted data for summary, language:', language);
      if (onProgress) onProgress(50, language === 'ar' ? 'جاري إنشاء الملخص...' : 'Generating summary...');
      
      if (contentWithPages.length < 50) {
        contentWithPages = existingExtractedData.text || content || '';
      }
      
      // Include images from pages if available to improve multimodal summarization
      const existingImageUrls = existingExtractedData.pages
        .filter((p: any) => p.imageUrl)
        .map((p: any) => p.imageUrl);
      var summary = await ApiService.summarize(contentWithPages, { includePageRefs: true, includeImages: existingImageUrls.length > 0, imageUrls: existingImageUrls, language: language || 'en' });
      if (onProgress) onProgress(100, language === 'ar' ? 'تم!' : 'Done!');
      
      var header = language === 'ar' 
        ? '# 📚 ملخص المستند\n*باستخدام البيانات المخزنة - ' + existingExtractedData.totalPages + ' صفحة*\n\n---\n\n'
        : '# 📚 Document Summary\n*Using cached data - ' + existingExtractedData.totalPages + ' pages*\n\n---\n\n';
      return header + summary;
    }
    
    // PRIORITY 2: Use document content directly if sufficient AND not garbage
    if (textContent && textContent.length > 200 && !isGarbageText(textContent) && !isHelpMessage(textContent)) {
      console.log('Using document content directly');
      if (onProgress) onProgress(50, language === 'ar' ? 'جاري تحليل المحتوى...' : 'Analyzing content...');
      var summary = await ApiService.summarize(textContent, { language: language || 'en' });
      if (onProgress) onProgress(100, language === 'ar' ? 'تم!' : 'Done!');
      return summary;
    }
    
    // Check if textContent is garbage - return help message
    if (textContent && (isGarbageText(textContent) || isHelpMessage(textContent))) {
      console.log('[Summary] Document content is garbage/help message');
      if (onProgress) onProgress(100, language === 'ar' ? 'غير قادر على إنشاء ملخص' : 'Unable to generate summary');
      return returnHelpMessage(language);
    }

    // No valid content available
    console.log('[Summary] No valid content found');
    if (onProgress) onProgress(100, language === 'ar' ? 'غير قادر على إنشاء ملخص' : 'Unable to generate summary');
    return returnHelpMessage(language);
    
  } catch (error: any) {
    console.error('Error generating summary:', error);
    throw new Error(error.message || 'Failed to generate summary.');
  }
};

type ModuleDraft = {
  id: string;
  title: string;
  level: number;
  pageStart?: number;
  pageEnd?: number;
  text: string;
};

const MAX_MODULE_INPUT_CHARS = 100000;

const splitTextIntoParts = (text: string, maxChars: number): string[] => {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned.split(/\n\s*\n/);
  const parts: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;
    if (para.length > maxChars) {
      // Hard split long paragraphs
      if (current) {
        parts.push(current);
        current = '';
      }
      for (let i = 0; i < para.length; i += maxChars) {
        parts.push(para.slice(i, i + maxChars));
      }
      continue;
    }
    if ((current.length + para.length + 2) > maxChars) {
      if (current) parts.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) parts.push(current);
  return parts;
};

const normalizeLine = (line: string): string => {
  return String(line || '').replace(/\s+/g, ' ').trim();
};

const normalizeForSearch = (text: string): string => {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

type TocEntry = { title: string };

const extractTocEntries = (fullText: string): { entries: TocEntry[]; tocEndIndex: number } => {
  const text = String(fullText || '');
  if (!text) return { entries: [], tocEndIndex: 0 };

  const lower = text.toLowerCase();
  const tocMarkers = [
    'table of contents',
    '\ncontents\n',
    '\ncontent\n',
    'what do you want to do',
    'chapter\npage',
    'chapter page',
  ];

  let tocStart = -1;
  for (const m of tocMarkers) {
    const idx = lower.indexOf(m.replace(/\\n/g, '\n'));
    if (idx >= 0) {
      tocStart = idx;
      break;
    }
  }
  if (tocStart < 0) return { entries: [], tocEndIndex: 0 };

  // Only scan a bounded window to avoid expensive parsing on huge documents.
  const window = text.slice(tocStart, Math.min(text.length, tocStart + 120000));
  const lines = window.split(/\r?\n/).map((l) => normalizeLine(l)).filter(Boolean);

  const entries: TocEntry[] = [];
  const seen = new Set<string>();

  const pushTitle = (title: string) => {
    const t = normalizeLine(title);
    if (t.length < 6) return;
    if (t.length > 160) return;
    if (/^(chapter|section|unit|module|part)\s*$/i.test(t)) return;
    if (/^page\s*$/i.test(t)) return;
    const key = normalizeForSearch(t);
    if (!key || seen.has(key)) return;
    seen.add(key);
    entries.push({ title: t });
  };

  // Pattern A: "Title .... 17" or "Title   17"
  for (const l of lines) {
    const m = l.match(/^(.+?)(?:\.{2,}|\s{2,}|\t+)\s*(\d{1,4})\s*$/);
    if (m) {
      const title = m[1];
      const page = Number(m[2]);
      if (Number.isFinite(page) && page >= 1) pushTitle(title);
    }
  }

  // Pattern B: "Title" then a numeric line (chapter) then a numeric line (page)
  for (let i = 0; i + 2 < lines.length; i++) {
    const title = lines[i];
    const a = lines[i + 1];
    const b = lines[i + 2];
    if (/^\d{1,4}$/.test(a) && /^\d{1,4}$/.test(b)) {
      // Avoid grabbing random number tables by requiring a TOC-ish neighborhood.
      if (lower.indexOf('chapter', tocStart) >= 0 || lower.indexOf('contents', tocStart) >= 0 || lower.indexOf('page', tocStart) >= 0) {
        pushTitle(title);
      }
    }
  }

  // Best-effort tocEndIndex: end of the scan window
  const tocEndIndex = Math.min(text.length, tocStart + window.length);
  // NOTE: Do not hard-cap aggressively; skipping TOC entries can skip sections.
  return { entries, tocEndIndex };
};

const buildModulesFromToc = (fullText: string): ModuleDraft[] => {
  const text = String(fullText || '');
  const { entries, tocEndIndex } = extractTocEntries(text);
  if (!entries || entries.length < 2) return [];

  const lower = text.toLowerCase();
  const hits: { title: string; index: number }[] = [];
  for (const e of entries) {
    const needleFull = normalizeLine(e.title).toLowerCase();
    const needle = needleFull.length > 60 ? needleFull.slice(0, 60) : needleFull;
    if (needle.length < 8) continue;
    let idx = lower.indexOf(needle, tocEndIndex);
    if (idx < 0 && needle.length >= 20) {
      idx = lower.indexOf(needle.slice(0, 20), tocEndIndex);
    }
    if (idx >= 0) hits.push({ title: e.title, index: idx });
  }

  hits.sort((a, b) => a.index - b.index);
  const filtered: { title: string; index: number }[] = [];
  let lastIndex = -1;
  for (const h of hits) {
    if (h.index <= tocEndIndex) continue;
    if (lastIndex >= 0 && (h.index - lastIndex) < 300) continue;
    filtered.push(h);
    lastIndex = h.index;
  }
  if (filtered.length < 2) return [];

  const drafts: ModuleDraft[] = [];

  // Include any preface/introduction content after the TOC before the first detected heading.
  const firstStart = filtered[0].index;
  const introSlice = text.slice(tocEndIndex, firstStart).trim();
  if (introSlice.length >= 200) {
    drafts.push({
      id: 'toc_intro',
      title: 'Introduction',
      level: 1,
      text: introSlice,
    });
  }

  for (let i = 0; i < filtered.length; i++) {
    const start = filtered[i].index;
    const end = i + 1 < filtered.length ? filtered[i + 1].index : text.length;
    const slice = text.slice(start, end).trim();
    if (slice.length < 200) continue;
    drafts.push({
      id: `toc_${i + 1}`,
      title: filtered[i].title,
      level: 1,
      text: slice,
    });
  }
  return drafts;
};

const buildModulesFromText = (fullText: string): ModuleDraft[] => {
  const text = String(fullText || '').trim();
  if (!text) return [];

  // Prefer TOC-driven modules when present.
  const tocDrafts = buildModulesFromToc(text);
  if (tocDrafts.length >= 2) return tocDrafts;

  // Heading detection line-by-line.
  const lines = text.split(/\r?\n/);
  const drafts: ModuleDraft[] = [];
  let current: ModuleDraft | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = detectHeading(line);
    if (heading) {
      if (current) {
        current.text = current.text.trim();
        if (current.text.length >= 200) drafts.push(current);
      }
      current = {
        id: `h_${drafts.length + 1}`,
        title: heading.title,
        level: heading.level,
        text: '',
      };
      continue;
    }

    if (!current) {
      current = { id: 'h_0', title: 'Introduction', level: 1, text: '' };
    }
    current.text += (current.text ? '\n' : '') + line;
  }

  if (current) {
    current.text = current.text.trim();
    if (current.text.length >= 200) drafts.push(current);
  }

  // Fallback: if still only 0/1 module, create logical topics by size (ensures we don't skip content).
  if (drafts.length <= 1) {
    const chunkSize = 25000;
    const chunks: ModuleDraft[] = [];
    let cursor = 0;
    let idx = 1;
    while (cursor < text.length) {
      let end = Math.min(text.length, cursor + chunkSize);
      const cut = text.lastIndexOf('\n', end);
      if (cut > cursor + 5000) end = cut;
      const slice = text.slice(cursor, end).trim();
      if (slice.length >= 200) {
        chunks.push({ id: `chunk_${idx}`, title: `Section ${idx}`, level: 1, text: slice });
        idx++;
      }
      cursor = end;
    }
    return chunks;
  }

  return drafts;
};

const detectHeading = (rawLine: string): { title: string; level: number } | null => {
  const line = normalizeLine(rawLine);
  if (!line) return null;
  if (line.length < 4 || line.length > 140) return null;
  if (/[.]{2,}/.test(line)) return null;
  if (line.endsWith('.')) return null;

  // Numbered headings: 1. / 1.1 / 2.3.4 Title
  const numbered = line.match(/^((\d+)(?:\.\d+){0,4})\s+[A-Za-z\p{L}].+$/u);
  if (numbered) {
    const depth = (numbered[1].match(/\./g) || []).length;
    const level = Math.min(3, 1 + depth);
    return { title: line, level };
  }

  // Keywords
  const keyword = line.match(/^(chapter|section|unit|module|part)\s+\d+[:\-.\s].+$/i);
  if (keyword) return { title: line, level: 1 };

  // ALL CAPS headings (common in extracted PDFs)
  const letters = line.replace(/[^A-Za-z\p{L}]/gu, '');
  if (letters.length >= 6) {
    const upperLetters = letters.replace(/[^A-Z\p{Lu}]/gu, '');
    const upperRatio = upperLetters.length / Math.max(1, letters.length);
    if (upperRatio > 0.85 && !/^(FIGURE|TABLE)\s+\d+/i.test(line)) {
      return { title: line, level: 1 };
    }
  }

  return null;
};

const buildModulesFromExtractedPages = (extractedData?: any): ModuleDraft[] => {
  const pages = extractedData?.pages || [];
  if (!Array.isArray(pages) || pages.length === 0) return [];

  // Prefer canonical full text if available (pages array may be incomplete).
  const fullText = String(
    extractedData?.text ||
      extractedData?.canonical?.content?.full_text ||
      extractedData?.canonical?.content?.fullText ||
      extractedData?.canonical?.content?.text ||
      pages.map((p: any) => String(p?.text || '')).join('\n\n')
  );

  // Prefer TOC-driven modules when present.
  const tocDrafts = buildModulesFromToc(fullText);
  if (tocDrafts.length >= 2) return tocDrafts;

  const drafts: ModuleDraft[] = [];
  let current: ModuleDraft | null = null;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageNum = page?.pageNumber || page?.pageNum || pageIndex + 1;
    const text = String(page?.text || '');
    const lines = text.split(/\r?\n/);

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const heading = detectHeading(line);
      if (heading) {
        if (current) {
          current.pageEnd = pageNum;
          current.text = current.text.trim();
          if (current.text.length > 50) drafts.push(current);
        }
        current = {
          id: `m_${drafts.length + 1}`,
          title: heading.title,
          level: heading.level,
          pageStart: pageNum,
          pageEnd: pageNum,
          text: '',
        };
        continue;
      }

      if (!current) {
        current = {
          id: 'm_0',
          title: 'Introduction',
          level: 1,
          pageStart: pageNum,
          pageEnd: pageNum,
          text: '',
        };
      }

      current.pageEnd = pageNum;
      current.text += (current.text ? '\n' : '') + line;
    }
  }

  if (current) {
    current.text = current.text.trim();
    if (current.text.length > 50) drafts.push(current);
  }

  // Fallback: if heading detection produced only 0/1 module, split by page ranges
  if (drafts.length <= 1) {
    // If we effectively have one giant page (common for extracted PDFs), chunk by size.
    if (pages.length === 1 && fullText.trim().length > 20000) {
      const chunkSize = 25000;
      const chunks: ModuleDraft[] = [];
      const text = fullText.trim();
      let cursor = 0;
      let idx = 1;
      while (cursor < text.length) {
        let end = Math.min(text.length, cursor + chunkSize);
        // Try to cut at a newline boundary for readability.
        const nextNewline = text.lastIndexOf('\n', end);
        if (nextNewline > cursor + 5000) end = nextNewline;
        const slice = text.slice(cursor, end).trim();
        if (slice.length >= 200) {
          chunks.push({
            id: `chunk_${idx}`,
            title: `Module ${idx}`,
            level: 1,
            pageStart: pages[0]?.pageNumber || 1,
            pageEnd: pages[0]?.pageNumber || 1,
            text: slice,
          });
          idx++;
        }
        cursor = end;
      }
      if (chunks.length >= 2) return chunks;
    }

    const perModulePages = 10;
    const fallback: ModuleDraft[] = [];
    for (let i = 0; i < pages.length; i += perModulePages) {
      const slice = pages.slice(i, i + perModulePages);
      const pageStart = slice[0]?.pageNumber || (i + 1);
      const pageEnd = slice[slice.length - 1]?.pageNumber || (i + slice.length);
      const combined = slice.map((p: any) => String(p?.text || '')).join('\n\n');
      if (combined.trim().length < 50) continue;
      fallback.push({
        id: `p_${Math.floor(i / perModulePages) + 1}`,
        title: `Pages ${pageStart}-${pageEnd}`,
        level: 1,
        pageStart,
        pageEnd,
        text: combined,
      });
    }
    return fallback;
  }

  return drafts;
};

export var generateSummaryModules = async function(
  content: string,
  chunks?: string[],
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string,
  existingPdfUrl?: string,
  existingExtractedData?: any,
  language?: 'en' | 'ar',
  documentId?: string
): Promise<DocumentPagedSummary> {
  // Back-compat wrapper: generate outline first, then generate every page module.
  const outline = await generateSummaryOutline(
    content,
    chunks,
    onProgress,
    fileUri,
    fileType,
    existingPdfUrl,
    existingExtractedData,
    language,
    documentId
  );

  const modules: PagedModule[] = [];
  for (let i = 0; i < outline.modules.length; i++) {
    const pct = 10 + Math.round((i / Math.max(1, outline.modules.length)) * 85);
    onProgress?.(pct, language === 'ar' ? `تلخيص القسم ${i + 1}/${outline.modules.length}` : `Summarizing module ${i + 1}/${outline.modules.length}`);
    const mod = await generateModuleForPage(
      i,
      content,
      chunks,
      undefined,
      fileUri,
      fileType,
      existingPdfUrl,
      existingExtractedData,
      language,
      documentId
    );
    modules.push(mod);
  }

  const paged: DocumentPagedSummary = {
    documentId: outline.documentId,
    totalPages: modules.length,
    modules,
  };
  onProgress?.(100, language === 'ar' ? 'تم!' : 'Done!');
  return paged;
};

type DraftCacheEntry = {
  fingerprint: string;
  drafts: ModuleDraft[];
};

const draftCache = new Map<string, DraftCacheEntry>();

const fingerprintText = (text: string): string => {
  const t = String(text || '');
  const head = t.slice(0, 200);
  const tail = t.slice(Math.max(0, t.length - 200));
  return `${t.length}:${head}:${tail}`;
};

const getDraftsCached = (
  baseDocId: string,
  fullText: string,
  extractedData?: any
): ModuleDraft[] => {
  const fp = fingerprintText(fullText);
  const cached = draftCache.get(baseDocId);
  if (cached && cached.fingerprint === fp && Array.isArray(cached.drafts) && cached.drafts.length > 0) {
    return cached.drafts;
  }

  let drafts: ModuleDraft[] = [];
  if (extractedData?.pages && Array.isArray(extractedData.pages) && extractedData.pages.length > 0) {
    drafts = buildModulesFromExtractedPages(extractedData);
  }
  if (!drafts || drafts.length === 0) {
    drafts = buildModulesFromText(fullText);
  }
  if (!drafts || drafts.length === 0) {
    drafts = [{ id: 'single', title: 'Document', level: 1, text: fullText }];
  }

  draftCache.set(baseDocId, { fingerprint: fp, drafts });
  return drafts;

};

export var generateSummaryOutline = async function(
  content: string,
  chunks?: string[],
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string,
  existingPdfUrl?: string,
  existingExtractedData?: any,
  language?: 'en' | 'ar',
  documentId?: string
): Promise<DocumentPagedSummary> {
  onProgress?.(5, language === 'ar' ? 'استخراج هيكل سريع...' : 'Extracting structure...');

  const extractTocItems = (text: string): string[] => {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();

    const push = (raw: string) => {
      const cleaned = raw
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-•]\s+/, '')
        .replace(/^\d+[\.)]\s+/, '')
        .trim();
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(cleaned.length > 90 ? cleaned.slice(0, 90).trim() + '…' : cleaned);
    };

    for (const l of lines) {
      if (out.length >= 5) break;
      if (l.length < 4) continue;
      if (l.length > 120) continue;

      const looksLikeHeading = /^#{1,6}\s+/.test(l);
      const looksLikeBullet = /^[-•]\s+/.test(l);
      const looksLikeNumbered = /^\d+[\.)]\s+/.test(l);
      const looksLikeAllCaps = /^[A-Z][A-Z0-9 \-]{6,}$/.test(l);

      if (looksLikeHeading || looksLikeBullet || looksLikeNumbered || looksLikeAllCaps) {
        push(l);
      }
    }

    if (out.length === 0) {
      // Fallback: first sentence-ish snippet
      const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (snippet) out.push(snippet.length > 90 ? snippet.slice(0, 90).trim() + '…' : snippet);
    }

    return out;
  };

  const baseDocId = String(documentId || fileUri || 'unknown');
  const fullText = getDocumentContent(content, chunks, existingExtractedData);
  const drafts = getDraftsCached(baseDocId, fullText, existingExtractedData);

  onProgress?.(12, language === 'ar' ? `تم العثور على ${drafts.length} قسم` : `Detected ${drafts.length} modules`);

  const pending: PagedModuleContent = {
    executiveSummary: [],
    textBlocks: ['__PENDING__'],
    imageDataUrl: undefined,
    tables: [],
    diagrams: [],
    equations: [],
    visuals: [],
  };

  const modules: PagedModule[] = drafts.map((d, i) => ({
    page: i + 1,
    moduleId: String(d.id || `m_${i + 1}`),
    title: String(d.title || `Section ${i + 1}`),
    toc: extractTocItems(d.text),
    confidence: 'LOW',
    content: pending,
  }));

  const paged: DocumentPagedSummary = {
    documentId: baseDocId,
    totalPages: modules.length,
    modules,
  };

  onProgress?.(20, language === 'ar' ? 'جاهز. اسحب لتوليد الأقسام عند الطلب.' : 'Ready. Swipe to generate pages on demand.');
  return paged;
};

export var generateModuleForPage = async function(
  pageIndex: number,
  content: string,
  chunks?: string[],
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string,
  existingPdfUrl?: string,
  existingExtractedData?: any,
  language?: 'en' | 'ar',
  documentId?: string
): Promise<PagedModule> {
  const baseDocId = String(documentId || fileUri || 'unknown');
  const fullText = getDocumentContent(content, chunks, existingExtractedData);
  const drafts = getDraftsCached(baseDocId, fullText, existingExtractedData);

  const idx = Math.max(0, Math.min(pageIndex, drafts.length - 1));
  const d = drafts[idx];

  const extractTocItems = (text: string): string[] => {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();

    const push = (raw: string) => {
      const cleaned = raw
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-•]\s+/, '')
        .replace(/^\d+[\.)]\s+/, '')
        .trim();
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(cleaned.length > 90 ? cleaned.slice(0, 90).trim() + '…' : cleaned);
    };

    for (const l of lines) {
      if (out.length >= 5) break;
      if (l.length < 4) continue;
      if (l.length > 120) continue;

      const looksLikeHeading = /^#{1,6}\s+/.test(l);
      const looksLikeBullet = /^[-•]\s+/.test(l);
      const looksLikeNumbered = /^\d+[\.)]\s+/.test(l);
      const looksLikeAllCaps = /^[A-Z][A-Z0-9 \-]{6,}$/.test(l);

      if (looksLikeHeading || looksLikeBullet || looksLikeNumbered || looksLikeAllCaps) {
        push(l);
      }
    }

    if (out.length === 0) {
      const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (snippet) out.push(snippet.length > 90 ? snippet.slice(0, 90).trim() + '…' : snippet);
    }

    return out;
  };

  const mergeContent = (a: PagedModuleContent, b: PagedModuleContent): PagedModuleContent => {
    const uniq = (arr: string[]) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const s of arr) {
        const key = String(s || '').trim();
        if (!key) continue;
        const norm = key.toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        out.push(key);
      }
      return out;
    };
    return {
      executiveSummary: uniq([...(a.executiveSummary || []), ...(b.executiveSummary || [])]),
      textBlocks: uniq([...(a.textBlocks || []), ...(b.textBlocks || [])]),
      tables: [...(a.tables || []), ...(b.tables || [])],
      diagrams: [...(a.diagrams || []), ...(b.diagrams || [])],
      equations: uniq([...(a.equations || []), ...(b.equations || [])]),
      visuals: uniq([...(a.visuals || []), ...(b.visuals || [])]),
    };
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const parts = splitTextIntoParts(d.text, MAX_MODULE_INPUT_CHARS);
  const totalParts = Math.max(1, parts.length);
  let combined: any | null = null;

  for (let pi = 0; pi < totalParts; pi++) {
    const pct = Math.round(((pi + 1) / totalParts) * 100);
    onProgress?.(pct, language === 'ar' ? `تلخيص هذا القسم... (${pi + 1}/${totalParts})` : `Summarizing this page... (${pi + 1}/${totalParts})`);

    const partText = parts[pi];
    const partTitle = totalParts > 1 ? `${d.title} (Part ${pi + 1}/${totalParts})` : d.title;

    let partModule: any = null;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        partModule = await summarizeModuleFn(partText, {
          title: partTitle,
          source: { pageStart: d.pageStart, pageEnd: d.pageEnd, inputChars: partText.length },
          language: language || 'en',
        });
        break;
      } catch (err: any) {
        lastErr = err;
        await sleep(600 * attempt);
      }
    }

    if (!partModule) {
      partModule = {
        moduleId: d.id,
        title: d.title,
        confidence: 'LOW',
        content: { executiveSummary: [], textBlocks: [], tables: [], diagrams: [], equations: [], visuals: [] },
      };
      console.warn('[PagedSummary] On-demand summarize failed; continuing', { title: partTitle, err: lastErr?.message || lastErr });
    }

    if (!combined) {
      combined = partModule;
    } else {
      combined.content = mergeContent(combined.content || {}, partModule?.content || {});
      const rank = (c: string) => (c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : 1);
      const a = String(combined.confidence || 'MEDIUM');
      const b = String(partModule?.confidence || 'MEDIUM');
      combined.confidence = rank(a) <= rank(b) ? a : b;
    }
  }

  const safeContent: PagedModuleContent = {
    executiveSummary: Array.isArray(combined?.content?.executiveSummary) ? combined.content.executiveSummary : [],
    textBlocks: Array.isArray(combined?.content?.textBlocks) ? combined.content.textBlocks : [],
    tables: Array.isArray(combined?.content?.tables) ? combined.content.tables : [],
    diagrams: Array.isArray(combined?.content?.diagrams) ? combined.content.diagrams : [],
    equations: Array.isArray(combined?.content?.equations) ? combined.content.equations : [],
    visuals: Array.isArray(combined?.content?.visuals) ? combined.content.visuals : [],
  };

  // Generate a simple visual for this module (best-effort; non-fatal)
  try {
    const bullets = Array.isArray(safeContent.executiveSummary) ? safeContent.executiveSummary.slice(0, 6) : [];
    if (bullets.length > 0) {
      onProgress?.(95, language === 'ar' ? 'توليد صورة لهذا القسم...' : 'Generating an image for this page...');
      const imageDataUrl = await generateModuleImageFn(
        String(combined?.title || d.title || `Section ${idx + 1}`),
        bullets,
        language || 'en'
      );
      if (imageDataUrl) {
        safeContent.imageDataUrl = imageDataUrl;
      }
    }
  } catch (err) {
    console.warn('[PagedSummary] Image generation failed; continuing without image', err);
  }

  return {
    page: idx + 1,
    moduleId: String(combined?.moduleId || d.id || `m_${idx + 1}`),
    title: String(combined?.title || d.title || `Section ${idx + 1}`),
    toc: extractTocItems(d.text),
    confidence: (combined?.confidence === 'HIGH' || combined?.confidence === 'MEDIUM' || combined?.confidence === 'LOW') ? combined.confidence : 'MEDIUM',
    content: safeContent,
  };
};

export var generateQuiz = async function(
  content: string,
  chunks?: string[],
  questionCount?: number,
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string,
  extractedData?: any,
  focusTopics?: string[]
) {
  try {
    if (onProgress) onProgress(10, 'Preparing document...');

    // Use the global helper to get content with extractedData fallback
    const textContent = getDocumentContent(content, chunks, extractedData);
    
    console.log('[Quiz] Content:', textContent.length, 'chars, valid:', isValidText(textContent));
    console.log('[Quiz] Content sample:', textContent.substring(0, 200));
    
    if (!isValidText(textContent)) {
      console.log('[Quiz] Content validation failed. Trying raw content...');
      // Last resort: try any available content
      const rawContent = content || (extractedData?.text) || (chunks?.join('\n')) || '';
      if (rawContent.length > 50) {
        console.log('[Quiz] Using raw content as fallback:', rawContent.length, 'chars');
        const questions = await ApiService.generateQuiz(rawContent, questionCount, focusTopics);
        if (onProgress) onProgress(100, 'Done!');
        return questions;
      }
      throw new Error('No valid text content available. Please ensure the document was processed correctly during upload.');
    }

    if (onProgress) onProgress(50, 'Generating quiz questions...');
    const questions = await ApiService.generateQuiz(textContent, questionCount, focusTopics);
    
    if (onProgress) onProgress(100, 'Done!');
    return questions;
    
  } catch (error: any) {
    console.error('Error generating quiz:', error);
    throw new Error(error.message || 'Failed to generate quiz.');
  }
};

export var generateStudyGuide = async function(
  content: string,
  chunks?: string[],
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string,
  extractedData?: any
): Promise<{ structured?: any; text: string; pageImages?: { pageNum: number; imageUrl: string }[] }> {
  try {
    if (onProgress) onProgress(10, 'Preparing document...');

    // Use the global helper to get content with extractedData fallback
    const textContent = getDocumentContent(content, chunks, extractedData);
    
    console.log('[StudyGuide] Content:', textContent.length, 'chars, valid:', isValidText(textContent));
    console.log('[StudyGuide] Content sample:', textContent.substring(0, 200));
    
    if (!isValidText(textContent)) {
      console.log('[StudyGuide] Content validation failed. Trying raw content...');
      // Last resort: try any available content
      const rawContent = content || (extractedData?.text) || (chunks?.join('\n')) || '';
      if (rawContent.length > 50) {
        console.log('[StudyGuide] Using raw content as fallback:', rawContent.length, 'chars');
        const guide = await ApiService.generateStudyGuide(rawContent, undefined);
        if (onProgress) onProgress(100, 'Done!');
        return { ...guide, pageImages: [] };
      }
      throw new Error('No valid text content available. Please ensure the document was processed correctly during upload.');
    }

    if (onProgress) onProgress(50, 'Creating study guide...');
    
    const guide = await ApiService.generateStudyGuide(textContent, undefined);
    
    if (onProgress) onProgress(100, 'Done!');
    return { ...guide, pageImages: [] };
    
  } catch (error: any) {
    console.error('Error generating study guide:', error);
    throw new Error(error.message || 'Failed to generate study guide.');
  }
};

export var generateVideoScript = async function(
  content: string,
  chunks?: string[],
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string
) {
  try {
    if (onProgress) onProgress(10, 'Preparing document...');

    // Use the global helper to get content
    const textContent = getDocumentContent(content, chunks);
    
    console.log('[VideoScript] Content:', textContent.length, 'chars, valid:', isValidText(textContent));
    
    if (!isValidText(textContent)) {
      throw new Error('No valid text content available. Please ensure the document was processed correctly during upload.');
    }
    
    if (onProgress) onProgress(50, 'Creating video script...');
    
    // Create pages array for text content
    const pages = [{ pageNum: 1, text: textContent }];
    const script = await ApiService.generateVideoScript(pages, { language: 'en', style: 'educational', useAnimations: true });
    
    if (onProgress) onProgress(100, 'Done!');
    return script;
    
  } catch (error: any) {
    console.error('Error generating video script:', error);
    throw new Error(error.message || 'Failed to generate video script.');
  }
};

// Re-export services for direct access if needed
export { Config, ApiService };
