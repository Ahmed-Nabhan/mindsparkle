// PDF Image Service - Extracts page images from PDFs
// Uses react-native-pdf-thumbnail for native PDF rendering

import * as FileSystem from 'expo-file-system';

// Types
interface PageImage {
  pageNum: number;
  uri: string;
  width?: number;
  height?: number;
}

interface ExtractionResult {
  success: boolean;
  images: PageImage[];
  error?: string;
}

// Try to import the native module (may not be available in Expo Go)
let PdfThumbnail: any = null;
try {
  PdfThumbnail = require('react-native-pdf-thumbnail').default;
} catch (e) {
  console.log('[PDFImageService] react-native-pdf-thumbnail not available');
}

/**
 * Generate thumbnail images for PDF pages
 * @param fileUri - Local file URI of the PDF
 * @param pages - Array of page numbers to extract (1-indexed), or 'all'
 * @param quality - Image quality 0-100 (default 80)
 * @param maxWidth - Maximum width of thumbnails (default 800)
 */
export const extractPdfPageImages = async (
  fileUri: string,
  pages: number[] | 'all' = 'all',
  quality: number = 80,
  maxWidth: number = 800,
  onProgress?: (progress: number, message: string) => void
): Promise<ExtractionResult> => {
  
  // Check if native module is available
  if (!PdfThumbnail) {
    console.log('[PDFImageService] Native module not available, skipping image extraction');
    return {
      success: false,
      images: [],
      error: 'PDF image extraction not available in this build',
    };
  }

  try {
    if (onProgress) onProgress(5, 'Preparing to extract images...');
    
    // Get file info
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      throw new Error('PDF file not found');
    }
    
    const fileSize = (fileInfo as any).size || 0;
    const fileSizeMB = Math.round(fileSize / (1024 * 1024));
    
    console.log('[PDFImageService] Processing PDF:', fileSizeMB, 'MB');
    
    // For very large files, limit number of pages to extract
    const maxPagesToExtract = fileSizeMB > 20 ? 10 : (fileSizeMB > 10 ? 20 : 50);
    
    if (onProgress) onProgress(10, 'Counting pages...');
    
    // Get page count first
    let pageCount = 1;
    try {
      const result = await PdfThumbnail.generate(fileUri, 0, { quality: 10 });
      // Some implementations return page count
      pageCount = result.pageCount || 1;
    } catch (e) {
      // If we can't get page count, try extracting first page
      console.log('[PDFImageService] Could not get page count, will extract incrementally');
    }
    
    if (onProgress) onProgress(15, `Found ${pageCount} pages...`);
    
    // Determine which pages to extract
    let pagesToExtract: number[] = [];
    if (pages === 'all') {
      // Extract evenly distributed pages
      const step = Math.max(1, Math.ceil(pageCount / maxPagesToExtract));
      for (let i = 0; i < pageCount && pagesToExtract.length < maxPagesToExtract; i += step) {
        pagesToExtract.push(i); // 0-indexed for the library
      }
    } else {
      pagesToExtract = pages.map(p => p - 1).slice(0, maxPagesToExtract); // Convert to 0-indexed
    }
    
    console.log('[PDFImageService] Extracting', pagesToExtract.length, 'pages');
    
    const images: PageImage[] = [];
    
    // Extract each page
    for (let i = 0; i < pagesToExtract.length; i++) {
      const pageIndex = pagesToExtract[i];
      
      try {
        if (onProgress) {
          const progress = 15 + Math.round((i / pagesToExtract.length) * 80);
          onProgress(progress, `Extracting page ${pageIndex + 1}...`);
        }
        
        const result = await PdfThumbnail.generate(fileUri, pageIndex, {
          quality,
          maxWidth,
        });
        
        if (result && result.uri) {
          images.push({
            pageNum: pageIndex + 1, // Convert back to 1-indexed
            uri: result.uri,
            width: result.width,
            height: result.height,
          });
        }
      } catch (pageError: any) {
        console.log(`[PDFImageService] Failed to extract page ${pageIndex + 1}:`, pageError.message);
        // Continue with other pages
      }
    }
    
    if (onProgress) onProgress(100, 'Image extraction complete!');
    
    console.log('[PDFImageService] Successfully extracted', images.length, 'page images');
    
    return {
      success: images.length > 0,
      images,
    };
    
  } catch (error: any) {
    console.error('[PDFImageService] Error:', error);
    return {
      success: false,
      images: [],
      error: error.message || 'Failed to extract PDF images',
    };
  }
};

/**
 * Extract first page thumbnail for document preview
 */
export const extractFirstPageThumbnail = async (
  fileUri: string,
  quality: number = 60,
  maxWidth: number = 400
): Promise<string | null> => {
  try {
    const result = await extractPdfPageImages(fileUri, [1], quality, maxWidth);
    if (result.success && result.images.length > 0) {
      return result.images[0].uri;
    }
    return null;
  } catch (e) {
    console.log('[PDFImageService] Could not extract thumbnail');
    return null;
  }
};

/**
 * Check if PDF image extraction is available
 */
export const isPdfImageExtractionAvailable = (): boolean => {
  return PdfThumbnail !== null;
};

export default {
  extractPdfPageImages,
  extractFirstPageThumbnail,
  isPdfImageExtractionAvailable,
};
