import { useState, useEffect } from 'react';
import { Document, DocumentUploadResult, ExtractedData } from '../types/document';
import { saveDocument, getAllDocuments, getDocumentById, updateDocumentExtractedData, updateDocumentSummary } from '../services/storage';
import { parseDocument } from '../services/documentParser';
import * as PdfService from '../services/pdfService';
import * as PdfImageService from '../services/pdfImageService';
import * as CloudStorage from '../services/cloudStorageService';
import { generateId } from '../utils/helpers';
import { supabase } from '../services/supabase';
import { summarize } from '../services/apiService';

// Helper to split text into chunks
const splitTextIntoChunks = (text: string, chunkSize: number): string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [''];
};

// Track documents with summary generation in progress (global state)
const summaryGenerationInProgress = new Set<string>();

// Check if summary is being generated for a document
export const isSummaryGenerating = (documentId: string): boolean => {
  return summaryGenerationInProgress.has(documentId);
};

// Background summary generation - runs after upload without blocking
const generateBackgroundSummary = async (documentId: string, content: string): Promise<void> => {
  // Mark as in-progress
  summaryGenerationInProgress.add(documentId);
  
  try {
    console.log('[Background] Generating summary for document:', documentId);
    const startTime = Date.now();
    
    // Generate summary using parallel processing
    const summaryText = await summarize(content, { language: 'en' });
    
    if (summaryText && summaryText.length > 50) {
      // Save to local storage
      await updateDocumentSummary(documentId, summaryText);
      console.log('[Background] Summary saved in', Date.now() - startTime, 'ms');
    }
  } catch (error: any) {
    console.error('[Background] Summary generation failed:', error.message);
    // Don't throw - this is fire-and-forget
  } finally {
    // Mark as complete
    summaryGenerationInProgress.delete(documentId);
  }
};

export const useDocument = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setIsLoading(true);
      const docs = await getAllDocuments();
      setDocuments(docs);
    } catch (err) {
      setError('Failed to load documents');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const uploadDocument = async (
    fileName: string,
    fileUri:  string,
    fileType: string,
    fileSize: number,
    onProgress?: (progress: number, message: string) => void
  ): Promise<DocumentUploadResult> => {
    try {
      setIsLoading(true);
      setError(null);
      setUploadProgress(0);
      setUploadMessage('Starting upload...');

      const updateProgress = (progress: number, message: string) => {
        setUploadProgress(progress);
        setUploadMessage(message);
        if (onProgress) onProgress(progress, message);
      };

      updateProgress(5, 'Processing document...');

      const documentId = generateId();
      let pdfCloudUrl: string | undefined;
      let extractedData: ExtractedData | undefined;
      let parsed = { content: '', chunks: [] as string[], totalChunks: 0, isLargeFile: false };

      // Check BOTH mimeType AND fileName extension (mimeType may be 'application/octet-stream' on iOS)
      const fileNameLower = fileName.toLowerCase();
      const fileTypeLower = (fileType || '').toLowerCase();
      const isPdf = fileTypeLower === 'application/pdf' || 
                    fileTypeLower.includes('pdf') || 
                    fileNameLower.endsWith('.pdf');
      const isPptx = fileTypeLower.includes('powerpoint') || 
                     fileTypeLower.includes('presentation') ||
                     fileNameLower.endsWith('.pptx') || 
                     fileNameLower.endsWith('.ppt');
      const isDocx = fileTypeLower.includes('word') || 
                     fileTypeLower.includes('document') ||
                     fileNameLower.endsWith('.docx') || 
                     fileNameLower.endsWith('.doc');
      
      // File size check for cloud vs local processing
      const fileSizeMB = fileSize / (1024 * 1024);
      const useCloudProcessing = CloudStorage.shouldUseCloudProcessing(fileSize);
      
      console.log('[useDocument] File check:', { 
        fileName, 
        fileType, 
        fileSize: fileSizeMB.toFixed(1) + 'MB', 
        isPdf, 
        isPptx, 
        isDocx,
        useCloudProcessing 
      });
      
      // For large files (>=50MB), use cloud processing
      if (useCloudProcessing) {
        updateProgress(10, 'Large file detected - uploading to cloud...');
        
        // Get current user - first try getSession which is more reliable
        let userId: string | null = null;
        
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          userId = sessionData.session.user.id;
        } else {
          // Fallback to getUser
          const { data: userData } = await supabase.auth.getUser();
          userId = userData?.user?.id || null;
        }
        
        if (!userId) {
          throw new Error('Please sign in to upload large files (50MB+). Large files require cloud storage.');
        }
        
        console.log('[useDocument] Cloud upload for user:', userId);
        
        // Upload to cloud
        const cloudResult = await CloudStorage.uploadLargeFile(
          userId,
          documentId,
          fileUri,
          fileName,
          fileType,
          fileSize,
          (progress, message) => {
            // Scale progress from 10-70%
            const scaledProgress = 10 + (progress * 0.6);
            updateProgress(scaledProgress, message);
          }
        );
        
        if (!cloudResult.success) {
          throw new Error(cloudResult.error || 'Failed to upload to cloud');
        }
        
        updateProgress(75, 'Waiting for text extraction...');
        
        // Wait for server-side text extraction - FASTER polling
        const cloudDoc = await CloudStorage.waitForProcessing(
          cloudResult.cloudDocumentId!,
          90000, // Wait up to 90 seconds (reduced from 2 minutes)
          1500   // Poll every 1.5 seconds (faster than 3 seconds)
        );
        
        if (!cloudDoc) {
          throw new Error('Cloud processing timed out. The document will be processed in the background.');
        }
        
        if (cloudDoc.status === 'error') {
          throw new Error(cloudDoc.processingError || 'Cloud text extraction failed');
        }
        
        updateProgress(85, 'Saving document...');
        
        // Use extracted text from cloud
        const extractedText = cloudDoc.extractedText || '';
        parsed = {
          content: extractedText,
          chunks: splitTextIntoChunks(extractedText, 12000),
          totalChunks: 1,
          isLargeFile: true,
        };
        
        // Create minimal extracted data
        extractedData = {
          text: extractedText,
          pages: [{
            pageNumber: 1,
            text: extractedText,
            images: [],
            tables: [],
          }],
          images: [],
          tables: [],
          equations: [],
          totalPages: 1,
        };
        
        // Store cloud document reference
        pdfCloudUrl = cloudResult.storagePath;
        
      } else if (isPdf) {
        try {
          updateProgress(15, 'Processing PDF...');
          console.log('[useDocument] Using PdfService for PDF file');
          
          const processedDoc = await PdfService.processDocument(fileUri, (progress, message) => {
            // Scale progress from 15-80%
            const scaledProgress = 15 + (progress * 0.65);
            updateProgress(scaledProgress, message);
          });

          pdfCloudUrl = processedDoc.pdfUrl;
          
          // Store extracted data for later use
          extractedData = {
            text: processedDoc.fullText,
            pages: processedDoc.pages.map((p, idx) => ({
              pageNumber: p.pageNum,
              text: p.text,
              images: p.imageUrl ? [{
                id: `img-${idx}`,
                url: p.imageUrl,
                caption: '',
                pageNumber: p.pageNum,
                type: 'figure' as const,
              }] : [],
              tables: [],
            })),
            images: processedDoc.pages
              .filter(p => p.imageUrl)
              .map((p, idx) => ({
                id: `img-${idx}`,
                url: p.imageUrl!,
                caption: '',
                pageNumber: p.pageNum,
                type: 'figure' as const,
              })),
            tables: [],
            equations: [],
            totalPages: processedDoc.pageCount,
          };

          // Also set parsed content for document storage
          parsed = {
            content: processedDoc.fullText,
            chunks: processedDoc.pages.map(p => p.text),
            totalChunks: processedDoc.pageCount,
            isLargeFile: processedDoc.pageCount > 10,
          };

          // SKIP image extraction during upload for FASTER uploads
          // Images will be extracted on-demand when needed (e.g., for video generation)
          updateProgress(85, 'Finalizing...');
          
          // Only extract images for SMALL documents (< 5 pages) during upload
          if (processedDoc.pageCount <= 5) {
            try {
              if (PdfImageService.isPdfImageExtractionAvailable()) {
                const imageResult = await PdfImageService.extractPdfPageImages(
                  fileUri, 
                  'all', 
                  50,  // Lower quality for faster extraction
                  400  // Smaller size for faster extraction
                );
                
                if (imageResult.success && imageResult.images.length > 0) {
                  console.log('[useDocument] Extracted', imageResult.images.length, 'page images');
                  
                  // Add images to extracted data
                  const pageImages = imageResult.images.map((img, idx) => ({
                    id: `page-img-${idx}`,
                    url: img.uri,
                    caption: `Page ${img.pageNum}`,
                    pageNumber: img.pageNum,
                    type: 'figure' as const,
                  }));
                  
                  // Merge with existing images
                  if (extractedData) {
                    extractedData.images = [...(extractedData.images || []), ...pageImages];
                    
                    // Also add to pages
                    for (const img of imageResult.images) {
                      const pageIdx = extractedData.pages.findIndex(p => p.pageNumber === img.pageNum);
                      if (pageIdx >= 0) {
                        extractedData.pages[pageIdx].images = [
                          ...(extractedData.pages[pageIdx].images || []),
                          {
                            id: `page-img-${img.pageNum}`,
                            url: img.uri,
                            caption: `Page ${img.pageNum}`,
                            pageNumber: img.pageNum,
                            type: 'figure' as const,
                          }
                        ];
                      }
                    }
                  }
                }
              }
            } catch (imgError) {
              console.log('[useDocument] Image extraction skipped:', imgError);
            }
          } else {
            console.log('[useDocument] Skipping image extraction for large document (', processedDoc.pageCount, 'pages) - will extract on demand');
          }

          updateProgress(90, 'Saving document...');
        } catch (pdfError: any) {
          console.error('[useDocument] PDF processing failed:', pdfError.message);
          // If the error is OOM, rethrow with clear message
          if (pdfError.message?.includes('memory') || pdfError.message?.includes('regexp')) {
            throw new Error('This PDF is too large to process. Please try a smaller file (under 50MB) or split the document.');
          }
          throw new Error('Could not process PDF: ' + pdfError.message);
        }
      } else {
        console.log('[useDocument] Using parseDocument for non-PDF file');
        // For non-PDF files, use parseDocument
        try {
          parsed = await parseDocument(fileUri, fileType);
        } catch (parseError: any) {
          console.log('Parse error:', parseError.message);
          throw new Error('Could not read document: ' + parseError.message);
        }
      }

      updateProgress(90, 'Finalizing...');

      const newDocument:  Document = {
        id: documentId,
        title: fileName.replace(/\.[^/.]+$/, ''),
        fileName,
        fileUri,
        fileType,
        fileSize,
        uploadedAt:  new Date(),
        content: parsed.content,
        chunks: parsed.chunks,
        totalChunks: parsed.totalChunks,
        isLargeFile: parsed.isLargeFile,
        pdfCloudUrl,
        extractedData,
      };

      await saveDocument(newDocument);
      
      updateProgress(100, 'Upload complete!');
      await loadDocuments();

      // AUTO-GENERATE SUMMARY IN BACKGROUND (instant when user clicks Summary)
      // Fire and forget - don't block the upload completion
      if (parsed.content && parsed.content.length > 50) {
        console.log('[useDocument] Starting background summary generation...');
        generateBackgroundSummary(newDocument.id, parsed.content).catch(err => {
          console.warn('[useDocument] Background summary failed:', err.message);
        });
      }

      return { success: true, document: newDocument };
    } catch (err:  any) {
      const errorMessage = err.message || 'Failed to upload document';
      setError(errorMessage);
      console.error(err);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
      setUploadMessage('');
    }
  };

  const getDocument = async (id: string): Promise<Document | null> => {
    try {
      return await getDocumentById(id);
    } catch (err) {
      console.error('Failed to get document:', err);
      return null;
    }
  };

  return {
    documents,
    isLoading,
    error,
    uploadProgress,
    uploadMessage,
    uploadDocument,
    getDocument,
    refreshDocuments:  loadDocuments,
  };
};
