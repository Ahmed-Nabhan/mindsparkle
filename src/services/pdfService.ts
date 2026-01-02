// PDF Processing Service - 100% FREE local extraction
// Falls back to OpenAI Vision OCR for scanned PDFs (uses your existing OpenAI credits)

import * as FileSystem from 'expo-file-system';
import { extractPdfText, extractTextFromChunk } from './pdfExtractor';
import { callApi } from './apiService';

// Types
interface PDFPage {
  pageNum: number;
  text: string;
  imageUrl?: string;
}

interface ProcessedDocument {
  pdfUrl: string;
  pageCount: number;
  pages: PDFPage[];
  fullText: string;
  needsOcr?: boolean;
}

/**
 * Read file as base64
 */

// Refactored: Avoid global regex on large strings, use iterative chunked extraction
export const basicBinaryExtraction = async (fileUri: string): Promise<ProcessedDocument> => {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binaryString = atob(base64);
  const CHUNK_SIZE = 1024 * 1024; // 1MB chunks to be safe
  const OVERLAP = 1024; 
  const totalSize = binaryString.length;
  let position = 0;
  
  const allTexts: string[] = [];
  
  while (position < totalSize) {
    const chunkEnd = Math.min(position + CHUNK_SIZE + OVERLAP, totalSize);
    const chunk = binaryString.substring(position, chunkEnd);
    
    // Use the same iterative extraction as in pdfExtractor
    const texts = extractTextFromChunk(chunk);
    
    // Clean each text fragment individually to avoid massive regex later
    const cleanedTexts = texts.map(t => t.replace(/\s+/g, ' ').trim()).filter(t => t.length > 0);
    allTexts.push(...cleanedTexts);
    
    position += CHUNK_SIZE;
  }
  
  // Remove duplicates using Set (efficient for strings)
  const uniqueTexts = [...new Set(allTexts)];
  
  // Join with spaces - no global regex on the full string needed anymore
  let extractedText = uniqueTexts.join(' ');
  
  // Simple punctuation formatting without global regex if possible, 
  // or split-process-join if needed. 
  // For now, just basic joining is much safer than the previous global replace.
  // We can do a simple split by period to format paragraphs.
  const sentences = extractedText.split('. ');
  extractedText = sentences.join('.\n');
  
  // Estimate pages
  const estimatedPages = Math.max(Math.ceil(extractedText.length / 3000), 1);
  
  // Create pages
  const pages: PDFPage[] = [];
  const avgPageLength = Math.max(Math.ceil(extractedText.length / estimatedPages), 1500);
  let pos = 0;
  let pageNum = 1;
  
  while (pos < extractedText.length && pageNum <= estimatedPages + 10) {
    let endPos = Math.min(pos + avgPageLength, extractedText.length);
    const breakPos = extractedText.lastIndexOf('.', endPos);
    
    if (breakPos > pos + avgPageLength / 2) {
      endPos = breakPos + 1;
    }
    
    const pageText = extractedText.slice(pos, endPos).trim();
    if (pageText.length > 20) {
      pages.push({ pageNum, text: pageText, imageUrl: undefined });
      pageNum++;
    }
    pos = endPos;
  }
  
  return {
    pdfUrl: fileUri,
    pageCount: pages.length || 1,
    pages,
    fullText: extractedText,
  };
};
export const readFileAsBase64 = async (fileUri: string): Promise<string> => {
  console.log('[PDFService] Reading file as base64...');
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('[PDFService] File size:', Math.round(base64.length / 1024), 'KB');
  return base64;
};

/**
 * Main document processor - 100% FREE local extraction
 */
export const processDocument = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void,
  existingPdfUrl?: string,
  existingExtractedData?: any
): Promise<ProcessedDocument> => {
  
  // PRIORITY 1: Use existing/cached data if available
  if (existingExtractedData?.pages?.length > 0) {
    console.log('[PDFService] Using cached data');
    if (onProgress) onProgress(100, 'Using cached data...');
    
    return {
      pdfUrl: existingPdfUrl || fileUri,
      pageCount: existingExtractedData.totalPages || existingExtractedData.pages.length,
      pages: existingExtractedData.pages.map((p: any) => ({
        pageNum: p.pageNumber || p.pageNum,
        text: p.text || '',
        imageUrl: p.images?.[0]?.url,
      })),
      fullText: existingExtractedData.text || existingExtractedData.pages.map((p: any) => p.text).join('\n'),
    };
  }

  console.log('[PDFService] Starting FREE local extraction...');
  if (onProgress) onProgress(5, 'Starting extraction...');

  // PRIORITY 2: Try native PdfExtractor (best local extraction)
  try {
    if (onProgress) onProgress(10, 'Extracting text...');
    
    const extractorResult = await extractPdfText(fileUri, onProgress);
    
    if (extractorResult.fullText && extractorResult.fullText.length > 100) {
      console.log('[PDFService] Native extraction successful:', extractorResult.pageCount, 'pages,', extractorResult.fullText.length, 'chars');
      
      if (onProgress) onProgress(100, 'Extraction complete!');
      
      return {
        pdfUrl: fileUri,
        pageCount: extractorResult.pageCount,
        pages: extractorResult.pages.map((p: any) => ({
          pageNum: p.pageNum,
          text: `=== PAGE ${p.pageNum} ===\n${p.text}`,
          imageUrl: undefined,
        })),
        fullText: extractorResult.fullText,
      };
    }
    
    console.log('[PDFService] Native extraction got limited text');
  } catch (error: any) {
    console.log('[PDFService] Native extraction failed:', error.message);
  }

  // PRIORITY 3: Basic binary extraction (fallback)
  try {
    if (onProgress) onProgress(50, 'Extracting text (method 2)...');
    
    const result = await basicBinaryExtraction(fileUri);
    
    if (result.fullText && result.fullText.length > 50) {
      console.log('[PDFService] Basic extraction got:', result.fullText.length, 'chars');
      
      if (onProgress) onProgress(100, 'Extraction complete!');
      return result;
    }
  } catch (error: any) {
    console.log('[PDFService] Basic extraction failed:', error.message);
  }

  // PRIORITY 4: Google Document AI (1000 pages FREE/month, then $0.001/page)
  try {
    if (onProgress) onProgress(60, 'Using Google Document AI...');
    console.log('[PDFService] Trying Google Document AI...');
    
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    const result = await callApi('extractPdf', { pdfBase64: base64 });
    
    if (result.success && result.text && result.text.length > 50) {
      console.log('[PDFService] Google Document AI successful:', result.pageCount, 'pages,', result.text.length, 'chars');
      
      if (onProgress) onProgress(100, 'Extraction complete!');
      
      return {
        pdfUrl: fileUri,
        pageCount: result.pageCount || result.pages?.length || 1,
        pages: (result.pages || []).map((p: any) => ({
          pageNum: p.pageNum,
          text: `=== PAGE ${p.pageNum} ===\n${p.text}`,
          imageUrl: undefined,
        })),
        fullText: result.text,
      };
    }
  } catch (error: any) {
    console.log('[PDFService] Google Document AI failed:', error.message);
  }

  // If all methods fail, return with flag for manual intervention
  console.log('[PDFService] All extraction methods failed');
  if (onProgress) onProgress(100, 'Extraction complete');
  return {
    pdfUrl: fileUri,
    pageCount: 1,
    pages: [{
      pageNum: 1,
      text: '__NEEDS_OCR__', // Flag for the app to try OpenAI Vision OCR
      imageUrl: undefined,
    }],
    fullText: '__NEEDS_OCR__',
    needsOcr: true, // Flag to trigger OCR in the app
  };
}
export const extractAllText = async (pdfUrl: string, pageCount: number) => {
  return { text: '', pages: [] };
};

export const extractTextWithPages = async (pdfUrl: string, pageCount: number, onProgress?: any) => {
  return [];
};

export const extractTextBulk = async (pdfUrl: string, startPage: number, endPage: number, onProgress?: any) => {
  return [];
};

export const extractPageImages = async (pdfUrl: string, pages: number[], onProgress?: any) => {
  return [];
};

/**
 * OCR for scanned PDFs using OpenAI Vision
 * This uses your existing OpenAI credits (~$0.001-0.003 per page)
 * Much cheaper than PDF.co!
 */
export const performOcrWithOpenAI = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<string> => {
  try {
    if (onProgress) onProgress(10, 'Preparing for OCR...');
    
    // Read PDF as base64
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    if (onProgress) onProgress(30, 'Sending to AI for text recognition...');
    
    // Create data URL for the image/PDF
    const dataUrl = `data:application/pdf;base64,${base64}`;
    
    // Call OpenAI Vision OCR through your Supabase function
    const response = await callApi('ocr', {
      imageUrls: [dataUrl],
    });
    
    if (onProgress) onProgress(90, 'Processing OCR results...');
    
    const text = response?.text || '';
    
    if (text && text.length > 50) {
      console.log('[PDFService] OCR successful:', text.length, 'chars');
      if (onProgress) onProgress(100, 'OCR complete!');
      return text;
    }
    
    throw new Error('OCR returned insufficient text');
  } catch (error: any) {
    console.error('[PDFService] OCR failed:', error.message);
    throw new Error('Could not read scanned PDF. Please try a text-based PDF.');
  }
};

/**
 * Check if document needs OCR and perform it if needed
 */
export const processDocumentWithOcrFallback = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<ProcessedDocument> => {
  // First try local extraction
  const result = await processDocument(fileUri, onProgress);
  
  // If local extraction failed (needs OCR), try OpenAI Vision
  if (result.fullText === '__NEEDS_OCR__' || result.needsOcr) {
    console.log('[PDFService] Local extraction failed, trying OpenAI Vision OCR...');
    
    if (onProgress) onProgress(50, 'PDF appears scanned, using AI to read...');
    
    try {
      const ocrText = await performOcrWithOpenAI(fileUri, onProgress);
      
      return {
        pdfUrl: fileUri,
        pageCount: 1,
        pages: [{ pageNum: 1, text: ocrText, imageUrl: undefined }],
        fullText: ocrText,
      };
    } catch (ocrError: any) {
      console.error('[PDFService] OCR also failed:', ocrError.message);
      
      return {
        pdfUrl: fileUri,
        pageCount: 1,
        pages: [{
          pageNum: 1,
          text: 'Could not extract text from this PDF. It may be:\n• A heavily scanned document\n• Password protected\n• Corrupted\n\nTip: Try exporting your document to a new PDF from the original source.',
          imageUrl: undefined,
        }],
        fullText: 'Could not extract text from this PDF.',
      };
    }
  }
  
  return result;
};

/**
 * OCR with Vision - wrapper for openai.ts to call
 */
export const ocrWithVision = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<ProcessedDocument> => {
  try {
    const ocrText = await performOcrWithOpenAI(fileUri, onProgress);
    
    // Split into pages if text is long enough
    const pages: PDFPage[] = [];
    const avgPageLength = 3000;
    let pos = 0;
    let pageNum = 1;
    
    while (pos < ocrText.length) {
      let endPos = Math.min(pos + avgPageLength, ocrText.length);
      // Try to break at sentence boundary
      const breakPos = ocrText.lastIndexOf('.', endPos);
      if (breakPos > pos + avgPageLength / 2) {
        endPos = breakPos + 1;
      }
      
      const pageText = ocrText.slice(pos, endPos).trim();
      if (pageText.length > 20) {
        pages.push({ pageNum, text: pageText });
        pageNum++;
      }
      pos = endPos;
    }
    
    return {
      pdfUrl: fileUri,
      pageCount: pages.length || 1,
      pages: pages.length > 0 ? pages : [{ pageNum: 1, text: ocrText }],
      fullText: ocrText,
    };
  } catch (error: any) {
    throw new Error('Vision OCR failed: ' + (error.message || 'Unknown error'));
  }
};

export default {
  readFileAsBase64,
  extractAllText,
  extractTextWithPages,
  extractTextBulk,
  extractPageImages,
  processDocument,
  processDocumentWithOcrFallback,
  performOcrWithOpenAI,
  ocrWithVision,
};
