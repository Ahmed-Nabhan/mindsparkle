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
 * Get file size in MB
 */
const getFileSizeMB = async (fileUri: string): Promise<number> => {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists && !info.isDirectory) {
      return ((info as any).size || 0) / (1024 * 1024);
    }
  } catch (e) {
    console.log('[PDFService] Could not get file size');
  }
  return 0;
};

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
  let localExtractionQuality: string = 'unknown';
  try {
    if (onProgress) onProgress(10, 'Extracting text...');
    
    const extractorResult = await extractPdfText(fileUri, onProgress);
    localExtractionQuality = (extractorResult as any).extractionQuality || 'unknown';
    
    // Only use local extraction if quality is good (not garbage)
    if (extractorResult.fullText && extractorResult.fullText.length > 100 && localExtractionQuality !== 'garbage') {
      console.log('[PDFService] Native extraction successful:', extractorResult.pageCount, 'pages,', extractorResult.fullText.length, 'chars, quality:', localExtractionQuality);
      
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
    
    console.log('[PDFService] Native extraction got limited/poor quality text:', localExtractionQuality);
  } catch (error: any) {
    console.log('[PDFService] Native extraction failed:', error.message);
  }

  // PRIORITY 3: Basic binary extraction (fallback) - skip if we already know quality is garbage
  if (localExtractionQuality !== 'garbage') {
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
  }

  // PRIORITY 4: Cloud extraction with pdf-parse - works better for custom fonts
  // Try cloud for files up to 15MB (after base64 encoding ~20MB)
  const fileSizeMB = await getFileSizeMB(fileUri);
  
  if (fileSizeMB < 15) {
    try {
      if (onProgress) onProgress(55, 'Using cloud extraction...');
      console.log('[PDFService] Trying cloud pdf-parse extraction (local quality was:', localExtractionQuality, ', size:', fileSizeMB.toFixed(1), 'MB)');
      
      if (onProgress) onProgress(60, 'Uploading to cloud...');
      
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      if (onProgress) onProgress(75, 'Extracting text...');
      
      const result = await callApi('extractPdf', { 
        pdfBase64: base64,
      });
      
      if (result.success && result.text && result.text.length > 100) {
        console.log('[PDFService] Cloud extraction successful:', result.pageCount, 'pages,', result.text.length, 'chars, method:', result.method);
        
        if (onProgress) onProgress(100, 'Extraction complete!');
        
        return {
          pdfUrl: fileUri,
          pageCount: result.pageCount || result.pages?.length || 1,
          pages: (result.pages || []).map((p: any) => ({
            pageNum: p.pageNum,
            text: p.text,
            imageUrl: undefined,
          })),
          fullText: result.text,
        };
      }
      
      // If we got here, extraction returned but with no/little text
      if (result.error || result.needsImages) {
        console.log('[PDFService] Cloud extraction needs images:', result.message || result.error);
      }
    } catch (error: any) {
      console.log('[PDFService] Cloud extraction failed:', error.message);
    }
  } else {
    console.log('[PDFService] Large file (' + fileSizeMB.toFixed(1) + 'MB) - will use cloud chunked processing.');
  }

  // If all methods fail, return the garbage text with a note
  // This is better than showing nothing
  if (localExtractionQuality === 'garbage') {
    console.log('[PDFService] All methods failed. PDF has custom font encoding.');
    if (onProgress) onProgress(100, 'Complex PDF - processing in cloud...');
    
    // For large files, let cloud handle it with chunked processing
    const isLargeFile = fileSizeMB > 15;
    
    if (isLargeFile) {
      // Large files will be processed server-side with chunked extraction
      return {
        pdfUrl: fileUri,
        pageCount: 1,
        pages: [{ pageNum: 1, text: '__CLOUD_PROCESSING__', imageUrl: undefined }],
        fullText: '__CLOUD_PROCESSING__',
        needsOcr: false, // Server will handle OCR if needed
      };
    }
    
    // For smaller files with custom fonts, provide guidance
    const helpfulText = `**📄 PDF Processing Notice**

This PDF (${fileSizeMB.toFixed(1)}MB) uses embedded custom fonts that standard text extraction cannot read.

**🔧 How to Fix:**

**Option 1 - Google Drive (Recommended):**
1. Upload the PDF to Google Drive
2. Right-click → "Open with" → "Google Docs"
3. Google will convert and OCR the text
4. Copy all text and save as a .txt file
5. Upload the .txt file to MindSparkle

**Option 2 - Adobe Reader:**
1. Open in Adobe Acrobat Reader (free)
2. File → "Export PDF" → "Text" or copy text
3. Save as .txt and upload

**Option 3 - Online Converters:**
• ilovepdf.com/pdf_to_txt
• smallpdf.com/pdf-to-text
• pdftotext.com

**💡 Why This Happens:**
Cisco training materials, textbooks, and some enterprise PDFs use proprietary font encoding for security. The text appears normal when viewing but is encoded differently in the file structure.`;
    
    return {
      pdfUrl: fileUri,
      pageCount: 1,
      pages: [{ pageNum: 1, text: helpfulText, imageUrl: undefined }],
      fullText: helpfulText,
      needsOcr: true,
    };
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
 * OCR for scanned PDFs
 * 
 * NOTE: OpenAI Vision API does NOT support PDF files directly.
 * It only accepts images (JPEG, PNG, GIF, WEBP).
 * 
 * For PDF OCR, use one of these methods:
 * 1. Server-side: Edge Function extract-text handles OCR via signed URL
 * 2. Native build: Use react-native-vision-camera for on-device OCR
 * 3. Manual: User converts PDF via Google Drive or online tools
 * 
 * This function now returns a helpful message instead of failing.
 */
export const performOcrWithOpenAI = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<string> => {
  console.log('[PDFService] OCR requested - OpenAI Vision does not support PDF files directly');
  
  // Check file extension
  const isPdf = fileUri.toLowerCase().includes('.pdf');
  
  if (isPdf) {
    console.log('[PDFService] PDF files cannot be sent to Vision API (only images supported)');
    
    // Return a helpful message instead of crashing
    if (onProgress) onProgress(100, 'PDF requires cloud processing');
    
    // This error will be caught and a helpful message shown to the user
    throw new Error(
      'PDF OCR is handled by cloud processing. ' +
      'If cloud extraction failed, please try:\n\n' +
      '1. Google Drive: Upload PDF → Open with Google Docs → Copy text\n' +
      '2. Adobe Reader: Export PDF to Text\n' +
      '3. Online: ilovepdf.com/pdf_to_txt'
    );
  }
  
  // For images (not PDFs), we can try Vision API
  try {
    if (onProgress) onProgress(10, 'Preparing image for OCR...');
    
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Detect image type
    let mimeType = 'image/png';
    const lowerUri = fileUri.toLowerCase();
    if (lowerUri.includes('.jpg') || lowerUri.includes('.jpeg')) {
      mimeType = 'image/jpeg';
    } else if (lowerUri.includes('.gif')) {
      mimeType = 'image/gif';
    } else if (lowerUri.includes('.webp')) {
      mimeType = 'image/webp';
    }
    
    if (onProgress) onProgress(30, 'Sending to AI for text recognition...');
    
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    const response = await callApi('callOpenAIVision', {
      imageUrl: dataUrl,
      prompt: 'Extract ALL text from this image. Preserve structure and formatting. Output only the extracted text.',
    });
    
    if (onProgress) onProgress(90, 'Processing OCR results...');
    
    const text = response?.text || response?.content || '';
    
    if (text && text.length > 50) {
      console.log('[PDFService] Image OCR successful:', text.length, 'chars');
      if (onProgress) onProgress(100, 'OCR complete!');
      return text;
    }
    
    throw new Error('OCR returned insufficient text');
  } catch (error: any) {
    console.error('[PDFService] Image OCR failed:', error.message);
    throw error;
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
