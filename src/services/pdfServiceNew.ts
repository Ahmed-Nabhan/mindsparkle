// New PDF Processing Service - No external API needed!
// Uses local parsing + Supabase Storage for free PDF processing

import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import { generateId } from '../utils/helpers';

// Configuration
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max
const STORAGE_BUCKET = 'documents';

// Read file as base64
export const readFileAsBase64 = async (fileUri: string): Promise<string> => {
  console.log('Reading file as base64...');
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('File size:', Math.round(base64.length / 1024), 'KB');
  return base64;
};

// Upload PDF to Supabase Storage (free!)
export const uploadPdfToSupabase = async (
  base64: string, 
  fileName?: string
): Promise<string> => {
  console.log('Uploading PDF to Supabase Storage...');
  
  try {
    // Convert base64 to blob
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const uniqueFileName = `${generateId()}_${fileName || 'document'}.pdf`;
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(uniqueFileName, blob, {
        contentType: 'application/pdf',
        cacheControl: '3600',
      });
    
    if (error) {
      console.log('Supabase upload error:', error.message);
      // If bucket doesn't exist, we'll use local file reference
      throw error;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(data.path);
    
    console.log('Uploaded to Supabase:', urlData.publicUrl);
    return urlData.publicUrl;
    
  } catch (error: any) {
    console.log('Supabase storage not available, using local reference');
    // Return local file path if storage fails
    return `local:${base64.substring(0, 50)}...`;
  }
};

// Extract text from PDF using expo-file-system text extraction
// This is a basic parser - extracts plain text from PDF
export const extractTextFromPdf = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<{ text: string; pages: { pageNum: number; text: string }[] }> => {
  console.log('Extracting text from PDF locally...');
  
  if (onProgress) onProgress(10, 'Reading PDF file...');
  
  try {
    // Read the PDF file as text (this works for text-based PDFs)
    const base64Content = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    if (onProgress) onProgress(30, 'Parsing PDF content...');
    
    // Decode base64 and extract readable text
    const binaryString = atob(base64Content);
    let extractedText = '';
    let inTextBlock = false;
    let currentText = '';
    
    // Simple PDF text extraction - look for text streams
    for (let i = 0; i < binaryString.length - 2; i++) {
      const char = binaryString[i];
      const code = binaryString.charCodeAt(i);
      
      // Look for BT (Begin Text) and ET (End Text) markers
      if (binaryString.substring(i, i + 2) === 'BT') {
        inTextBlock = true;
        continue;
      }
      if (binaryString.substring(i, i + 2) === 'ET') {
        inTextBlock = false;
        if (currentText.trim()) {
          extractedText += currentText + '\n';
          currentText = '';
        }
        continue;
      }
      
      // Extract printable characters
      if (code >= 32 && code <= 126) {
        // Check for text operators like Tj, TJ, etc.
        if (inTextBlock || (i > 0 && binaryString.substring(i-1, i+2).match(/\([\x20-\x7E]+\)/))) {
          currentText += char;
        }
      }
    }
    
    // Also extract strings in parentheses (PDF text notation)
    // Avoid running a global regex on the whole binary string (can OOM on large files).
    // Instead scan iteratively and collect up to a safe limit.
    const MAX_MATCHES = 5000;
    const MAX_TOTAL_LENGTH = 200000; // characters
    let matchesFound = 0;
    let totalLen = 0;
    let additionalParts: string[] = [];
    for (let i = 0; i < binaryString.length; i++) {
      if (binaryString[i] === '(') {
        let j = i + 1;
        while (j < binaryString.length && binaryString[j] !== ')') j++;
        if (j < binaryString.length && binaryString[j] === ')') {
          const part = binaryString.substring(i + 1, j);
          if (part.length > 2 && /[a-zA-Z]/.test(part)) {
            additionalParts.push(part);
            totalLen += part.length;
            matchesFound++;
            if (matchesFound >= MAX_MATCHES || totalLen >= MAX_TOTAL_LENGTH) break;
          }
        }
        i = j;
      }
    }
    const additionalText = additionalParts.join(' ');
    extractedText += '\n' + additionalText;
    
    // Clean up the extracted text
    extractedText = extractedText
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, ' ')
      .trim();
    
    if (onProgress) onProgress(60, 'Organizing content...');
    
    // Split into pages (roughly every 3000 characters)
    const pages: { pageNum: number; text: string }[] = [];
    const chunks = extractedText.match(/.{1,3000}/g) || [extractedText];
    
    chunks.forEach((chunk, index) => {
      if (chunk.trim().length > 50) {
        pages.push({
          pageNum: index + 1,
          text: `=== PAGE ${index + 1} ===\n${chunk.trim()}`,
        });
      }
    });
    
    if (onProgress) onProgress(80, `Extracted ${pages.length} pages`);
    
    // If we couldn't extract much text, return a message
    if (extractedText.length < 100) {
      console.log('Limited text extraction - PDF may be image-based');
      return {
        text: 'This PDF appears to be image-based or scanned. Limited text could be extracted.',
        pages: [{ pageNum: 1, text: 'Image-based PDF - please ensure your PDF contains selectable text.' }],
      };
    }
    
    console.log('Extracted', extractedText.length, 'characters from PDF');
    
    return {
      text: pages.map(p => p.text).join('\n\n'),
      pages,
    };
    
  } catch (error: any) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF: ' + error.message);
  }
};

// Process document - main entry point
export const processDocument = async (
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<{
  pdfUrl: string;
  pageCount: number;
  pages: { pageNum: number; text: string; imageUrl?: string }[];
  fullText: string;
}> => {
  console.log('Processing document locally...');
  
  if (onProgress) onProgress(5, 'Starting document processing...');
  
  // Extract text locally
  const textResult = await extractTextFromPdf(fileUri, onProgress);
  
  if (onProgress) onProgress(70, 'Uploading to cloud...');
  
  // Try to upload to Supabase storage
  let pdfUrl = fileUri;
  try {
    const base64 = await readFileAsBase64(fileUri);
    pdfUrl = await uploadPdfToSupabase(base64);
  } catch (error) {
    console.log('Cloud upload skipped, using local reference');
    pdfUrl = fileUri;
  }
  
  if (onProgress) onProgress(90, 'Finalizing...');
  
  return {
    pdfUrl,
    pageCount: textResult.pages.length,
    pages: textResult.pages.map(p => ({
      pageNum: p.pageNum,
      text: p.text,
      imageUrl: undefined, // No image extraction without external API
    })),
    fullText: textResult.text,
  };
};

// Alias for compatibility
export const uploadPdf = uploadPdfToSupabase;
export const getPdfInfo = async (pdfUrl: string) => ({ pageCount: 1 });
export const extractAllText = extractTextFromPdf;
export const extractTextWithPages = extractTextFromPdf;
export const extractTextBulk = extractTextFromPdf;
export const extractPageImages = async () => [];

export default {
  readFileAsBase64,
  uploadPdf: uploadPdfToSupabase,
  getPdfInfo,
  extractAllText: extractTextFromPdf,
  extractTextWithPages: extractTextFromPdf,
  extractTextBulk: extractTextFromPdf,
  extractPageImages: async () => [],
  processDocument,
};
