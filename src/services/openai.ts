// Main AI Service - Uses centralized config and services
// To update API keys or endpoints, edit src/services/config.ts

import Config from './config';
import PdfService from './pdfService';
import ApiService from './apiService';

export var generateSummary = async function(
  content: string,
  chunks?: string[],
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string,
  existingPdfUrl?: string,
  existingExtractedData?: any
): Promise<string> {
  try {
    if (onProgress) onProgress(5, 'Preparing document...');

    var textContent = content || '';
    if (chunks && chunks.length > 0) {
      textContent = chunks.join('\n\n');
    }

    // PRIORITY 1: Use existing extracted data if available (no API calls needed!)
    if (existingExtractedData && existingExtractedData.pages && existingExtractedData.pages.length > 0) {
      console.log('Using cached extracted data for summary');
      if (onProgress) onProgress(50, 'Generating summary...');
      
      var contentWithPages = existingExtractedData.pages.map(function(p: any) {
        var pageNum = p.pageNumber || p.pageNum;
        return '=== PAGE ' + pageNum + ' ===\n' + (p.text || '');
      }).join('\n\n');
      
      if (contentWithPages.length < 50) {
        contentWithPages = existingExtractedData.text || content || '';
      }
      
      // Include images from pages if available to improve multimodal summarization
      const existingImageUrls = existingExtractedData.pages
        .filter((p: any) => p.imageUrl)
        .map((p: any) => p.imageUrl);
      var summary = await ApiService.summarize(contentWithPages, { includePageRefs: true, includeImages: existingImageUrls.length > 0, imageUrls: existingImageUrls });
      if (onProgress) onProgress(100, 'Done!');
      return '# 📚 Document Summary\n*Using cached data - ' + existingExtractedData.totalPages + ' pages*\n\n---\n\n' + summary;
    }
    
    // PRIORITY 2: Use document content directly if sufficient
    if (textContent && textContent.length > 200) {
      console.log('Using document content directly');
      if (onProgress) onProgress(50, 'Analyzing content...');
      var summary = await ApiService.summarize(textContent);
      if (onProgress) onProgress(100, 'Done!');
      return summary;
    }

    // PRIORITY 3: Handle PDF files - extract with page references (API may fail)
    if (fileUri && fileType && (fileType.indexOf('pdf') >= 0 || fileUri.toLowerCase().endsWith('.pdf'))) {
      
      // Process document with page numbers - pass existing data to skip re-upload
      var doc = await PdfService.processDocument(fileUri, onProgress, existingPdfUrl, existingExtractedData);
      
      if (onProgress) onProgress(85, 'Generating summary with page references...');
      
      // Build content with page markers
      var pdfContentWithPages = '';
      
      if (doc.pages && doc.pages.length > 0) {
        // Use extracted pages with page markers
        pdfContentWithPages = doc.pages.map(function(p) {
          return '=== PAGE ' + p.pageNum + ' ===\n' + p.text;
        }).join('\n\n');
      } else if (doc.fullText && doc.fullText.length > 50) {
        // Fall back to raw full text if pages extraction failed
        pdfContentWithPages = doc.fullText;
      }
      
      // Check if extraction failed and we need OCR
      var needsOcr = (doc as any).needsOcr || 
                     pdfContentWithPages === '__NEEDS_OCR__' || 
                     pdfContentWithPages.includes('__NEEDS_OCR__') ||
                     !pdfContentWithPages || 
                     pdfContentWithPages.length < 50;
      
      if (needsOcr) {
        // Try OpenAI Vision OCR for scanned PDFs
        if (onProgress) onProgress(70, 'Document appears scanned. Using AI Vision OCR...');
        console.log('[OpenAI] Attempting Vision OCR for scanned PDF...');
        
        try {
          var ocrResult = await PdfService.ocrWithVision(fileUri, onProgress);
          if (ocrResult && ocrResult.fullText && ocrResult.fullText.length > 50) {
            pdfContentWithPages = ocrResult.fullText;
            if (onProgress) onProgress(85, 'OCR successful! Generating summary...');
          } else {
            throw new Error('OCR returned insufficient text');
          }
        } catch (ocrError: any) {
          console.error('[OpenAI] Vision OCR failed:', ocrError.message);
          throw new Error('Could not extract text from this PDF. The document may be:\n• A scanned image without OCR\n• Password protected\n• Corrupted\n\nTip: Use Google Drive to convert scanned PDFs to text first.');
        }
      }
      
      // Check if we have enough content to summarize
      if (!pdfContentWithPages || pdfContentWithPages.length < 50) {
        throw new Error('Could not extract text from this PDF. The document may be scanned images or have copy protection. Try a different PDF or upload a text-based document.');
      }
      
      // Summarize with page references
      const pdfImageUrls = doc.pages.filter((p: any) => p.imageUrl).map((p: any) => p.imageUrl);
      var pdfSummary = await ApiService.summarize(pdfContentWithPages, { includePageRefs: true, includeImages: pdfImageUrls.length > 0, imageUrls: pdfImageUrls });
      
      if (onProgress) onProgress(100, 'Done!');
      
      // Add header with document info
      return '# 📚 Document Summary\n' +
        '*' + doc.pageCount + ' pages analyzed with page references*\n\n' +
        '---\n\n' + pdfSummary;
    }

    // Non-PDF content
    if (onProgress) onProgress(50, 'Analyzing with AI...');
    var summary = await ApiService.summarize(textContent);
    if (onProgress) onProgress(100, 'Done!');
    return summary;
    
  } catch (error: any) {
    console.error('Error generating summary:', error);
    throw new Error(error.message || 'Failed to generate summary.');
  }
};

export var generateQuiz = async function(
  content: string,
  chunks?: string[],
  questionCount?: number,
  onProgress?: (progress: number, message: string) => void,
  fileUri?: string,
  fileType?: string
) {
  try {
    if (onProgress) onProgress(10, 'Preparing document...');

    var textContent = content || '';
    
    // Handle PDF files
    if (fileUri && fileType && fileType.indexOf('pdf') >= 0) {
      if (onProgress) onProgress(20, 'Processing PDF...');
      var doc = await PdfService.processDocument(fileUri, onProgress);
      textContent = doc.fullText;
    } else if (chunks && chunks.length > 0) {
      textContent = chunks.slice(0, 3).join('\n\n');
    }

    if (onProgress) onProgress(70, 'Generating quiz questions...');
    var questions = await ApiService.generateQuiz(textContent, questionCount);
    
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
  fileType?: string
): Promise<{ structured?: any; text: string; pageImages?: { pageNum: number; imageUrl: string }[] }> {
  try {
    if (onProgress) onProgress(10, 'Preparing document...');

    var textContent = content || '';
    var pageImages: { pageNum: number; imageUrl: string }[] = [];
    var imageUrls: string[] = [];
    
    // Handle PDF files
    if (fileUri && fileType && fileType.indexOf('pdf') >= 0) {
      if (onProgress) onProgress(20, 'Processing PDF...');
      var doc = await PdfService.processDocument(fileUri, onProgress);
      textContent = doc.pages.map(function(p) {
        return '=== PAGE ' + p.pageNum + ' ===\n' + p.text;
      }).join('\n\n');
      
      // Store page images for reference
      pageImages = doc.pages
        .filter(function(p) { return p.imageUrl; })
        .map(function(p) { return { pageNum: p.pageNum, imageUrl: p.imageUrl! }; });
      
      // Extract image URLs for vision API (if text content is low)
      imageUrls = pageImages.map(function(p) { return p.imageUrl; });
      
      console.log('Text content length:', textContent.length, 'Image URLs:', imageUrls.length);
    } else if (chunks && chunks.length > 0) {
      textContent = chunks.slice(0, 5).join('\n\n');
    }

    if (onProgress) onProgress(70, 'Creating study guide...');
    
    // Pass image URLs if text is limited but we have images
    var guide = await ApiService.generateStudyGuide(
      textContent, 
      textContent.length < 500 ? imageUrls : undefined
    );
    
    if (onProgress) onProgress(100, 'Done!');
    return { ...guide, pageImages };
    
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

    // Handle PDF files - need pages with images for slides
    if (fileUri && fileType && fileType.indexOf('pdf') >= 0) {
      if (onProgress) onProgress(20, 'Processing PDF for video lesson...');
      var doc = await PdfService.processDocument(fileUri, onProgress);
      
      if (onProgress) onProgress(75, 'Creating video lesson script...');
      var script = await ApiService.generateVideoScript(doc.pages, { language: 'en', style: 'educational', useAnimations: true });
      
      if (onProgress) onProgress(100, 'Done!');
      return script;
    }
    
    // For non-PDF, create basic script
    var textContent = content || '';
    if (chunks && chunks.length > 0) {
      textContent = chunks.slice(0, 3).join('\n\n');
    }
    
    if (onProgress) onProgress(50, 'Creating video script...');
    
    // Create simple pages array for text content
    var pages = [{ pageNum: 1, text: textContent }];
    var script = await ApiService.generateVideoScript(pages, { language: 'en', style: 'educational', useAnimations: true });
    
    if (onProgress) onProgress(100, 'Done!');
    return script;
    
  } catch (error: any) {
    console.error('Error generating video script:', error);
    throw new Error(error.message || 'Failed to generate video script.');
  }
};

// Re-export services for direct access if needed
export { Config, PdfService, ApiService };
