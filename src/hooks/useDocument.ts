import { useState, useEffect } from 'react';
import { Document, DocumentUploadResult } from '../types/document';
import { saveDocument, getAllDocuments, getDocumentById } from '../services/storage';
import { parseDocument } from '../services/documentParser';
import { generateId } from '../utils/helpers';

export const useDocument = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    fileSize: number
  ): Promise<DocumentUploadResult> => {
    try {
      setIsLoading(true);
      setError(null);

      // Parse document and get chunks for large files
      const parsed = await parseDocument(fileUri, fileType);

      const newDocument:  Document = {
        id: generateId(),
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
      };

      await saveDocument(newDocument);
      await loadDocuments();

      return { success: true, document: newDocument };
    } catch (err:  any) {
      const errorMessage = err.message || 'Failed to upload document';
      setError(errorMessage);
      console.error(err);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
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
    uploadDocument,
    getDocument,
    refreshDocuments:  loadDocuments,
  };
};
