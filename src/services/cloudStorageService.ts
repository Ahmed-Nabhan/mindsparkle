/**
 * Cloud Storage Service for MindSparkle
 * 
 * Handles file uploads to Supabase Storage with comprehensive features:
 * - Large file streaming uploads (up to 5GB)
 * - Progress tracking with callbacks
 * - Signed URL generation for secure access
 * - Metadata storage in PostgreSQL
 * - Offline caching and sync
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    File Upload Flow                         │
 * ├─────────────────────────────────────────────────────────────┤
 * │  1. User selects file                                       │
 * │  2. Check size: ≤10MB → Local | >10MB → Cloud              │
 * │  3. Validate storage quota                                  │
 * │  4. Create metadata record in PostgreSQL                   │
 * │  5. Stream upload to Supabase Storage                      │
 * │  6. Trigger server-side text extraction                    │
 * │  7. Generate signed URL for access                         │
 * │  8. Return result to caller                                │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * STORAGE LIMITS:
 * - Free tier: 5GB total storage
 * - Pro tier: 200GB total storage  
 * - Max single file: 5GB
 * - Local processing: ≤10MB
 * 
 * @module services/cloudStorageService
 */

import * as FileSystem from 'expo-file-system';
import { 
  supabase, 
  getSupabaseUrl,
  getSupabaseAnonKey,
  createDocument,
  updateDocument,
  getSignedUrl as getSupabaseSignedUrl,
} from './supabase';
import { decode as atob } from 'base-64';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExtractedData } from '../types/document';

// ============================================
// CONSTANTS
// ============================================

/**
 * Size threshold for local vs cloud processing
 * Files ≤10MB are processed locally for speed
 * Files >10MB are uploaded to cloud storage
 */
export const LOCAL_PROCESSING_LIMIT = 10 * 1024 * 1024; // 10MB

/**
 * Storage limits by tier
 */
export const FREE_STORAGE_LIMIT = 5 * 1024 * 1024 * 1024; // 5GB
export const PRO_STORAGE_LIMIT = 200 * 1024 * 1024 * 1024; // 200GB
export const MAX_SINGLE_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

/**
 * Supabase Storage bucket name
 * Must match bucket created in Supabase dashboard
 */
const STORAGE_BUCKET = 'documents';

/**
 * Signed URL expiry time (1 hour default)
 */
const SIGNED_URL_EXPIRY = 3600;

/**
 * AsyncStorage key for offline upload queue
 */
const OFFLINE_QUEUE_KEY = '@mindsparkle_upload_queue';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * User's storage usage statistics
 */
export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  fileCount: number;
  remainingBytes: number;
  usedPercentage: number;
}

/**
 * Result of a cloud upload operation
 */
export interface CloudUploadResult {
  success: boolean;
  cloudDocumentId?: string;
  storagePath?: string;
  signedUrl?: string;
  publicUrl?: string;
  extractedText?: string;
  extractedData?: ExtractedData;
  status?: CloudDocument['status'];
  error?: string;
}

/**
 * Cloud document metadata stored in PostgreSQL
 */
export interface CloudDocument {
  id: string;
  documentId: string;
  title: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  status: 'uploading' | 'processing' | 'ready' | 'completed' | 'error';
  extractedText?: string;
  processingError?: string;
  createdAt: Date;
  signedUrl?: string;
}

/**
 * Queued upload for offline sync
 */
export interface QueuedUpload {
  id: string;
  userId: string;
  documentId: string;
  fileUri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  queuedAt: number;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Determine if a file should be uploaded to cloud storage
 * Based on file size threshold (10MB)
 * 
 * @param fileSize - File size in bytes
 * @returns true if file should use cloud storage
 * 
 * @example
 * if (shouldUseCloudProcessing(file.size)) {
 *   await uploadLargeFile(...);
 * } else {
 *   processLocally(file);
 * }
 */
export const shouldUseCloudProcessing = (fileSize: number): boolean => {
  return fileSize >= LOCAL_PROCESSING_LIMIT;
};

/**
 * Format bytes to human-readable string
 * 
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 GB")
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/**
 * Generate unique storage path for file
 * Format: userId/timestamp_sanitizedFileName
 * 
 * @param userId - User's unique ID
 * @param fileName - Original file name
 * @returns Sanitized storage path
 */
const generateStoragePath = (userId: string, fileName: string): string => {
  const timestamp = Date.now();
  // Remove special characters that might cause issues
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${userId}/${timestamp}_${sanitizedName}`;
};

// ============================================
// STORAGE QUOTA FUNCTIONS
// ============================================

/**
 * Get current user's storage usage
 * Fetches from user_storage table in PostgreSQL
 * 
 * @param userId - User ID to check
 * @returns Storage usage statistics
 */
export const getStorageUsage = async (userId: string): Promise<StorageUsage> => {
  try {
    // Query user_storage table for usage stats
    const { data, error } = await supabase
      .from('user_storage')
      .select('used_bytes, storage_limit_bytes, file_count')
      .eq('user_id', userId)
      .single();

    // Handle case where user has no storage record yet
    if (error && error.code !== 'PGRST116') {
      console.error('[CloudStorage] Error fetching storage usage:', error);
      throw error;
    }

    // Calculate usage statistics
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
    // Return default free tier limits on error
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
 * Check if user has enough storage quota for a file
 * Uses PostgreSQL function for atomic check
 * 
 * @param userId - User ID to check
 * @param fileSize - Size of file to upload in bytes
 * @returns Object with allowed status and remaining space
 */
export const checkStorageLimit = async (
  userId: string, 
  fileSize: number
): Promise<{ allowed: boolean; remaining: number; limit: number }> => {
  try {
    // Call PostgreSQL function for atomic check
    const { data, error } = await supabase
      .rpc('check_storage_limit', { p_user_id: userId, p_file_size: fileSize });

    if (error) {
      console.error('[CloudStorage] checkStorageLimit error:', error);
      // Allow on error (fail open for UX, server will validate)
      return { allowed: true, remaining: FREE_STORAGE_LIMIT, limit: FREE_STORAGE_LIMIT };
    }

    const result = data?.[0] || { 
      allowed: true, 
      remaining: FREE_STORAGE_LIMIT, 
      storage_limit: FREE_STORAGE_LIMIT 
    };
    
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
 * Update user's storage limit based on premium status
 * Called when user upgrades/downgrades subscription
 * 
 * @param userId - User ID to update
 * @param isPremium - Whether user has premium subscription
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
    } else {
      console.log(`[CloudStorage] Updated storage limit for ${userId}: ${formatBytes(newLimit)}`);
    }
  } catch (error) {
    console.error('[CloudStorage] updateStorageLimit error:', error);
  }
};

// ============================================
// FILE UPLOAD FUNCTIONS
// ============================================

/**
 * Upload a large file to Supabase Storage with progress tracking
 * 
 * Uses FileSystem.uploadAsync for streaming to handle files up to 5GB
 * without memory issues. Progress is reported via callback.
 * 
 * UPLOAD FLOW:
 * 1. Validate file size (max 5GB)
 * 2. Check user's storage quota
 * 3. Generate unique storage path
 * 4. Create metadata record in cloud_documents table
 * 5. Stream upload to Supabase Storage
 * 6. Trigger server-side text extraction
 * 7. Generate signed URL for access
 * 8. Return result with all metadata
 * 
 * @param userId - User ID performing the upload
 * @param documentId - Unique ID for this document
 * @param fileUri - Local file URI (from document picker)
 * @param fileName - Original file name
 * @param fileType - MIME type (e.g., 'application/pdf')
 * @param fileSize - File size in bytes
 * @param onProgress - Optional callback for progress updates
 * @param isPro - Whether user has Pro subscription (for premium OCR)
 * @returns Upload result with cloud document ID and URLs
 * 
 * @example
 * const result = await uploadLargeFile(
 *   user.id,
 *   'doc_123',
 *   file.uri,
 *   'document.pdf',
 *   'application/pdf',
 *   15000000,
 *   (progress, message) => console.log(`${progress}%: ${message}`),
 *   true // isPro
 * );
 */
export const uploadLargeFile = async (
  userId: string,
  documentId: string,
  fileUri: string,
  fileName: string,
  fileType: string,
  fileSize: number,
  onProgress?: (progress: number, message: string) => void,
  isPro: boolean = false,
  abortSignal?: AbortSignal
): Promise<CloudUploadResult> => {
  try {
    let extractedTextForReturn: string | undefined;
    let extractedDataForReturn: ExtractedData | undefined;
    let statusForReturn: CloudDocument['status'] | undefined;
    if (abortSignal?.aborted) {
      return { success: false, error: 'Upload cancelled' };
    }
    // Calculate readable file sizes for messages
    const fileSizeMB = fileSize / (1024 * 1024);
    const fileSizeGB = fileSize / (1024 * 1024 * 1024);
    
    // ========================================
    // STEP 1: Validate file size
    // ========================================
    if (fileSize > MAX_SINGLE_FILE_SIZE) {
      return {
        success: false,
        error: `File too large (${fileSizeGB.toFixed(1)}GB). Maximum file size is 5GB per file.`,
      };
    }
    
    onProgress?.(5, 'Checking storage limit...');

    // ========================================
    // STEP 2: Check storage quota
    // ========================================
    const { allowed, remaining, limit } = await checkStorageLimit(userId, fileSize);
    
    if (!allowed) {
      // Format helpful error message with quota details
      const limitGB = (limit / (1024 * 1024 * 1024)).toFixed(1);
      const usedGB = ((limit - remaining) / (1024 * 1024 * 1024)).toFixed(1);
      const remainingGB = (remaining / (1024 * 1024 * 1024)).toFixed(1);
      const fileSizeDisplay = fileSizeMB > 1024 
        ? `${fileSizeGB.toFixed(1)}GB` 
        : `${fileSizeMB.toFixed(0)}MB`;
      
      return {
        success: false,
        error: `Not enough storage space.\n\nFile size: ${fileSizeDisplay}\nAvailable: ${remainingGB}GB\nUsed: ${usedGB}GB of ${limitGB}GB\n\nUpgrade to Pro for 200GB storage.`,
      };
    }

    onProgress?.(10, 'Preparing upload...');

    // ========================================
    // STEP 3: Generate storage path
    // ========================================
    const storagePath = generateStoragePath(userId, fileName);

    // ========================================
    // STEP 4: Create metadata record
    // ========================================
    // Insert record first to track upload status
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

    const cloudDocumentId = cloudDoc.id;
    console.log(`[CloudStorage] Created cloud document: ${cloudDocumentId}`);

    onProgress?.(15, 'Uploading to cloud...');

    // ========================================
    // STEP 5: Stream upload to storage
    // ========================================
    console.log(`[CloudStorage] Uploading ${fileSizeMB.toFixed(1)}MB file using streaming upload`);

    try {
      if (abortSignal?.aborted) {
        throw new Error('Upload cancelled');
      }
      // Get auth session for authorization header
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No authentication session. Please sign in again.');
      }

      // Construct upload URL
      const supabaseUrl = getSupabaseUrl();
      const supabaseAnonKey = getSupabaseAnonKey();
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`;

      onProgress?.(20, 'Uploading file...');

        // This Expo build does not support createUploadResumable reliably.
        // Use uploadAsync to avoid crashing, with a size-based timeout.
        const UPLOAD_TIMEOUT_MS = Math.min(
          60 * 60 * 1000, // cap at 60 minutes
          Math.max(10 * 60 * 1000, Math.round(fileSizeMB) * 20 * 1000) // 10m min, ~20s/MB
        );

        const uploadPromise = FileSystem.uploadAsync(uploadUrl, fileUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            apikey: supabaseAnonKey,
            'Content-Type': fileType,
            'x-upsert': 'true',
          },
        });

        const timeoutPromise = new Promise<FileSystem.FileSystemUploadResult>((_, reject) => {
          const id = setTimeout(() => {
            clearTimeout(id);
            reject(new Error('Upload timed out. Please try again on a stable connection.'));
          }, UPLOAD_TIMEOUT_MS);
        });

        const uploadResult = await Promise.race([uploadPromise, timeoutPromise]);

        console.log('[CloudStorage] Upload response status:', uploadResult.status);

        // Check for upload errors
        if (uploadResult.status !== 200 && uploadResult.status !== 201) {
          let errorMessage = `Upload failed with status ${uploadResult.status}`;
          
          try {
            const parsed = JSON.parse(uploadResult.body);
            errorMessage = parsed.message || parsed.error || errorMessage;
          } catch {
            if (uploadResult.body) {
              errorMessage = uploadResult.body;
            }
          }
          
          throw new Error(errorMessage);
        }

        onProgress?.(80, 'Upload complete, processing...');

    } catch (uploadErr: any) {
      console.error('[CloudStorage] Upload error:', uploadErr);
      
      // Update status to error in database
      await supabase
        .from('cloud_documents')
        .update({ 
          status: 'error', 
          processing_error: uploadErr.message 
        })
        .eq('id', cloudDocumentId);

      // Map to user-friendly error messages
      let errorMessage = uploadErr.message || 'Upload failed';
      
      if (errorMessage.includes('413') || errorMessage.includes('Payload too large')) {
        errorMessage = `File too large (${fileSizeMB.toFixed(0)}MB). Please check Supabase storage bucket settings.`;
      } else if (errorMessage.includes('not allowed') || errorMessage.includes('mime')) {
        errorMessage = `File type not supported. Allowed: PDF, PowerPoint, Word, Text files.`;
      } else if (errorMessage.includes('policy') || errorMessage.includes('403')) {
        errorMessage = `Upload not authorized. Please sign out and sign in again.`;
      } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        errorMessage = `Network error. Please check your connection and try again.`;
      }

      return { success: false, error: errorMessage };
    }

    if (abortSignal?.aborted) {
      // Best-effort cancellation: upload already happened, but stop further processing.
      return { success: false, error: 'Upload cancelled' };
    }

    // ========================================
    // STEP 6: Update status and call Document Intelligence
    // ========================================
    await supabase
      .from('cloud_documents')
      .update({ status: 'processing' })
      .eq('id', cloudDocumentId);

    onProgress?.(85, 'Processing document...');

    // ALWAYS call Document Intelligence for extraction
    // Python-based extraction: python-pptx, python-docx, Document AI for PDF
    console.log(`[CloudStorage] Processing ${fileSizeMB.toFixed(1)}MB file with Document Intelligence...`);
    onProgress?.(86, 'Processing with Document Intelligence...');
    
    try {
      // Get a signed URL for the file
      const { data: signedUrlData } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, 1800); // 30 minute expiry
      
        if (!signedUrlData?.signedUrl) {
          throw new Error('Failed to create signed URL for Document Intelligence');
        }
        
        // Call NEW Document Intelligence service (replaces old OCR service)
        const { Config } = await import('./config');
        const docIntelUrl = Config.DOCUMENT_INTELLIGENCE_URL || 'https://mindsparkle-document-intelligence-900398462112.us-central1.run.app';
        
        console.log(`[CloudStorage] Calling Document Intelligence: ${docIntelUrl}/extract`);
        onProgress?.(88, 'Extracting text with Document Intelligence...');
        
        // Send signed URL to Document Intelligence service (it will download the file)
        console.log(`[CloudStorage] Sending file to Document Intelligence: ${fileName}, type: ${fileType}`);
        
        // Create abort controller with a size-based timeout.
        // Large PDFs can take a long time to download+extract.
        const abortController = new AbortController();
        const docIntelTimeoutMs = Math.min(
          30 * 60 * 1000, // cap at 30 minutes
          Math.max(5 * 60 * 1000, Math.round(fileSizeMB) * 20 * 1000) // 5m min, ~20s/MB
        );
        const timeoutId = setTimeout(() => abortController.abort(), docIntelTimeoutMs);
        
        const ocrResponse = await fetch(`${docIntelUrl}/extract`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            signedUrl: signedUrlData.signedUrl,
            fileName: fileName,
            mimeType: fileType,
          }),
          signal: abortController.signal,
        });
        
        clearTimeout(timeoutId);
        
        const extractResult = await ocrResponse.json();
        console.log(`[CloudStorage] Document Intelligence response:`, JSON.stringify(extractResult).substring(0, 500));
        
        // Document Intelligence returns: { success, canonical: { content: { full_text } } }
        const extractedText = extractResult.canonical?.content?.full_text || 
                             extractResult.document?.text || 
                             extractResult.text || 
                             '';

        // Build page-aware extracted data when available
        const canonical = extractResult?.canonical;
        const canonicalPageCount = canonical?.structure?.page_count;
        const canonicalBlocks = canonical?.content?.text_blocks;
        const canonicalImages = canonical?.structure?.images;
        if (canonical && Array.isArray(canonicalBlocks)) {
          const pagesText: Record<number, string[]> = {};
          for (const block of canonicalBlocks) {
            const pageNumber = Number(block?.page ?? block?.pageNumber ?? 1);
            const text = String(block?.text ?? '').trim();
            if (!text) continue;
            if (!pagesText[pageNumber]) pagesText[pageNumber] = [];
            pagesText[pageNumber].push(text);
          }

          // Optional: attach thumbnails for pages with no extracted text
          const pageThumbs: Record<number, string> = {};
          if (Array.isArray(canonicalImages)) {
            for (const img of canonicalImages) {
              const pageNumber = Number((img as any)?.page ?? (img as any)?.pageNumber ?? 0);
              const type = String((img as any)?.type ?? '').toLowerCase();
              const dataUrl = String((img as any)?.data_url ?? (img as any)?.dataUrl ?? '').trim();
              if (!pageNumber || !Number.isFinite(pageNumber) || pageNumber <= 0) continue;
              if (type !== 'page_thumbnail') continue;
              if (!dataUrl.startsWith('data:image/')) continue;
              if (!pageThumbs[pageNumber]) pageThumbs[pageNumber] = dataUrl;
            }
          }

          const inferredMaxPage = Math.max(1, ...Object.keys(pagesText).map(k => Number(k)).filter(n => Number.isFinite(n) && n > 0));
          const totalPages = (typeof canonicalPageCount === 'number' && canonicalPageCount > 0)
            ? canonicalPageCount
            : inferredMaxPage;

          const pages = Array.from({ length: totalPages }, (_, idx) => {
            const pageNumber = idx + 1;
            const pageText = (pagesText[pageNumber] || []).join('\n\n');
            const thumb = pageThumbs[pageNumber];
            const images = thumb
              ? [{
                  id: `thumb-${pageNumber}`,
                  url: thumb,
                  caption: 'Page thumbnail (no text extracted)',
                  pageNumber,
                  type: 'figure' as const,
                }]
              : [];
            return { pageNumber, text: pageText, images, tables: [] };
          });

          extractedDataForReturn = {
            text: extractedText,
            pages,
            images: [],
            tables: [],
            equations: [],
            totalPages,
          };
        }
        
        // Some legitimate documents are short (e.g., 1-page notes). Treat small-but-nonempty
        // extraction as success rather than failing the whole document.
        if (extractResult.success && extractedText && extractedText.length > 10) {
          console.log(`[CloudStorage] Document Intelligence extracted ${extractedText.length} chars`);
          extractedTextForReturn = extractedText;
          statusForReturn = 'ready';

          // Store a large preview in DB (avoid extreme row sizes), but keep much more
          // than the previous 2MB cap so big textbooks don't lose most of their content.
          const MAX_STORED_EXTRACTED_TEXT = 10 * 1024 * 1024; // 10MB
          const storedExtractedText = extractedText.length > MAX_STORED_EXTRACTED_TEXT
            ? extractedText.substring(0, MAX_STORED_EXTRACTED_TEXT) +
              `\n\n[Note: Text truncated due to size limit. Full document is ${(extractedText.length / (1024 * 1024)).toFixed(1)}MB]`
            : extractedText;
          
          // Update cloud_documents with extracted text
          // IMPORTANT: status must be 'ready' to match waitForProcessing check
          await supabase
            .from('cloud_documents')
            .update({
              status: 'ready',
              extracted_text: storedExtractedText,
              processed_at: new Date().toISOString(),
            })
            .eq('id', cloudDocumentId);
          
          onProgress?.(92, 'Text extraction complete!');
        } else {
          console.warn('[CloudStorage] Document Intelligence returned no text:', extractResult.error || 'unknown error');
          statusForReturn = 'error';
          // Update status to error
          await supabase
            .from('cloud_documents')
            .update({ status: 'error', processing_error: extractResult.error || 'No text extracted' })
            .eq('id', cloudDocumentId);
        }
    } catch (docIntelErr: any) {
      console.error('[CloudStorage] Document Intelligence failed:', docIntelErr.message);
      console.error('[CloudStorage] Full error:', JSON.stringify(docIntelErr, null, 2));
      
      // For large files, extraction failure is not critical - document can still be accessed
      const errorMessage = docIntelErr.name === 'AbortError' 
        ? 'Text extraction timed out (file too large). You can still process the document manually.'
        : docIntelErr.message;
        
      await supabase
        .from('cloud_documents')
        .update({ 
          status: 'error', 
          processing_error: errorMessage 
        })
        .eq('id', cloudDocumentId);

      statusForReturn = 'error';
    }

    // ========================================
    // STEP 7: Generate signed URL
    // ========================================
    onProgress?.(95, 'Generating access URL...');
    
    let signedUrl: string | undefined;
    try {
      const { data: urlData, error: urlError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);
      
      if (!urlError && urlData?.signedUrl) {
        signedUrl = urlData.signedUrl;
      }
    } catch (urlErr) {
      console.warn('[CloudStorage] Signed URL generation failed:', urlErr);
    }

    onProgress?.(100, 'Upload complete!');

    // ========================================
    // STEP 8: Return success result
    // ========================================
    console.log(`[CloudStorage] Upload successful: ${cloudDocumentId}`);
    
    return {
      success: true,
      cloudDocumentId,
      storagePath,
      signedUrl,
      extractedText: extractedTextForReturn,
      extractedData: extractedDataForReturn,
      status: statusForReturn,
    };
  } catch (error: any) {
    console.error('[CloudStorage] uploadLargeFile error:', error);
    return { success: false, error: error.message || 'Upload failed' };
  }
};

// ============================================
// DOCUMENT RETRIEVAL FUNCTIONS
// ============================================

/**
 * Get cloud document details by ID
 * Fetches metadata from cloud_documents table
 * 
 * @param cloudDocumentId - ID of the cloud document
 * @returns Cloud document metadata or null if not found
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

    // Map database fields to CloudDocument interface
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
 * Get all cloud documents for a user
 * Returns documents sorted by creation date (newest first)
 * 
 * @param userId - User ID to fetch documents for
 * @returns Array of cloud documents
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

    // Map all records to CloudDocument interface
    return data.map((item: any) => ({
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

// ============================================
// DOCUMENT PROCESSING FUNCTIONS
// ============================================

/**
 * Wait for cloud document processing to complete
 * Polls the database until status is 'ready' or 'error'
 * 
 * Useful when you need the extracted text immediately after upload
 * 
 * @param cloudDocumentId - Document ID to monitor
 * @param maxWaitMs - Maximum time to wait (default: 60 seconds)
 * @param pollIntervalMs - Polling interval (default: 2 seconds)
 * @returns Processed document or null if timeout/error
 * 
 * @example
 * const doc = await waitForProcessing(cloudDocId, 30000);
 * if (doc?.status === 'ready') {
 *   console.log('Extracted text:', doc.extractedText);
 * }
 */
export const waitForProcessing = async (
  cloudDocumentId: string,
  maxWaitMs: number = 180000, // Increased to 3 minutes for large PDFs
  pollIntervalMs: number = 3000, // Poll every 3 seconds to reduce load
  abortSignal?: AbortSignal
): Promise<CloudDocument | null> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    if (abortSignal?.aborted) {
      throw new Error('Upload cancelled');
    }
    const doc = await getCloudDocument(cloudDocumentId);
    
    if (!doc) return null;
    
    // Check if processing is complete (accept both 'ready' and 'completed')
    if (doc.status === 'ready' || doc.status === 'completed') {
      console.log(`[CloudStorage] Processing complete in ${Date.now() - startTime}ms, status: ${doc.status}`);
      return doc;
    }
    
    // Check for error status
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

// ============================================
// URL GENERATION FUNCTIONS
// ============================================

/**
 * Get a signed URL for secure file download
 * URL expires after the specified duration
 * 
 * Signed URLs provide temporary access to private files
 * without requiring authentication in the URL itself
 * 
 * @param storagePath - Path to file in storage
 * @param expiresIn - Expiry time in seconds (default: 1 hour)
 * @returns Signed URL or null if error
 * 
 * @example
 * const url = await getDownloadUrl('user123/doc.pdf', 7200);
 * // URL valid for 2 hours
 */
export const getDownloadUrl = async (
  storagePath: string,
  expiresIn: number = SIGNED_URL_EXPIRY
): Promise<string | null> => {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, expiresIn);

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
 * Get public URL for a file (if bucket allows public access)
 * Note: Requires bucket to be configured with public read access
 * 
 * @param storagePath - Path to file in storage
 * @returns Public URL string
 */
export const getPublicUrl = (storagePath: string): string => {
  const { data } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);
  
  return data.publicUrl;
};

// ============================================
// DELETE FUNCTIONS
// ============================================

/**
 * Delete a cloud document and its storage file
 * Removes both the metadata record and the actual file
 * 
 * @param cloudDocumentId - ID of document to delete
 * @returns true if successful, false otherwise
 */
export const deleteCloudDocument = async (cloudDocumentId: string): Promise<boolean> => {
  try {
    // First get the document to find storage path
    const doc = await getCloudDocument(cloudDocumentId);
    if (!doc) {
      console.warn('[CloudStorage] Document not found:', cloudDocumentId);
      return false;
    }

    // Delete file from Supabase Storage
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([doc.storagePath]);

    if (storageError) {
      console.warn('[CloudStorage] Storage delete error:', storageError);
      // Continue to delete database record even if storage fails
    }

    // Delete metadata record from PostgreSQL
    const { error: dbError } = await supabase
      .from('cloud_documents')
      .delete()
      .eq('id', cloudDocumentId);

    if (dbError) {
      console.error('[CloudStorage] Database delete error:', dbError);
      return false;
    }

    console.log(`[CloudStorage] Deleted cloud document: ${cloudDocumentId}`);
    return true;
  } catch (error) {
    console.error('[CloudStorage] deleteCloudDocument error:', error);
    return false;
  }
};

// ============================================
// OFFLINE QUEUE FUNCTIONS
// ============================================

/**
 * Add upload to offline queue
 * Called when user is offline but wants to upload a file
 * File will be uploaded when connection is restored
 * 
 * @param upload - Upload details to queue
 */
export const queueOfflineUpload = async (upload: QueuedUpload): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: QueuedUpload[] = stored ? JSON.parse(stored) : [];
    
    queue.push(upload);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    
    console.log(`[CloudStorage] Queued offline upload: ${upload.fileName}`);
  } catch (error) {
    console.error('[CloudStorage] Error queuing offline upload:', error);
  }
};

/**
 * Get all queued offline uploads
 * 
 * @returns Array of queued uploads
 */
export const getOfflineQueue = async (): Promise<QueuedUpload[]> => {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('[CloudStorage] Error getting offline queue:', error);
    return [];
  }
};

/**
 * Remove upload from offline queue after successful sync
 * 
 * @param uploadId - ID of upload to remove
 */
export const removeFromOfflineQueue = async (uploadId: string): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: QueuedUpload[] = stored ? JSON.parse(stored) : [];
    
    const updated = queue.filter(u => u.id !== uploadId);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated));
    
    console.log(`[CloudStorage] Removed from offline queue: ${uploadId}`);
  } catch (error) {
    console.error('[CloudStorage] Error removing from offline queue:', error);
  }
};

/**
 * Process all queued offline uploads
 * Called when network connection is restored
 * 
 * @param onProgress - Optional callback for progress updates
 * @returns Number of successfully synced uploads
 */
export const syncOfflineUploads = async (
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<number> => {
  const queue = await getOfflineQueue();
  if (queue.length === 0) return 0;
  
  console.log(`[CloudStorage] Syncing ${queue.length} offline uploads...`);
  let successCount = 0;
  
  for (let i = 0; i < queue.length; i++) {
    const upload = queue[i];
    onProgress?.(i + 1, queue.length, upload.fileName);
    
    try {
      const result = await uploadLargeFile(
        upload.userId,
        upload.documentId,
        upload.fileUri,
        upload.fileName,
        upload.fileType,
        upload.fileSize
      );
      
      if (result.success) {
        await removeFromOfflineQueue(upload.id);
        successCount++;
        console.log(`[CloudStorage] Synced: ${upload.fileName}`);
      }
    } catch (error) {
      console.error(`[CloudStorage] Failed to sync: ${upload.fileName}`, error);
    }
  }
  
  console.log(`[CloudStorage] Sync complete: ${successCount}/${queue.length} successful`);
  return successCount;
};
