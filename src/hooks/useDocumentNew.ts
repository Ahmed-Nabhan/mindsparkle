/**
 * useDocument Hook - Production Ready
 * 
 * This hook provides document management functionality by calling the
 * documentService (single entry point). NO direct database calls.
 * 
 * ARCHITECTURE:
 *   Component → useDocument → documentService → Supabase
 * 
 * RBAC:
 * - All access control is enforced server-side via RLS
 * - Client-side checks are for UX only (better error messages)
 * 
 * @module hooks/useDocument
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Document, DocumentUploadResult } from '../types/document';
import documentService, {
  DocumentStatus,
  ProcessingStatus,
  UploadOptions,
} from '../services/documentService';
import { supabase } from '../services/supabase';

// ============================================
// TYPES
// ============================================

export interface UseDocumentReturn {
  /** List of user's documents */
  documents: Document[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Upload progress (0-100) */
  uploadProgress: number;
  /** Upload status message */
  uploadMessage: string;
  /** Upload a new document */
  uploadDocument: (
    fileName: string,
    fileUri: string,
    fileType: string,
    fileSize: number,
    onProgress?: (progress: number, message: string) => void
  ) => Promise<DocumentUploadResult>;
  /** Get a single document by ID */
  getDocument: (id: string) => Promise<Document | null>;
  /** Delete a document (soft delete) */
  removeDocument: (id: string) => Promise<boolean>;
  /** Refresh documents list */
  refreshDocuments: () => Promise<void>;
  /** Clear error state */
  clearError: () => void;
}

// Track documents with active operations (prevents duplicate uploads)
const activeOperations = new Set<string>();

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Convert DocumentStatus to Document type
 */
function statusToDocument(status: DocumentStatus): Document {
  return {
    id: status.id,
    title: status.title,
    fileName: status.title, // Use title as fileName
    fileUri: '', // Cloud documents don't have local URI
    content: '',
    chunks: [],
    totalChunks: 0,
    isLargeFile: false,
    uploadedAt: new Date(),
    fileType: '',
    fileSize: 0,
  };
}

/**
 * Validate UUID format
 */
function isValidUUID(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ============================================
// HOOK
// ============================================

export const useDocument = (): UseDocumentReturn => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  
  // Track mounted state to prevent state updates after unmount
  const mountedRef = useRef(true);
  
  // Track realtime subscription
  const subscriptionRef = useRef<(() => void) | null>(null);

  // ============================================
  // LOAD DOCUMENTS
  // ============================================
  
  const loadDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const docs = await documentService.getDocuments();
      
      if (mountedRef.current) {
        // Convert DocumentStatus to Document type
        const documentsList: Document[] = docs.map(doc => ({
          id: doc.id,
          title: doc.title,
          fileName: doc.title,
          fileUri: '',
          content: '',
          chunks: [],
          totalChunks: 0,
          isLargeFile: false,
          uploadedAt: new Date(),
          fileType: '',
          fileSize: 0,
        }));
        
        setDocuments(documentsList);
        console.log(`[useDocument] Loaded ${docs.length} documents`);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err.message || 'Failed to load documents');
        console.error('[useDocument] Load error:', err);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // ============================================
  // REALTIME SUBSCRIPTION
  // ============================================
  
  const setupRealtimeSubscription = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    // Clean up existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current();
    }
    
    // Subscribe to document changes
    subscriptionRef.current = documentService.subscribeToDocuments(
      user.id,
      (newDoc) => {
        // Document inserted
        if (mountedRef.current) {
          setDocuments(prev => [{
            id: newDoc.id,
            title: newDoc.title,
            fileName: newDoc.original_filename || newDoc.title,
            fileUri: '',
            content: '',
            chunks: [],
            totalChunks: 0,
            isLargeFile: false,
            uploadedAt: new Date(newDoc.created_at),
            fileType: newDoc.file_type,
            fileSize: newDoc.file_size,
          }, ...prev]);
        }
      },
      (updatedDoc) => {
        // Document updated
        if (mountedRef.current) {
          setDocuments(prev => prev.map(d => 
            d.id === updatedDoc.id 
              ? {
                  ...d,
                  title: updatedDoc.title,
                  extractionStatus: updatedDoc.extraction_status,
                  hasText: updatedDoc.has_text,
                }
              : d
          ));
        }
      },
      (docId) => {
        // Document deleted
        if (mountedRef.current) {
          setDocuments(prev => prev.filter(d => d.id !== docId));
        }
      }
    );
  }, []);

  // ============================================
  // INITIALIZE
  // ============================================
  
  useEffect(() => {
    mountedRef.current = true;
    
    loadDocuments();
    setupRealtimeSubscription();
    
    return () => {
      mountedRef.current = false;
      if (subscriptionRef.current) {
        subscriptionRef.current();
        subscriptionRef.current = null;
      }
    };
  }, [loadDocuments, setupRealtimeSubscription]);

  // ============================================
  // UPLOAD DOCUMENT
  // ============================================
  
  const uploadDocument = useCallback(async (
    fileName: string,
    fileUri: string,
    fileType: string,
    fileSize: number,
    onProgress?: (progress: number, message: string) => void
  ): Promise<DocumentUploadResult> => {
    // Generate upload ID for deduplication
    const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Check for duplicate upload
    if (activeOperations.has(fileName)) {
      return { 
        success: false, 
        error: 'This file is already being uploaded' 
      };
    }
    
    activeOperations.add(fileName);
    
    try {
      setIsLoading(true);
      setError(null);
      setUploadProgress(0);
      setUploadMessage('Starting upload...');
      
      const progressHandler = (progress: number, message: string) => {
        if (mountedRef.current) {
          setUploadProgress(progress);
          setUploadMessage(message);
        }
        onProgress?.(progress, message);
      };
      
      const result = await documentService.uploadDocument(
        {
          fileName,
          fileUri,
          fileType,
          fileSize,
          uploadId,
        },
        progressHandler
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }
      
      // Success - the document will appear via realtime subscription
      // But we'll also add it immediately for better UX
      if (result.document && mountedRef.current) {
        const newDoc: Document = {
          id: result.documentId,
          title: result.document.title,
          fileName,
          fileUri,
          content: '',
          chunks: [],
          totalChunks: 0,
          isLargeFile: fileSize > 10 * 1024 * 1024,
          uploadedAt: new Date(),
          fileType: result.document.fileType,
          fileSize: result.document.fileSize,
        };
        
        setDocuments(prev => [newDoc, ...prev.filter(d => d.id !== newDoc.id)]);
      }
      
      return {
        success: true,
        document: result.document ? {
          id: result.documentId,
          title: result.document.title,
          fileName,
          fileUri,
          content: '',
          chunks: [],
          totalChunks: 0,
          isLargeFile: fileSize > 10 * 1024 * 1024,
          uploadedAt: new Date(),
          fileType: result.document.fileType,
          fileSize: result.document.fileSize,
        } : undefined,
      };
      
    } catch (err: any) {
      const errorMessage = err.message || 'Upload failed';
      if (mountedRef.current) {
        setError(errorMessage);
      }
      console.error('[useDocument] Upload error:', err);
      return { success: false, error: errorMessage };
      
    } finally {
      activeOperations.delete(fileName);
      if (mountedRef.current) {
        setIsLoading(false);
        setUploadProgress(0);
        setUploadMessage('');
      }
    }
  }, []);

  // ============================================
  // GET DOCUMENT
  // ============================================
  
  const getDocument = useCallback(async (id: string): Promise<Document | null> => {
    try {
      // Validate ID format
      if (!isValidUUID(id)) {
        // May be a local document ID
        console.log('[useDocument] Getting local document:', id);
        return documents.find(d => d.id === id) || null;
      }
      
      const status = await documentService.getDocument(id);
      
      if (!status) {
        return null;
      }
      
      return {
        id: status.id,
        title: status.title,
        fileName: status.title,
        fileUri: '',
        content: '',
        chunks: [],
        totalChunks: 0,
        isLargeFile: false,
        uploadedAt: new Date(),
        fileType: '',
        fileSize: 0,
      };
      
    } catch (err: any) {
      console.error('[useDocument] Get document error:', err);
      return null;
    }
  }, [documents]);

  // ============================================
  // DELETE DOCUMENT
  // ============================================
  
  const removeDocument = useCallback(async (id: string): Promise<boolean> => {
    try {
      console.log('[useDocument] Deleting document:', id);
      
      // Validate ID format
      if (!isValidUUID(id)) {
        // Local document - remove from state only
        console.log('[useDocument] Removing local document:', id);
        setDocuments(prev => prev.filter(d => d.id !== id));
        return true;
      }
      
      const result = await documentService.deleteDocument(id);
      
      if (!result.success) {
        throw new Error(result.error || 'Delete failed');
      }
      
      // Remove from local state immediately (realtime will also trigger)
      if (mountedRef.current) {
        setDocuments(prev => prev.filter(d => d.id !== id));
      }
      
      console.log('[useDocument] Document deleted successfully:', id);
      return true;
      
    } catch (err: any) {
      console.error('[useDocument] Delete error:', err);
      if (mountedRef.current) {
        setError(err.message || 'Failed to delete document');
      }
      return false;
    }
  }, []);

  // ============================================
  // CLEAR ERROR
  // ============================================
  
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ============================================
  // RETURN
  // ============================================
  
  return {
    documents,
    isLoading,
    error,
    uploadProgress,
    uploadMessage,
    uploadDocument,
    getDocument,
    removeDocument,
    refreshDocuments: loadDocuments,
    clearError,
  };
};

export default useDocument;
