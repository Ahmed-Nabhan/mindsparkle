/**
 * useDocumentV2 Hook - Simplified Document Management
 * 
 * NEW ARCHITECTURE:
 * - Client only uploads files
 * - All extraction happens on backend
 * - Uses polling/realtime for status updates
 * 
 * This hook replaces useDocument.ts with a simpler implementation
 * that doesn't do any local extraction.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Document } from '../types/document';
import { CanonicalDocument, ExtractionStatus, DocumentStatusResponse } from '../types/canonical';
import documentService from '../services/documentServiceV2';
import { supabase } from '../services/supabase';
import { saveDocument as saveToLocalDb, getAllDocuments as getLocalDocuments, deleteAllDocuments as deleteLocalDocuments } from '../services/storage';

// ============================================
// TYPES
// ============================================

interface UseDocumentState {
  documents: CanonicalDocument[];
  isLoading: boolean;
  error: string | null;
  uploadProgress: number;
  uploadMessage: string;
  extractionStatus: Map<string, ExtractionStatus>;
}

// ============================================
// HOOK
// ============================================

export function useDocumentV2() {
  const [documents, setDocuments] = useState<CanonicalDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  
  // Track extraction status for documents being processed
  const [extractionStatus, setExtractionStatus] = useState<Map<string, ExtractionStatus>>(new Map());
  
  // Active subscriptions
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map());

  // ========================================
  // LOAD DOCUMENTS
  // ========================================

  const loadDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const docs = await documentService.getDocuments();
      setDocuments(docs);
      
      console.log(`[useDocumentV2] Loaded ${docs.length} documents`);
      
      // Check for any documents still being processed
      for (const doc of docs) {
        if (doc.status === 'uploaded' || doc.status === 'processing') {
          subscribeToDocument(doc.id);
        }
      }
      
    } catch (err: any) {
      console.error('[useDocumentV2] Load failed:', err);
      setError(err.message || 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadDocuments();
    
    // Cleanup subscriptions on unmount
    return () => {
      subscriptionsRef.current.forEach(unsubscribe => unsubscribe());
      subscriptionsRef.current.clear();
    };
  }, [loadDocuments]);

  // ========================================
  // UPLOAD DOCUMENT
  // ========================================

  const uploadDocument = useCallback(async (
    fileName: string,
    fileUri: string,
    fileType: string,
    fileSize: number,
    onProgress?: (progress: number, message: string) => void
  ): Promise<{ success: boolean; documentId?: string; error?: string }> => {
    try {
      setIsLoading(true);
      setError(null);
      setUploadProgress(0);
      setUploadMessage('Starting upload...');
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Please sign in to upload documents');
      }
      
      // Upload document
      const result = await documentService.uploadDocument(
        fileName,
        fileUri,
        fileType,
        fileSize,
        user.id,
        (progress, message) => {
          setUploadProgress(progress);
          setUploadMessage(message);
          onProgress?.(progress, message);
        }
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }
      
      console.log(`[useDocumentV2] Upload complete: ${result.documentId}`);
      
      // Track extraction status
      setExtractionStatus(prev => new Map(prev).set(result.documentId, 'uploaded'));
      
      // Subscribe to extraction updates
      subscribeToDocument(result.documentId);
      
      // Also save to local DB for offline access (minimal data)
      try {
        await saveToLocalDb({
          id: result.documentId,
          title: fileName.replace(/\.[^/.]+$/, ''),
          fileName,
          fileUri,
          fileType,
          fileSize,
          uploadedAt: new Date(),
          content: '', // Will be filled when extraction completes
        });
      } catch (localError) {
        console.warn('[useDocumentV2] Local save failed:', localError);
      }
      
      // Refresh document list
      await loadDocuments();
      
      setUploadProgress(100);
      setUploadMessage('Upload complete!');
      
      return { success: true, documentId: result.documentId };
      
    } catch (err: any) {
      console.error('[useDocumentV2] Upload error:', err);
      setError(err.message);
      setUploadProgress(0);
      setUploadMessage('');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, [loadDocuments]);

  // ========================================
  // SUBSCRIBE TO DOCUMENT STATUS
  // ========================================

  const subscribeToDocument = useCallback((documentId: string) => {
    // Don't subscribe if already subscribed
    if (subscriptionsRef.current.has(documentId)) {
      return;
    }
    
    console.log(`[useDocumentV2] Subscribing to document: ${documentId}`);
    
    const unsubscribe = documentService.subscribeToDocument(
      documentId,
      (status: DocumentStatusResponse) => {
        console.log(`[useDocumentV2] Status update for ${documentId}: ${status.status}`);
        
        // Update extraction status
        setExtractionStatus(prev => new Map(prev).set(documentId, status.status));
        
        // If extraction is complete, update the document in state
        if (status.status === 'extracted' || status.status === 'analyzed') {
          if (status.document) {
            setDocuments(prev => {
              const idx = prev.findIndex(d => d.id === documentId);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = status.document!;
                return updated;
              }
              return [...prev, status.document!];
            });
          }
          
          // Unsubscribe once complete
          const unsub = subscriptionsRef.current.get(documentId);
          if (unsub) {
            unsub();
            subscriptionsRef.current.delete(documentId);
          }
        }
        
        // If failed, also unsubscribe
        if (status.status === 'failed') {
          setError(`Extraction failed for document: ${status.message}`);
          const unsub = subscriptionsRef.current.get(documentId);
          if (unsub) {
            unsub();
            subscriptionsRef.current.delete(documentId);
          }
        }
      }
    );
    
    subscriptionsRef.current.set(documentId, unsubscribe);
  }, []);

  // ========================================
  // GET DOCUMENT
  // ========================================

  const getDocument = useCallback(async (documentId: string): Promise<CanonicalDocument | null> => {
    // First check local state
    const local = documents.find(d => d.id === documentId);
    if (local && local.status !== 'uploaded' && local.status !== 'processing') {
      return local;
    }
    
    // Fetch from server
    return await documentService.getDocument(documentId);
  }, [documents]);

  // ========================================
  // DELETE DOCUMENT
  // ========================================

  const deleteDocument = useCallback(async (documentId: string): Promise<boolean> => {
    try {
      const success = await documentService.deleteDocument(documentId);
      
      if (success) {
        // Remove from local state
        setDocuments(prev => prev.filter(d => d.id !== documentId));
        
        // Clean up subscription if exists
        const unsub = subscriptionsRef.current.get(documentId);
        if (unsub) {
          unsub();
          subscriptionsRef.current.delete(documentId);
        }
      }
      
      return success;
    } catch (err: any) {
      console.error('[useDocumentV2] Delete failed:', err);
      setError(err.message);
      return false;
    }
  }, []);

  // ========================================
  // DELETE ALL DOCUMENTS
  // ========================================

  const deleteAllDocumentsAction = useCallback(async (): Promise<boolean> => {
    try {
      // Delete from cloud
      const success = await documentService.deleteAllDocuments();
      
      // Also delete from local DB
      await deleteLocalDocuments();
      
      if (success) {
        setDocuments([]);
        
        // Clean up all subscriptions
        subscriptionsRef.current.forEach(unsub => unsub());
        subscriptionsRef.current.clear();
      }
      
      return success;
    } catch (err: any) {
      console.error('[useDocumentV2] Delete all failed:', err);
      setError(err.message);
      return false;
    }
  }, []);

  // ========================================
  // RETRY EXTRACTION
  // ========================================

  const retryExtraction = useCallback(async (documentId: string): Promise<boolean> => {
    const success = await documentService.retryExtraction(documentId);
    
    if (success) {
      setExtractionStatus(prev => new Map(prev).set(documentId, 'uploaded'));
      subscribeToDocument(documentId);
    }
    
    return success;
  }, [subscribeToDocument]);

  // ========================================
  // WAIT FOR EXTRACTION
  // ========================================

  const waitForExtraction = useCallback(async (
    documentId: string,
    onProgress?: (status: DocumentStatusResponse) => void
  ): Promise<CanonicalDocument | null> => {
    const result = await documentService.waitForExtraction(
      documentId,
      120000, // 2 minute timeout
      2000,   // Poll every 2 seconds
      onProgress
    );
    
    return result.document || null;
  }, []);

  // ========================================
  // REFRESH
  // ========================================

  const refresh = useCallback(async () => {
    await loadDocuments();
  }, [loadDocuments]);

  // ========================================
  // RETURN
  // ========================================

  return {
    // State
    documents,
    isLoading,
    error,
    uploadProgress,
    uploadMessage,
    extractionStatus,
    
    // Actions
    uploadDocument,
    getDocument,
    deleteDocument,
    deleteAllDocuments: deleteAllDocumentsAction,
    retryExtraction,
    waitForExtraction,
    refresh,
    
    // Utility
    isExtracting: (id: string) => {
      const status = extractionStatus.get(id);
      return status === 'uploaded' || status === 'processing';
    },
  };
}

// Default export for backwards compatibility
export default useDocumentV2;
