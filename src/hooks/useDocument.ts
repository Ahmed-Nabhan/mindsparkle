import { useState, useEffect } from 'react';
import { Document, DocumentUploadResult, ExtractedData } from '../types/document';
import { saveDocument, getAllDocuments, getDocumentById, updateDocumentExtractedData } from '../services/storage';
import { parseDocument } from '../services/documentParser';
import * as PdfService from '../services/pdfService';
import { generateId } from '../utils/helpers';

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

      updateProgress(5, 'Parsing document...');
      
      // Parse document and get chunks for large files
      const parsed = await parseDocument(fileUri, fileType);

      const documentId = generateId();
      let pdfCloudUrl: string | undefined;
      let extractedData: ExtractedData | undefined;

      // For PDFs, do full processing upfront
      if (fileType === 'application/pdf' || fileType.includes('pdf')) {
        try {
          updateProgress(15, 'Processing PDF...');
          
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

          updateProgress(85, 'Saving document...');
        } catch (pdfError: any) {
          console.log('PDF full processing failed, using basic parsing:', pdfError.message);
          // Continue with basic parsed content
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
