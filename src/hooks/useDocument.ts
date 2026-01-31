import { useState, useEffect, useCallback } from 'react';
import { Document, DocumentUploadResult } from '../types/document';
import { saveDocument, getAllDocuments, getDocumentById, deleteDocument, deleteAllDocuments } from '../services/storage';
import { supabase } from '../services/supabase';
import { canAccessDocument, verifyIsAdmin } from '../services/rbacService';
import { uploadDocument as uploadDocumentService } from '../services/documentIntelligenceService';
import { UserRole } from '../types/user';
import * as FileSystem from 'expo-file-system';

// Track documents with summary generation in progress (global state)
const summaryGenerationInProgress = new Set<string>();

// Check if summary is being generated for a document
export const isSummaryGenerating = (documentId: string): boolean => {
  return summaryGenerationInProgress.has(documentId);
};

/**
 * useDocument Hook - Document management with RBAC support
 * 
 * RBAC INTEGRATION:
 * - loadDocuments(): Fetches documents based on user's role
 *   - 'user': Only own documents (via RLS)
 *   - 'admin': All documents (is_admin() check in RLS)
 *   - 'vendor': Own docs + shared via vendor_permissions
 * 
 * - getDocument(): Validates access before returning
 * - deleteDocument(): Validates delete permission
 * 
 * SECURITY NOTE:
 * - Supabase RLS policies enforce server-side access control
 * - Client-side checks are for UX (error messages, UI state)
 * - RLS cannot be bypassed from client
 */
export const useDocument = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  
  // Track user's role for RBAC decisions
  const [userRole, setUserRole] = useState<UserRole>('user');

  /**
   * Load documents based on user's role
   * 
   * RBAC BEHAVIOR:
   * - Supabase RLS automatically filters documents based on role
   * - Admin sees all documents (via is_admin() RLS function)
   * - User sees only own documents (auth.uid() = user_id)
   * - Vendor sees own + shared documents
   */
  const loadDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Fetch documents - RLS handles role-based filtering
      // The database will return only documents the user can access
      const docs = await getAllDocuments();
      setDocuments(docs);
      
      // Log for debugging RBAC
      console.log(`[useDocument] Loaded ${docs.length} documents (RBAC filtered by server)`);
    } catch (err) {
      setError('Failed to load documents');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    
    // Check if user is admin for role-based UI decisions
    verifyIsAdmin().then(isAdmin => {
      setUserRole(isAdmin ? 'admin' : 'user');
    });
  }, [loadDocuments]);

  const uploadDocument = async (
    fileName: string,
    fileUri:  string,
    fileType: string,
    fileSize: number,
    onProgress?: (progress: number, message: string) => void,
    isPro: boolean = false,
    abortSignal?: AbortSignal
  ): Promise<DocumentUploadResult> => {
    try {
      if (abortSignal?.aborted) {
        return { success: false, error: 'Upload cancelled' };
      }

      setIsLoading(true);
      setError(null);
      setUploadProgress(0);
      setUploadMessage('Starting upload...');

      const updateProgress = (progress: number, message: string) => {
        if (abortSignal?.aborted) return;
        setUploadProgress(progress);
        setUploadMessage(message);
        if (onProgress) onProgress(progress, message);
      };

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Please sign in to upload documents');
      }

      // Some providers (notably iCloud on iOS) may return fileSize as 0.
      // Resolve size from the file URI so quota tracking + large-file heuristics are correct.
      let resolvedFileSize = Number(fileSize) || 0;
      try {
        if (resolvedFileSize <= 0 && fileUri) {
          const info = await FileSystem.getInfoAsync(fileUri, { size: true });
          const candidate = Number((info as any)?.size) || 0;
          if (candidate > 0) resolvedFileSize = candidate;
        }
      } catch (e: any) {
        console.warn('[useDocument] Could not resolve file size from URI:', e?.message || e);
      }

      // Call the unified upload service
      // This handles: upload → extract → analyze → store → trigger AI
      const result = await uploadDocumentService(
        fileName,
        fileUri,
        fileType,
        resolvedFileSize,
        user.id,
        updateProgress,
        isPro, // Pass Pro status for premium Adobe OCR
        abortSignal
      );

      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      // Also save to local storage for offline access
      if (result.document) {
        const extractedText = result.document.extractedText;
        const localDocument: Document = {
          id: result.documentId,
          title: result.document.title,
          fileName: fileName, // Required field for SQLite
          fileUri: fileUri, // Required field for SQLite
          content: extractedText,
          chunks: [extractedText],
          totalChunks: 1,
          isLargeFile: resolvedFileSize > 10 * 1024 * 1024,
          uploadedAt: new Date(),
          fileType: result.document.fileType,
          fileSize: result.document.fileSize,
          pdfCloudUrl: result.document.storagePath,
          extractedData: result.document.extractedData,
          userId: user.id,
        };
        
        await saveDocument(localDocument);
      }

      updateProgress(100, 'Upload complete!');
      await loadDocuments();

      return { 
        success: true, 
        document: result.document ? {
          id: result.documentId,
          title: result.document.title,
          content: result.document.extractedText,
          chunks: [result.document.extractedText],
          totalChunks: 1,
          isLargeFile: fileSize > 10 * 1024 * 1024,
          uploadedAt: new Date(),
          fileType: result.document.fileType,
          fileSize: result.document.fileSize,
        } as Document : undefined
      };
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to upload document';
      setError(errorMessage);
      console.error('[useDocument] Upload error:', err);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
      setUploadMessage('');
    }
  };

  /**
   * RBAC: Get Document with Access Validation
   * 
   * Access control flow:
   * 1. First fetches document from local/cloud storage
   * 2. For non-admin users, validates access via canAccessDocument()
   * 3. This check is redundant with RLS but provides better error messages
   * 
   * Role-based behavior:
   * - admin: Can access any document (bypasses validation)
   * - vendor: Can access own docs + docs shared with them
   * - user: Can only access own documents
   */
  const getDocument = useCallback(async (id: string): Promise<Document | null> => {
    try {
      const document = await getDocumentById(id);
      
      if (!document) {
        return null;
      }

      // Only treat documents as "cloud-only" if we don't have a local URI AND we also don't have
      // local text content. Cloud-synced documents saved into SQLite often use an empty fileUri,
      // but they should still be accessible offline.
      const hasLocalText =
        (typeof document.content === 'string' && document.content.trim().length > 0) ||
        (typeof (document as any)?.extractedData?.text === 'string' && (document as any).extractedData.text.trim().length > 0);

      const isCloudDocument = !document.fileUri && !hasLocalText;
      
      // RBAC: Validate document access for non-admin users
      // Admins bypass this check as they have full access.
      // If the local row is already attributed to the current user, allow access to avoid
      // false negatives from transient RPC/RLS issues.
      if (isCloudDocument && userRole !== 'admin') {
        const { data: { user } } = await supabase.auth.getUser();
        const localOwnerId = (document as any)?.userId;
        if (user?.id && localOwnerId && String(localOwnerId) === String(user.id)) {
          return document;
        }

        const hasAccess = await canAccessDocument(id);
        if (!hasAccess) {
          console.warn(`RBAC: Access denied to document ${id} for role ${userRole}`);
          return null;
        }
      }
      
      return document;
    } catch (err) {
      console.error('Failed to get document:', err);
      return null;
    }
  }, [userRole]);

  /**
   * RBAC: Delete Document with Access Validation
   * 
   * Access control:
   * - Users can only delete their own documents
   * - Admins can delete any document
   * - Vendors can delete docs they own
   * 
   * Note: RLS policies on Supabase enforce this server-side,
   * but we validate client-side for better UX and error handling.
   */
  const removeDocument = useCallback(async (id: string): Promise<boolean> => {
    try {
      console.log('[useDocument] Deleting document:', id);
      
      // For local documents, skip RBAC check (local SQLite storage)
      // UUID format check: cloud docs use UUIDs, local use generateId() format
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
      
      if (isUUID && userRole !== 'admin') {
        // Only check RBAC for cloud documents
        const hasAccess = await canAccessDocument(id);
        if (!hasAccess) {
          console.warn(`RBAC: Delete denied for document ${id} - insufficient permissions`);
          return false;
        }
      }
      
      await deleteDocument(id);
      console.log('[useDocument] Document deleted successfully:', id);
      // Refresh the documents list
      await loadDocuments();
      return true;
    } catch (err) {
      console.error('[useDocument] Failed to delete document:', err);
      return false;
    }
  }, [loadDocuments, userRole]);

  /**
   * RBAC: Delete All Documents
   * 
   * For regular users: Deletes all of their OWN documents
   * For admins: Can delete all documents in the system
   * 
   * Uses soft delete - sets deleted_at timestamp
   */
  const removeAllDocuments = useCallback(async (): Promise<boolean> => {
    try {
      // Users can delete all their OWN documents
      // The deleteAllDocuments function respects RLS and only deletes user's docs
      console.log('[useDocument] Deleting all documents for current user...');
      
      await deleteAllDocuments();
      
      // Refresh the documents list
      await loadDocuments();
      
      console.log('[useDocument] All documents deleted successfully');
      return true;
    } catch (err) {
      console.error('Failed to delete all documents:', err);
      return false;
    }
  }, [loadDocuments]);

  return {
    documents,
    isLoading,
    error,
    uploadProgress,
    uploadMessage,
    uploadDocument,
    getDocument,
    removeDocument,
    removeAllDocuments,
    refreshDocuments:  loadDocuments,
  };
};
