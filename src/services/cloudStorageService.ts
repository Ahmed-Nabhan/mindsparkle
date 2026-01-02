/**
 * Cloud Storage Service for MindSparkle
 * Handles large file uploads to Supabase Storage with progress tracking
 * 
 * Architecture:
 * - Files < 50MB: Process locally on device
 * - Files >= 50MB: Upload to cloud, extract text server-side
 * 
 * Storage Limits (Supabase Pro):
 * - Free tier: 5GB total storage
 * - Pro tier: 200GB total storage
 * - Max upload size: 5GB per file
 */

import * as FileSystem from 'expo-file-system';
import { supabase, getSupabaseUrl } from './supabase';
import { decode as atob } from 'base-64';

// Size thresholds
export const LOCAL_PROCESSING_LIMIT = 50 * 1024 * 1024; // 50MB - files above this go to cloud
export const FREE_STORAGE_LIMIT = 5 * 1024 * 1024 * 1024; // 5GB total cloud storage
export const PRO_STORAGE_LIMIT = 200 * 1024 * 1024 * 1024; // 200GB total cloud storage
export const MAX_SINGLE_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB max per single file

// Storage bucket name
const STORAGE_BUCKET = 'documents';

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  fileCount: number;
  remainingBytes: number;
  usedPercentage: number;
}

export interface CloudUploadResult {
  success: boolean;
  cloudDocumentId?: string;
  storagePath?: string;
  error?: string;
}

export interface CloudDocument {
  id: string;
  documentId: string;
  title: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  extractedText?: string;
  processingError?: string;
  createdAt: Date;
}

/**
 * Check if a file should be processed in the cloud
 */
export const shouldUseCloudProcessing = (fileSize: number): boolean => {
  return fileSize >= LOCAL_PROCESSING_LIMIT;
};

/**
 * Get current user's storage usage
 */
export const getStorageUsage = async (userId: string): Promise<StorageUsage> => {
  try {
    const { data, error } = await supabase
      .from('user_storage')
      .select('used_bytes, storage_limit_bytes, file_count')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[CloudStorage] Error fetching storage usage:', error);
      throw error;
    }

    const usedBytes = data?.used_bytes || 0;
    const limitBytes = data?.storage_limit_bytes || FREE_STORAGE_LIMIT;
    const fileCount = data?.file_count || 0;
    const remainingBytes = Math.max(0, limitBytes - usedBytes);

    return {
      usedBytes,
      limitBytes,
      fileCount,
      remainingBytes,
      usedPercentage: limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0,
    };
  } catch (error) {
    console.error('[CloudStorage] getStorageUsage error:', error);
    return {
      usedBytes: 0,
      limitBytes: FREE_STORAGE_LIMIT,
      fileCount: 0,
      remainingBytes: FREE_STORAGE_LIMIT,
      usedPercentage: 0,
    };
  }
};

/**
 * Check if user has enough storage for a file
 */
export const checkStorageLimit = async (
  userId: string, 
  fileSize: number
): Promise<{ allowed: boolean; remaining: number; limit: number }> => {
  try {
    const { data, error } = await supabase
      .rpc('check_storage_limit', { p_user_id: userId, p_file_size: fileSize });

    if (error) {
      console.error('[CloudStorage] checkStorageLimit error:', error);
      return { allowed: true, remaining: FREE_STORAGE_LIMIT, limit: FREE_STORAGE_LIMIT };
    }

    const result = data?.[0] || { allowed: true, remaining: FREE_STORAGE_LIMIT, storage_limit: FREE_STORAGE_LIMIT };
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      limit: result.storage_limit,
    };
  } catch (error) {
    console.error('[CloudStorage] checkStorageLimit error:', error);
    return { allowed: true, remaining: FREE_STORAGE_LIMIT, limit: FREE_STORAGE_LIMIT };
  }
};

/**
 * Upload a large file to cloud storage with progress tracking
 * Uses FileSystem.uploadAsync for streaming large files without memory issues
 */
export const uploadLargeFile = async (
  userId: string,
  documentId: string,
  fileUri: string,
  fileName: string,
  fileType: string,
  fileSize: number,
  onProgress?: (progress: number, message: string) => void
): Promise<CloudUploadResult> => {
  try {
    const fileSizeMB = fileSize / (1024 * 1024);
    const fileSizeGB = fileSize / (1024 * 1024 * 1024);
    
    // Check single file size limit
    if (fileSize > MAX_SINGLE_FILE_SIZE) {
      return {
        success: false,
        error: `File too large (${fileSizeGB.toFixed(1)}GB). Maximum file size is 5GB per file.`,
      };
    }
    
    onProgress?.(5, 'Checking storage limit...');

    // Check storage limit
    const { allowed, remaining, limit } = await checkStorageLimit(userId, fileSize);
    
    if (!allowed) {
      const limitGB = (limit / (1024 * 1024 * 1024)).toFixed(1);
      const usedGB = ((limit - remaining) / (1024 * 1024 * 1024)).toFixed(1);
      const remainingGB = (remaining / (1024 * 1024 * 1024)).toFixed(1);
      const fileSizeDisplay = fileSizeMB > 1024 ? `${fileSizeGB.toFixed(1)}GB` : `${fileSizeMB.toFixed(0)}MB`;
      
      return {
        success: false,
        error: `Not enough storage space.\n\nFile size: ${fileSizeDisplay}\nAvailable: ${remainingGB}GB\nUsed: ${usedGB}GB of ${limitGB}GB\n\nUpgrade to Pro for 200GB storage.`,
      };
    }

    onProgress?.(10, 'Preparing upload...');

    // Generate unique storage path
    const timestamp = Date.now();
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${userId}/${timestamp}_${sanitizedName}`;

    // Create cloud document record first
    const { data: cloudDoc, error: docError } = await supabase
      .from('cloud_documents')
      .insert({
        user_id: userId,
        document_id: documentId,
        title: fileName,
        file_type: fileType,
        file_size: fileSize,
        storage_path: storagePath,
        status: 'uploading',
      })
      .select('id')
      .single();

    if (docError) {
      console.error('[CloudStorage] Error creating cloud document:', docError);
      return { success: false, error: 'Failed to initialize upload' };
    }

    onProgress?.(15, 'Uploading to cloud...');

    console.log(`[CloudStorage] Uploading ${fileSizeMB.toFixed(1)}MB file using streaming upload`);

    try {
      // Get auth session for the upload
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No authentication session. Please sign in again.');
      }

      // Get Supabase URL
      const supabaseUrl = getSupabaseUrl();
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`;

      onProgress?.(20, 'Uploading file...');

      // Use FileSystem.uploadAsync for streaming - handles large files without memory issues
      const uploadResult = await FileSystem.uploadAsync(uploadUrl, fileUri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': fileType,
          'x-upsert': 'true',
        },
      });

      console.log('[CloudStorage] Upload response status:', uploadResult.status);
      console.log('[CloudStorage] Upload response body:', uploadResult.body);

      // Check for success
      if (uploadResult.status !== 200 && uploadResult.status !== 201) {
        let errorMessage = `Upload failed with status ${uploadResult.status}`;
        
        try {
          const parsed = JSON.parse(uploadResult.body);
          errorMessage = parsed.message || parsed.error || errorMessage;
        } catch (e) {
          // Use raw body if not JSON
          if (uploadResult.body) {
            errorMessage = uploadResult.body;
          }
        }
        
        throw new Error(errorMessage);
      }

      onProgress?.(80, 'Upload complete, processing...');

    } catch (uploadErr: any) {
      console.error('[CloudStorage] Upload error:', uploadErr);
      
      // Update cloud document status to error
      await supabase
        .from('cloud_documents')
        .update({ status: 'error', processing_error: uploadErr.message })
        .eq('id', cloudDoc.id);

      // Provide user-friendly error messages
      let errorMessage = uploadErr.message || 'Upload failed';
      
      if (errorMessage.includes('413') || errorMessage.includes('Payload too large') || errorMessage.includes('exceeded')) {
        errorMessage = `File too large (${fileSizeMB.toFixed(0)}MB).\n\nPlease check your Supabase storage bucket settings.\n\nIn Supabase Dashboard:\n1. Go to Storage → Policies\n2. Check the file size limit for the 'documents' bucket\n3. Increase if needed (Pro allows up to 5GB)`;
      } else if (errorMessage.includes('not allowed') || errorMessage.includes('mime')) {
        errorMessage = `File type not supported. Allowed: PDF, PowerPoint, Word, Text files.`;
      } else if (errorMessage.includes('policy') || errorMessage.includes('unauthorized') || errorMessage.includes('403')) {
        errorMessage = `Upload not authorized. Please sign out and sign in again, or check storage policies.`;
      } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        errorMessage = `Network error. Please check your connection and try again.`;
      }

      return { success: false, error: errorMessage };
    }

    // Update status to processing
    await supabase
      .from('cloud_documents')
      .update({ status: 'processing' })
      .eq('id', cloudDoc.id);

    onProgress?.(85, 'Processing document...');

    // Trigger text extraction via edge function
    try {
      const { data: extractResult, error: extractError } = await supabase.functions
        .invoke('extract-text', {
          body: {
            cloudDocumentId: cloudDoc.id,
            storagePath,
            fileType,
          },
        });

      if (extractError) {
        console.warn('[CloudStorage] Text extraction trigger error:', extractError);
      } else {
        console.log('[CloudStorage] Text extraction triggered:', extractResult);
      }
    } catch (extractErr) {
      console.warn('[CloudStorage] Text extraction trigger failed:', extractErr);
    }

    onProgress?.(100, 'Upload complete!');

    return {
      success: true,
      cloudDocumentId: cloudDoc.id,
      storagePath,
    };
  } catch (error: any) {
    console.error('[CloudStorage] uploadLargeFile error:', error);
    return { success: false, error: error.message || 'Upload failed' };
  }
};

/**
 * Get cloud document details
 */
export const getCloudDocument = async (cloudDocumentId: string): Promise<CloudDocument | null> => {
  try {
    const { data, error } = await supabase
      .from('cloud_documents')
      .select('*')
      .eq('id', cloudDocumentId)
      .single();

    if (error) {
      console.error('[CloudStorage] getCloudDocument error:', error);
      return null;
    }

    return {
      id: data.id,
      documentId: data.document_id,
      title: data.title,
      fileType: data.file_type,
      fileSize: data.file_size,
      storagePath: data.storage_path,
      status: data.status,
      extractedText: data.extracted_text,
      processingError: data.processing_error,
      createdAt: new Date(data.created_at),
    };
  } catch (error) {
    console.error('[CloudStorage] getCloudDocument error:', error);
    return null;
  }
};

/**
 * Wait for cloud document processing to complete
 */
export const waitForProcessing = async (
  cloudDocumentId: string,
  maxWaitMs: number = 60000,
  pollIntervalMs: number = 2000
): Promise<CloudDocument | null> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const doc = await getCloudDocument(cloudDocumentId);
    
    if (!doc) return null;
    
    if (doc.status === 'ready') {
      return doc;
    }
    
    if (doc.status === 'error') {
      console.error('[CloudStorage] Processing failed:', doc.processingError);
      return doc;
    }
    
    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  console.warn('[CloudStorage] Timeout waiting for processing');
  return await getCloudDocument(cloudDocumentId);
};

/**
 * Delete a cloud document and its storage file
 */
export const deleteCloudDocument = async (cloudDocumentId: string): Promise<boolean> => {
  try {
    // Get the document first to get the storage path
    const doc = await getCloudDocument(cloudDocumentId);
    if (!doc) return false;

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([doc.storagePath]);

    if (storageError) {
      console.warn('[CloudStorage] Storage delete error:', storageError);
    }

    // Delete the database record
    const { error: dbError } = await supabase
      .from('cloud_documents')
      .delete()
      .eq('id', cloudDocumentId);

    if (dbError) {
      console.error('[CloudStorage] Database delete error:', dbError);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[CloudStorage] deleteCloudDocument error:', error);
    return false;
  }
};

/**
 * Get list of user's cloud documents
 */
export const getUserCloudDocuments = async (userId: string): Promise<CloudDocument[]> => {
  try {
    const { data, error } = await supabase
      .from('cloud_documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[CloudStorage] getUserCloudDocuments error:', error);
      return [];
    }

    return data.map(item => ({
      id: item.id,
      documentId: item.document_id,
      title: item.title,
      fileType: item.file_type,
      fileSize: item.file_size,
      storagePath: item.storage_path,
      status: item.status,
      extractedText: item.extracted_text,
      processingError: item.processing_error,
      createdAt: new Date(item.created_at),
    }));
  } catch (error) {
    console.error('[CloudStorage] getUserCloudDocuments error:', error);
    return [];
  }
};

/**
 * Download file URL (signed URL for temporary access)
 */
export const getDownloadUrl = async (storagePath: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, 3600); // 1 hour expiry

    if (error) {
      console.error('[CloudStorage] getDownloadUrl error:', error);
      return null;
    }

    return data.signedUrl;
  } catch (error) {
    console.error('[CloudStorage] getDownloadUrl error:', error);
    return null;
  }
};

/**
 * Format bytes to human-readable string
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/**
 * Update user's storage limit based on premium status
 */
export const updateStorageLimit = async (userId: string, isPremium: boolean): Promise<void> => {
  try {
    const newLimit = isPremium ? PRO_STORAGE_LIMIT : FREE_STORAGE_LIMIT;
    
    const { error } = await supabase
      .from('user_storage')
      .upsert({
        user_id: userId,
        storage_limit_bytes: newLimit,
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('[CloudStorage] updateStorageLimit error:', error);
    }
  } catch (error) {
    console.error('[CloudStorage] updateStorageLimit error:', error);
  }
};
