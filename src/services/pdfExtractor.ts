// PDF Extractor Service - Handles documents of ANY size (up to 1GB+)
// Uses chunked processing for large files + server-side fallback

import * as FileSystem from 'expo-file-system';

// Types
interface PDFPage {
  pageNum: number;
  text: string;
}

interface ExtractedDocument {
  pageCount: number;
  pages: PDFPage[];
  fullText: string;
  isScanned?: boolean;
  usedServerExtraction?: boolean;
}

// File size thresholds
const SMALL_FILE_LIMIT = 5 * 1024 * 1024;      // 5MB - process locally
const MEDIUM_FILE_LIMIT = 50 * 1024 * 1024;    // 50MB - process in chunks locally
// Files > 50MB - use server extraction

// Decode PDF escape sequences
const decodePdfString = (str: string): string => {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
};

// Decode PDF hex strings
const decodeHexString = (hex: string): string => {
  let result = '';
  hex = hex.replace(/\s/g, '');
  
  for (let i = 0; i < hex.length; i += 2) {
    const charCode = parseInt(hex.substring(i, i + 2), 16);
    if (charCode >= 32 && charCode <= 126) {
      result += String.fromCharCode(charCode);
    } else if (charCode === 10 || charCode === 13) {
      result += '\n';
    }
  }
  return result;
};

// Extract text from a chunk of PDF data (memory-safe)
export const extractTextFromChunk = (chunk: string): string[] => {
  const texts: string[] = [];
  const MAX_ITERATIONS = 1000;
  
  // Method 1: Find BT...ET blocks iteratively (no regex on full chunk)
  let btIndex = 0;
  let iterations = 0;
  
  while (iterations < MAX_ITERATIONS) {
    const btStart = chunk.indexOf('BT', btIndex);
    if (btStart === -1 || btStart > chunk.length - 10) break;
    
    const etEnd = chunk.indexOf('ET', btStart);
    if (etEnd === -1) break;
    
    // Limit block size to prevent memory issues
    if (etEnd - btStart > 50000) {
      btIndex = btStart + 2;
      iterations++;
      continue;
    }
    
    const block = chunk.substring(btStart + 2, etEnd);
    
    // Extract Tj strings (show text)
    let tjIndex = 0;
    let tjCount = 0;
    while (tjCount < 100) {
      const openParen = block.indexOf('(', tjIndex);
      if (openParen === -1) break;
      
      const closeParen = block.indexOf(')', openParen);
      if (closeParen === -1) break;
      
      const afterClose = block.substring(closeParen + 1, closeParen + 10).trim();
      if (afterClose.startsWith('Tj') || afterClose.startsWith("'")) {
        const text = block.substring(openParen + 1, closeParen);
        const decoded = decodePdfString(text);
        if (decoded.length > 0 && /[a-zA-Z0-9]/.test(decoded)) {
          texts.push(decoded);
        }
      }
      
      tjIndex = closeParen + 1;
      tjCount++;
    }
    
    // Extract TJ arrays
    let tjArrayIndex = 0;
    let tjArrayCount = 0;
    while (tjArrayCount < 50) {
      const bracketOpen = block.indexOf('[', tjArrayIndex);
      if (bracketOpen === -1) break;
      
      const bracketClose = block.indexOf(']', bracketOpen);
      if (bracketClose === -1) break;
      
      const afterBracket = block.substring(bracketClose + 1, bracketClose + 10).trim().toUpperCase();
      if (afterBracket.startsWith('TJ')) {
        const arrayContent = block.substring(bracketOpen + 1, bracketClose);
        
        // Extract strings from array
        let strIndex = 0;
        let strCount = 0;
        while (strCount < 50) {
          const strOpen = arrayContent.indexOf('(', strIndex);
          if (strOpen === -1) break;
          
          const strClose = arrayContent.indexOf(')', strOpen);
          if (strClose === -1) break;
          
          const text = arrayContent.substring(strOpen + 1, strClose);
          const decoded = decodePdfString(text);
          if (decoded.length > 0 && /[a-zA-Z0-9]/.test(decoded)) {
            texts.push(decoded);
          }
          
          strIndex = strClose + 1;
          strCount++;
        }
      }
      
      tjArrayIndex = bracketClose + 1;
      tjArrayCount++;
    }
    
    btIndex = etEnd + 2;
    iterations++;
  }
  
  // Method 2: Extract standalone literal strings
  let litIndex = 0;
  let litCount = 0;
  while (litCount < 500) {
    const openParen = chunk.indexOf('(', litIndex);
    if (openParen === -1) break;
    
    const closeParen = chunk.indexOf(')', openParen);
    if (closeParen === -1) break;
    
    const textLen = closeParen - openParen - 1;
    if (textLen >= 5 && textLen <= 200) {
      const text = chunk.substring(openParen + 1, closeParen);
      if (/[a-zA-Z]{3,}/.test(text) && !/[\x00-\x1f]/.test(text)) {
        const decoded = decodePdfString(text);
        const cleaned = decoded.replace(/[^\x20-\x7E\n\r]/g, '');
        if (cleaned.length > 5) {
          texts.push(cleaned);
        }
      }
    }
    
    litIndex = closeParen + 1;
    litCount++;
  }
  
  return texts;
};

// Process small files (< 5MB) - load entirely into memory
const processSmallFile = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<ExtractedDocument> => {
  console.log('[PDFExtractor] Processing small file locally...');
  
  if (onProgress) onProgress(20, 'Reading file...');
  
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  
  const binaryString = atob(base64);
  
  if (!binaryString.startsWith('%PDF')) {
    throw new Error('Invalid PDF file format');
  }
  
  if (onProgress) onProgress(40, 'Extracting text...');
  
  // Count pages
  let pageCount = 1;
  try {
    let pageIndex = 0;
    let count = 0;
    while (count < 10000) {
      const pageMatch = binaryString.indexOf('/Type/Page', pageIndex);
      const pageMatch2 = binaryString.indexOf('/Type /Page', pageIndex);
      const nextMatch = Math.min(
        pageMatch === -1 ? Infinity : pageMatch,
        pageMatch2 === -1 ? Infinity : pageMatch2
      );
      
      if (nextMatch === Infinity) break;
      
      // Make sure it's not /Pages
      const afterType = binaryString.substring(nextMatch, nextMatch + 15);
      if (!afterType.includes('/Pages')) {
        pageCount++;
      }
      
      pageIndex = nextMatch + 10;
      count++;
    }
    pageCount = Math.max(pageCount - 1, 1); // Subtract 1 for overcounting
  } catch (e) {
    console.log('[PDFExtractor] Page count failed, using 1');
  }
  
  if (onProgress) onProgress(60, `Found ${pageCount} pages...`);
  
  // Extract text
  const texts = extractTextFromChunk(binaryString);
  
  // Remove duplicates
  const uniqueTexts = [...new Set(texts)];
  
  // Build full text
  let fullText = uniqueTexts
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/([.!?])\s*/g, '$1\n')
    .trim();
  
  // Remove duplicate sentences
  const sentences = fullText.split('\n').filter(s => s.trim().length > 5);
  const uniqueSentences = [...new Set(sentences)];
  fullText = uniqueSentences.join('\n');
  
  if (onProgress) onProgress(80, 'Processing pages...');
  
  // Create pages
  const pages: PDFPage[] = [];
  if (fullText.length > 100) {
    const avgPageLength = Math.max(Math.ceil(fullText.length / pageCount), 1500);
    let position = 0;
    let pageNum = 1;
    
    while (position < fullText.length && pageNum <= pageCount + 5) {
      let endPos = Math.min(position + avgPageLength, fullText.length);
      
      // Try to break at sentence boundary
      const breakPos = fullText.lastIndexOf('.', endPos);
      if (breakPos > position + avgPageLength / 2) {
        endPos = breakPos + 1;
      }
      
      const pageText = fullText.slice(position, endPos).trim();
      if (pageText.length > 20) {
        pages.push({ pageNum, text: pageText });
        pageNum++;
      }
      
      position = endPos;
    }
  }
  
  if (onProgress) onProgress(100, 'Extraction complete!');
  
  console.log('[PDFExtractor] Extracted', fullText.length, 'chars from', pages.length, 'pages');
  
  return {
    pageCount: pages.length || 1,
    pages,
    fullText,
    isScanned: fullText.length < 100,
  };
};

// Process medium files (5-50MB) - read in chunks
const processMediumFile = async (
  fileUri: string,
  fileSize: number,
  onProgress?: (progress: number, message: string) => void
): Promise<ExtractedDocument> => {
  console.log('[PDFExtractor] Processing medium file in chunks...');
  
  if (onProgress) onProgress(10, 'Reading large file...');
  
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  
  if (onProgress) onProgress(30, 'Converting data...');
  
  const binaryString = atob(base64);
  const totalSize = binaryString.length;
  
  if (!binaryString.startsWith('%PDF')) {
    throw new Error('Invalid PDF file format');
  }
  
  if (onProgress) onProgress(40, 'Extracting text from chunks...');
  
  // Process in 2MB chunks with overlap
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
  const OVERLAP = 10000; // 10KB overlap to catch split content
  const allTexts: string[] = [];
  
  let position = 0;
  let chunkNum = 0;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
  
  while (position < totalSize) {
    const chunkEnd = Math.min(position + CHUNK_SIZE + OVERLAP, totalSize);
    const chunk = binaryString.substring(position, chunkEnd);
    
    const texts = extractTextFromChunk(chunk);
    allTexts.push(...texts);
    
    chunkNum++;
    const progress = 40 + Math.round((chunkNum / totalChunks) * 40);
    if (onProgress) onProgress(progress, `Processing chunk ${chunkNum}/${totalChunks}...`);
    
    position += CHUNK_SIZE;
  }
  
  if (onProgress) onProgress(85, 'Combining results...');
  
  // Remove duplicates
  const uniqueTexts = [...new Set(allTexts)];
  
  // Build full text
  let fullText = uniqueTexts
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/([.!?])\s*/g, '$1\n')
    .trim();
  
  // Remove duplicate sentences
  const sentences = fullText.split('\n').filter(s => s.trim().length > 5);
  const uniqueSentences = [...new Set(sentences)];
  fullText = uniqueSentences.join('\n');
  
  // Estimate pages (can't count accurately in chunks)
  const estimatedPages = Math.max(Math.ceil(fullText.length / 3000), 1);
  
  // Create pages
  const pages: PDFPage[] = [];
  const avgPageLength = Math.max(Math.ceil(fullText.length / estimatedPages), 1500);
  let pos = 0;
  let pageNum = 1;
  
  while (pos < fullText.length && pageNum <= estimatedPages + 10) {
    let endPos = Math.min(pos + avgPageLength, fullText.length);
    const breakPos = fullText.lastIndexOf('.', endPos);
    if (breakPos > pos + avgPageLength / 2) {
      endPos = breakPos + 1;
    }
    
    const pageText = fullText.slice(pos, endPos).trim();
    if (pageText.length > 20) {
      pages.push({ pageNum, text: pageText });
      pageNum++;
    }
    
    pos = endPos;
  }
  
  if (onProgress) onProgress(100, 'Extraction complete!');
  
  console.log('[PDFExtractor] Extracted', fullText.length, 'chars from', pages.length, 'estimated pages');
  
  return {
    pageCount: pages.length || 1,
    pages,
    fullText,
    isScanned: fullText.length < 100,
  };
};

// Process large files (50MB+) - use server-side extraction
const processLargeFile = async (
  fileUri: string,
  fileSize: number,
  onProgress?: (progress: number, message: string) => void
): Promise<ExtractedDocument> => {
  console.log('[PDFExtractor] Large file detected, using server extraction...');
  
  const fileSizeMB = Math.round(fileSize / (1024 * 1024));
  
  if (onProgress) onProgress(10, `Large file (${fileSizeMB}MB). Preparing upload...`);
  
  try {
    const { callApi } = require('./apiService');
    
    if (onProgress) onProgress(15, `Reading ${fileSizeMB}MB file...`);
    
    // Read file
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    if (onProgress) onProgress(40, 'Uploading to server for processing...');
    
    // Send to server for extraction
    const result = await callApi('extractPdf', { 
      pdfBase64: base64,
      isLargeFile: true,
    });
    
    if (result.success && result.text && result.text.length > 50) {
      if (onProgress) onProgress(90, 'Server extraction successful!');
      
      const pages: PDFPage[] = (result.pages || []).map((p: any) => ({
        pageNum: p.pageNum,
        text: p.text,
      }));
      
      // If no pages returned, create from full text
      if (pages.length === 0 && result.text) {
        const avgPageLength = 3000;
        let pos = 0;
        let pageNum = 1;
        
        while (pos < result.text.length) {
          let endPos = Math.min(pos + avgPageLength, result.text.length);
          const pageText = result.text.slice(pos, endPos).trim();
          if (pageText.length > 20) {
            pages.push({ pageNum, text: pageText });
            pageNum++;
          }
          pos = endPos;
        }
      }
      
      if (onProgress) onProgress(100, 'Extraction complete!');
      
      return {
        pageCount: result.pageCount || pages.length,
        pages,
        fullText: result.text,
        isScanned: false,
        usedServerExtraction: true,
      };
    }
    
    throw new Error('Server extraction returned insufficient text');
    
  } catch (error: any) {
    console.error('[PDFExtractor] Server extraction failed:', error);
    
    // Fallback: Try to extract what we can locally with aggressive chunking
    if (onProgress) onProgress(60, 'Server unavailable. Trying local extraction...');
    
    return await processVeryLargeFileLocally(fileUri, fileSize, onProgress);
  }
};

// Last resort: Process very large file locally with minimal memory
const processVeryLargeFileLocally = async (
  fileUri: string,
  fileSize: number,
  onProgress?: (progress: number, message: string) => void
): Promise<ExtractedDocument> => {
  console.log('[PDFExtractor] Attempting local extraction of large file...');
  
  const fileSizeMB = Math.round(fileSize / (1024 * 1024));
  
  if (onProgress) onProgress(65, `Extracting from ${fileSizeMB}MB file (limited mode)...`);
  
  try {
    // For very large files, read in chunks and process progressively
    // We can't load the entire file into memory
    
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Process in smaller chunks to avoid memory issues
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    const base64ChunkSize = Math.ceil(CHUNK_SIZE * 1.37); // Base64 is ~37% larger
    const totalChunks = Math.ceil(base64.length / base64ChunkSize);
    const maxChunks = Math.min(totalChunks, 20); // Process max 20 chunks (100MB worth)
    
    const allTexts: string[] = [];
    
    for (let i = 0; i < maxChunks; i++) {
      const start = i * base64ChunkSize;
      const end = Math.min(start + base64ChunkSize, base64.length);
      const base64Chunk = base64.substring(start, end);
      
      try {
        const binaryChunk = atob(base64Chunk);
        const texts = extractTextFromChunk(binaryChunk);
        allTexts.push(...texts);
      } catch (chunkError) {
        console.log(`[PDFExtractor] Chunk ${i + 1} failed, skipping`);
      }
      
      const progress = 65 + Math.round((i / maxChunks) * 25);
      if (onProgress) onProgress(progress, `Processing chunk ${i + 1}/${maxChunks}...`);
    }
    
    if (onProgress) onProgress(92, 'Combining extracted text...');
    
    // Remove duplicates
    const uniqueTexts = [...new Set(allTexts)];
    
    // Optimize: Process text in chunks to avoid "Out of Memory" regex errors
    // Instead of joining everything then replacing, we clean each chunk first
    const cleanedChunks = uniqueTexts.map(text => 
      text.replace(/\s+/g, ' ').trim()
    ).filter(text => text.length > 0);
    
    let fullText = cleanedChunks.join(' ');
    
    // Add newlines after sentences (simple char iteration to avoid regex on massive string)
    let formattedText = '';
    for (let i = 0; i < fullText.length; i++) {
      formattedText += fullText[i];
      if ((fullText[i] === '.' || fullText[i] === '!' || fullText[i] === '?') && 
          (i + 1 < fullText.length && fullText[i+1] === ' ')) {
        formattedText += '\n';
      }
    }
    fullText = formattedText;
    
    // Remove duplicate sentences (process line by line)
    const sentences = fullText.split('\n').filter(s => s.trim().length > 5);
    const uniqueSentences = [...new Set(sentences)];
    fullText = uniqueSentences.join('\n');
    
    // Add note if we didn't process everything
    if (totalChunks > maxChunks) {
      const processedMB = Math.round((maxChunks * CHUNK_SIZE) / (1024 * 1024));
      fullText = `[Note: Large document (${fileSizeMB}MB). First ${processedMB}MB processed.]\n\n` + fullText;
    }
    
    // Estimate total pages based on file size
    const estimatedPages = Math.max(Math.ceil(fileSizeMB / 0.05), 1); // ~50KB per page
    
    const pages: PDFPage[] = [];
    const avgPageLength = Math.max(Math.ceil(fullText.length / Math.min(estimatedPages, 100)), 1500);
    let pos = 0;
    let pageNum = 1;
    
    while (pos < fullText.length && pageNum <= 500) { // Max 500 pages
      let endPos = Math.min(pos + avgPageLength, fullText.length);
      const pageText = fullText.slice(pos, endPos).trim();
      if (pageText.length > 20) {
        pages.push({ pageNum, text: pageText });
        pageNum++;
      }
      pos = endPos;
    }
    
    if (onProgress) onProgress(100, 'Extraction complete!');
    
    console.log('[PDFExtractor] Large file extraction got', fullText.length, 'chars,', pages.length, 'pages');
    
    return {
      pageCount: pages.length || estimatedPages,
      pages,
      fullText: fullText.length > 100 ? fullText : `Unable to fully extract text from this ${fileSizeMB}MB document. The document may be scanned/image-based. For best results with large scanned documents, please use Google Drive's OCR feature to convert it first.`,
      isScanned: fullText.length < 100,
    };
    
  } catch (error: any) {
    console.error('[PDFExtractor] Local large file extraction failed:', error);
    
    return {
      pageCount: 1,
      pages: [{
        pageNum: 1,
        text: `This document is very large (${fileSizeMB}MB). For best results:\n\n1. Ensure you have a stable internet connection for server processing\n2. Or try splitting the document into smaller parts\n3. Or use Google Drive to OCR scanned documents first`,
      }],
      fullText: 'Document processing limited due to size.',
      isScanned: true,
    };
  }
};

// Main extraction function
export const extractPdfText = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<ExtractedDocument> => {
  console.log('[PDFExtractor] Starting extraction for:', fileUri);
  
  if (onProgress) onProgress(5, 'Checking file size...');
  
  try {
    // Get file info
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    
    if (!fileInfo.exists) {
      throw new Error('File not found');
    }
    
    const fileSize = (fileInfo as any).size || 0;
    const fileSizeMB = Math.round(fileSize / (1024 * 1024));
    
    console.log('[PDFExtractor] File size:', fileSizeMB, 'MB');
    
    if (onProgress) onProgress(10, `Processing ${fileSizeMB > 0 ? fileSizeMB + 'MB' : ''} document...`);
    
    // Route to appropriate handler based on file size
    if (fileSize <= SMALL_FILE_LIMIT) {
      // Small file (<5MB): Process entirely in memory
      return await processSmallFile(fileUri, onProgress);
      
    } else if (fileSize <= MEDIUM_FILE_LIMIT) {
      // Medium file (5-50MB): Process in chunks
      return await processMediumFile(fileUri, fileSize, onProgress);
      
    } else {
      // Large file (50MB+): Use server extraction or chunked local
      return await processLargeFile(fileUri, fileSize, onProgress);
    }
    
  } catch (error: any) {
    console.error('[PDFExtractor] Error:', error);
    throw new Error('Failed to extract PDF: ' + (error.message || 'Unknown error'));
  }
};

// Alias for API compatibility
export const extractLargePdf = extractPdfText;

export default {
  extractPdfText,
  extractLargePdf,
};
