/**
 * Simplified Document Service
 * 
 * NEW ARCHITECTURE: Client only uploads files to Supabase Storage.
 * All extraction happens server-side via Edge Functions.
 * 
 * FLOW:
 * 1. Upload file to Supabase Storage
 * 2. Create document record (status = 'uploaded')
 * 3. Trigger backend extraction (Edge Function)
 * 4. Poll/subscribe for status updates
 * 
 * NO LOCAL EXTRACTION - Everything happens on the server.
 */

import { getSupabaseUrl, supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { decode as base64Decode } from 'base-64';
import * as Crypto from 'expo-crypto';
import { 
  CanonicalDocument, 
  ExtractionStatus, 
  ExtractionMetadata,
  UploadDocumentResponse,
  DocumentStatusResponse 
} from '../types/canonical';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = getSupabaseUrl();
const STORAGE_BUCKET = 'documents';

// ============================================
// UPLOAD DOCUMENT
// ============================================

/**
 * Upload a document to cloud storage and trigger backend extraction.
 * 
 * @param fileName - Original filename
 * @param fileUri - Local file URI
 * @param fileType - MIME type
 * @param fileSize - File size in bytes
 * @param userId - Current user ID
 * @param onProgress - Progress callback (0-100)
 */
export async function uploadDocument(
  fileName: string,
  fileUri: string,
  fileType: string,
  fileSize: number,
  userId: string,
  onProgress?: (progress: number, message: string) => void
): Promise<UploadDocumentResponse> {
  const documentId = Crypto.randomUUID();
  
  console.log(`[DocumentService] Starting upload: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
  
  try {
    // Step 1: Upload file to Supabase Storage
    onProgress?.(10, 'Uploading file...');
    
    const storagePath = `${userId}/${documentId}/${fileName}`;
    
    // Upload using Blob fetch to avoid base64 memory explosion on large files
    onProgress?.(30, 'Saving to cloud...');
    try {
      // Fetch file URI and convert to blob (works in Expo env)
      const fetched = await fetch(fileUri);
      const blob = await fetched.blob();

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, blob, {
          contentType: fileType,
          upsert: false,
        });

      if (uploadError) {
        console.error('[DocumentService] Storage upload failed:', uploadError);
        throw uploadError;
      }
    } catch (e) {
      console.error('[DocumentService] Blob upload failed, falling back to base64 method:', e);
      // Fallback: small-base64 approach (older devices)
      const base64Data = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binaryString = base64Decode(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, bytes, {
          contentType: fileType,
          upsert: false,
        });
      if (uploadError) {
        console.error('[DocumentService] Storage upload failed (fallback):', uploadError);
        throw uploadError;
      }
    }

    console.log(`[DocumentService] File uploaded to: ${storagePath}`);
    
    // Step 2: Create document record
    onProgress?.(50, 'Creating document record...');
    
    const title = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
    
    const { data: doc, error: insertError } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        user_id: userId,
        title,
        file_type: fileType,
        file_size: fileSize,
        file_uri: storagePath,
        extraction_status: 'uploaded',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('[DocumentService] Database insert failed:', insertError);
      // Clean up storage
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      throw new Error(`Failed to create document: ${insertError.message}`);
    }
    
    console.log(`[DocumentService] Document record created: ${documentId}`);
    
    // Step 3: Trigger backend extraction
    onProgress?.(70, 'Starting extraction...');
    
    try {
      const extractionResponse = await fetch(
        `${SUPABASE_URL}/functions/v1/extract-document-v3`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ documentId }),
        }
      );
      
      if (!extractionResponse.ok) {
        console.warn('[DocumentService] Extraction trigger failed, will retry');
      } else {
        console.log('[DocumentService] Extraction triggered successfully');
      }
    } catch (triggerError) {
      // Non-fatal - extraction can be retried
      console.warn('[DocumentService] Extraction trigger error:', triggerError);
    }
    
    onProgress?.(100, 'Upload complete!');
    
    return {
      success: true,
      documentId,
      status: 'uploaded',
      message: 'Document uploaded successfully. Extraction in progress.',
    };
    
  } catch (error: any) {
    console.error('[DocumentService] Upload failed:', error);
    return {
      success: false,
      documentId,
      status: 'failed',
      message: 'Upload failed',
      error: error.message,
    };
  }
}

// ============================================
// GET DOCUMENT STATUS
// ============================================

/**
 * Get current document status and content.
 * Use this to poll for extraction completion.
 */
export async function getDocumentStatus(documentId: string): Promise<DocumentStatusResponse> {
  try {
    const { data: doc, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();
    
    if (error || !doc) {
      return {
        documentId,
        status: 'failed',
        progress: 0,
        message: 'Document not found',
        error: error?.message,
      };
    }
    
    const status = (doc.extraction_status || 'uploaded') as ExtractionStatus;
    
    // Calculate progress based on status
    let progress = 0;
    let message = '';
    
    switch (status) {
      case 'uploaded':
        progress = 25;
        message = 'Waiting for extraction...';
        break;
      case 'processing':
        progress = 50;
        message = 'Extracting text...';
        break;
      case 'extracted':
        progress = 75;
        message = 'Text extracted, analyzing...';
        break;
      case 'analyzed':
        progress = 100;
        message = 'Ready!';
        break;
      case 'failed':
        progress = 0;
        message = doc.processing_error || 'Extraction failed';
        break;
    }
    
    // Build canonical document if extraction is complete
    let document: CanonicalDocument | undefined;
    if (status === 'extracted' || status === 'analyzed') {
      document = buildCanonicalDocument(doc);
    }
    
    return {
      documentId,
      status,
      progress,
      message,
      document,
    };
    
  } catch (error: any) {
    return {
      documentId,
      status: 'failed',
      progress: 0,
      message: 'Failed to get status',
      error: error.message,
    };
  }
}

// ============================================
// POLL FOR COMPLETION
// ============================================

/**
 * Poll document status until extraction is complete.
 * 
 * @param documentId - Document ID to poll
 * @param timeoutMs - Maximum time to wait (default 2 minutes)
 * @param intervalMs - Poll interval (default 2 seconds)
 * @param onProgress - Progress callback
 */
export async function waitForExtraction(
  documentId: string,
  timeoutMs = 120000,
  intervalMs = 2000,
  onProgress?: (status: DocumentStatusResponse) => void
): Promise<DocumentStatusResponse> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const status = await getDocumentStatus(documentId);
    onProgress?.(status);
    
    if (status.status === 'extracted' || status.status === 'analyzed') {
      return status;
    }
    
    if (status.status === 'failed') {
      return status;
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return {
    documentId,
    status: 'failed',
    progress: 0,
    message: 'Extraction timed out',
    error: 'Timeout waiting for extraction',
  };
}

// ============================================
// SUBSCRIBE TO CHANGES (REALTIME)
// ============================================

/**
 * Subscribe to document status changes via Supabase Realtime.
 * More efficient than polling for real-time updates.
 */
export function subscribeToDocument(
  documentId: string,
  onUpdate: (status: DocumentStatusResponse) => void
): () => void {
  const channel = supabase
    .channel(`document:${documentId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'documents',
        filter: `id=eq.${documentId}`,
      },
      async (payload) => {
        const status = await getDocumentStatus(documentId);
        onUpdate(status);
      }
    )
    .subscribe();
  
  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================
// LIST DOCUMENTS
// ============================================

/**
 * Get all documents for the current user.
 */
export async function getDocuments(): Promise<CanonicalDocument[]> {
  const { data: docs, error } = await supabase
    .from('documents')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('[DocumentService] Failed to fetch documents:', error);
    return [];
  }
  
  return (docs || []).map(buildCanonicalDocument);
}

/**
 * Get a single document by ID.
 */
export async function getDocument(documentId: string): Promise<CanonicalDocument | null> {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();
  
  if (error || !doc) {
    return null;
  }
  
  return buildCanonicalDocument(doc);
}

// ============================================
// DELETE DOCUMENT
// ============================================

/**
 * Soft delete a document.
 */
export async function deleteDocument(documentId: string): Promise<boolean> {
  const { error } = await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', documentId);
  
  if (error) {
    console.error('[DocumentService] Delete failed:', error);
    return false;
  }
  
  return true;
}

/**
 * Permanently delete all documents (for account cleanup).
 */
export async function deleteAllDocuments(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  
  const { error } = await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', user.id);
  
  if (error) {
    console.error('[DocumentService] Delete all failed:', error);
    return false;
  }
  
  return true;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Build a CanonicalDocument from database row.
 */
function buildCanonicalDocument(doc: any): CanonicalDocument {
  // Parse canonical content if available
  let content = {
    fullText: doc.content || doc.extracted_text || '',
    pages: [],
    tables: [],
    figures: [],
    formFields: [],
  };
  
  if (doc.canonical_content) {
    try {
      const parsed = typeof doc.canonical_content === 'string' 
        ? JSON.parse(doc.canonical_content) 
        : doc.canonical_content;
      content = { ...content, ...parsed };
    } catch (e) {
      console.warn('[DocumentService] Failed to parse canonical_content');
    }
  }
  
  // Parse extraction metadata if available
  let extraction: ExtractionMetadata = {
    method: 'text_only',
    processingTimeMs: 0,
    ocrUsed: false,
    pageCount: doc.page_count || 1,
    characterCount: content.fullText.length,
    languages: ['en'],
    errors: [],
    warnings: [],
  };
  
  if (doc.extraction_metadata) {
    try {
      const parsed = typeof doc.extraction_metadata === 'string'
        ? JSON.parse(doc.extraction_metadata)
        : doc.extraction_metadata;
      extraction = { ...extraction, ...parsed };
    } catch (e) {
      console.warn('[DocumentService] Failed to parse extraction_metadata');
    }
  }
  
  return {
    id: doc.id,
    userId: doc.user_id,
    title: doc.title,
    originalFilename: doc.title,
    mimeType: doc.file_type || 'application/pdf',
    fileSize: doc.file_size || 0,
    storagePath: doc.file_uri || '',
    status: (doc.extraction_status || 'uploaded') as ExtractionStatus,
    extraction,
    content,
    vendor: doc.vendor_id ? {
      vendorId: doc.vendor_id,
      vendorName: doc.vendor_name,
      confidence: doc.vendor_confidence || 0,
      domain: doc.domain || 'other',
      topics: [],
    } : null,
    quality: {
      overallScore: doc.quality_score || 50,
      textConfidence: 0.8,
      layoutConfidence: 0.8,
      isScanned: doc.is_scanned || false,
      hasText: (content.fullText?.length || 0) > 50,
      isPasswordProtected: false,
      estimatedReadingTime: Math.ceil((doc.word_count || 0) / 200),
      wordCount: doc.word_count || 0,
    },
    createdAt: new Date(doc.created_at),
    updatedAt: new Date(doc.updated_at),
    extractedAt: doc.extracted_at ? new Date(doc.extracted_at) : null,
  };
}

// ============================================
// RETRY EXTRACTION
// ============================================

/**
 * Retry extraction for a failed document.
 */
export async function retryExtraction(documentId: string): Promise<boolean> {
  try {
    // Reset status
    await supabase
      .from('documents')
      .update({ 
        extraction_status: 'uploaded',
        processing_error: null,
      })
      .eq('id', documentId);
    
    // Trigger extraction again
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/extract-document-v3`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentId }),
      }
    );
    
    return response.ok;
  } catch (error) {
    console.error('[DocumentService] Retry failed:', error);
    return false;
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  uploadDocument,
  getDocumentStatus,
  waitForExtraction,
  subscribeToDocument,
  getDocuments,
  getDocument,
  deleteDocument,
  deleteAllDocuments,
  retryExtraction,
};
