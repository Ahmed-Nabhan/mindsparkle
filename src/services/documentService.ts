/**
 * Document Intelligence Service - SINGLE ENTRY POINT
 * 
 * This is the ONLY service that should be called from UI/hooks for document operations.
 * All document operations flow through this service:
 * 
 *   UI → documentIntelligenceService → Supabase/Edge Functions
 * 
 * ARCHITECTURE RULES:
 * ✅ All upload/delete/process operations go through here
 * ✅ All AI processing is queued and handled server-side
 * ✅ Realtime updates for status changes
 * ❌ No direct database calls from UI
 * ❌ No AI API calls from frontend
 * 
 * @module services/documentIntelligenceService
 */

import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { 
  vendorDetector, 
  modelRouter, 
  ProcessingMode,
  VendorDetectionResult,
} from './documentIntelligence';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface UploadOptions {
  fileName: string;
  fileUri: string;
  fileType: string;
  fileSize: number;
  uploadId?: string; // For deduplication
}

export interface UploadResult {
  success: boolean;
  documentId: string;
  error?: string;
  document?: {
    id: string;
    title: string;
    fileType: string;
    fileSize: number;
    extractionStatus: string;
  };
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface DocumentStatus {
  id: string;
  title: string;
  extractionStatus: 'pending' | 'processing' | 'completed' | 'failed';
  hasText: boolean;
  textLength: number;
  vendor?: VendorDetectionResult;
  aiOutputs: string[]; // Available AI output types
}

export interface ProcessingStatus {
  documentId: string;
  status: 'idle' | 'uploading' | 'extracting' | 'processing' | 'complete' | 'error';
  progress: number;
  message: string;
  currentMode?: ProcessingMode;
  error?: string;
}

export interface AIOutput {
  type: ProcessingMode;
  content: any;
  modelUsed: string;
  tokensUsed: number;
  createdAt: Date;
}

// Processing status listeners
type StatusCallback = (status: ProcessingStatus) => void;
const statusListeners = new Map<string, Set<StatusCallback>>();

// Current processing status
let currentStatus: ProcessingStatus = {
  documentId: '',
  status: 'idle',
  progress: 0,
  message: '',
};

// ============================================
// VALIDATION UTILITIES
// ============================================

const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'text/plain',
];

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB (server handles chunked processing)
const MIN_FILE_SIZE = 100; // 100 bytes

/**
 * Validate UUID format
 */
function isValidUUID(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Validate file before upload
 */
function validateFile(options: UploadOptions): { valid: boolean; error?: string } {
  // Check file size
  if (options.fileSize < MIN_FILE_SIZE) {
    return { valid: false, error: 'File is empty or too small' };
  }
  
  if (options.fileSize > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  
  // Check file type
  const fileType = options.fileType.toLowerCase();
  const fileName = options.fileName.toLowerCase();
  
  const isAllowedType = ALLOWED_FILE_TYPES.some(t => fileType.includes(t.split('/')[1]));
  const isAllowedExtension = ['.pdf', '.docx', '.pptx', '.doc', '.ppt', '.txt'].some(ext => fileName.endsWith(ext));
  
  if (!isAllowedType && !isAllowedExtension) {
    return { valid: false, error: 'File type not supported. Please upload PDF, Word, PowerPoint, or text files.' };
  }
  
  // Check file name
  if (!options.fileName || options.fileName.length < 3) {
    return { valid: false, error: 'Invalid file name' };
  }
  
  return { valid: true };
}

/**
 * Generate unique upload ID for deduplication
 */
function generateUploadId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================
// STATUS MANAGEMENT
// ============================================

/**
 * Update processing status and notify listeners
 */
function updateStatus(status: Partial<ProcessingStatus>) {
  currentStatus = { ...currentStatus, ...status };
  
  // Notify listeners for this document
  const listeners = statusListeners.get(currentStatus.documentId);
  if (listeners) {
    listeners.forEach(callback => callback(currentStatus));
  }
  
  // Also notify global listeners
  const globalListeners = statusListeners.get('*');
  if (globalListeners) {
    globalListeners.forEach(callback => callback(currentStatus));
  }
}

/**
 * Subscribe to processing status updates
 */
export function subscribeToStatus(
  documentId: string | '*',
  callback: StatusCallback
): () => void {
  if (!statusListeners.has(documentId)) {
    statusListeners.set(documentId, new Set());
  }
  statusListeners.get(documentId)!.add(callback);
  
  // Return unsubscribe function
  return () => {
    statusListeners.get(documentId)?.delete(callback);
  };
}

/**
 * Get current processing status
 */
export function getProcessingStatus(): ProcessingStatus {
  return { ...currentStatus };
}

// ============================================
// LOGGING
// ============================================

interface LogEntry {
  level: 'info' | 'warn' | 'error';
  action: string;
  documentId?: string;
  userId?: string;
  details?: Record<string, any>;
  timestamp: Date;
}

async function log(entry: Omit<LogEntry, 'timestamp'>) {
  const fullEntry: LogEntry = {
    ...entry,
    timestamp: new Date(),
  };
  
  // Console log
  const prefix = `[DocIntelligence] [${entry.level.toUpperCase()}]`;
  if (entry.level === 'error') {
    console.error(prefix, entry.action, entry.details);
  } else if (entry.level === 'warn') {
    console.warn(prefix, entry.action, entry.details);
  } else {
    console.log(prefix, entry.action, entry.details);
  }
  
  // Persist to audit log (fire and forget)
  if (entry.level === 'error' || entry.action.includes('delete') || entry.action.includes('upload')) {
    try {
      await supabase.from('audit_logs').insert({
        user_id: entry.userId,
        action: entry.action,
        entity_type: 'document',
        entity_id: entry.documentId,
        details: entry.details,
      });
    } catch (e) {
      // Silently fail - don't block main operation
    }
  }
}

// ============================================
// UPLOAD DOCUMENT
// ============================================

/**
 * Upload a document - SINGLE ENTRY POINT
 * 
 * Flow:
 * 1. Validate file (type, size, integrity)
 * 2. Check for duplicate upload
 * 3. Upload to Supabase Storage
 * 4. Create document record
 * 5. Trigger text extraction (Edge Function)
 * 6. Return document ID for tracking
 */
export async function uploadDocument(
  options: UploadOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<UploadResult> {
  const uploadId = options.uploadId || generateUploadId();
  let documentId = '';
  
  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Please sign in to upload documents');
    }
    
    const userId = user.id;
    
    await log({
      level: 'info',
      action: 'upload_started',
      userId,
      details: { fileName: options.fileName, fileSize: options.fileSize, uploadId },
    });
    
    // STEP 1: Validate file
    updateStatus({ status: 'uploading', progress: 5, message: 'Validating file...' });
    onProgress?.(5, 'Validating file...');
    
    const validation = validateFile(options);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    // STEP 2: Check for duplicate upload
    updateStatus({ progress: 10, message: 'Checking for duplicates...' });
    onProgress?.(10, 'Checking for duplicates...');
    
    const { data: isDuplicate } = await supabase.rpc('is_duplicate_upload', { p_upload_id: uploadId });
    if (isDuplicate) {
      await log({
        level: 'warn',
        action: 'upload_duplicate_blocked',
        userId,
        details: { uploadId },
      });
      throw new Error('This file is already being uploaded. Please wait.');
    }
    
    // STEP 3: Generate document ID
    documentId = crypto.randomUUID ? crypto.randomUUID() : 
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    
    updateStatus({ documentId, progress: 15, message: 'Uploading file...' });
    onProgress?.(15, 'Uploading file...');
    
    // STEP 4: Read file and upload to Supabase Storage
    const storagePath = `${userId}/${documentId}/${options.fileName}`;
    
    // Read file as base64
    const fileBase64 = await FileSystem.readAsStringAsync(options.fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Convert to blob
    const byteCharacters = atob(fileBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    
    updateStatus({ progress: 40, message: 'Uploading to cloud...' });
    onProgress?.(40, 'Uploading to cloud...');
    
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, byteArray, {
        contentType: options.fileType,
        upsert: false,
      });
    
    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }
    
    // STEP 5: Create document record
    updateStatus({ progress: 60, message: 'Creating document record...' });
    onProgress?.(60, 'Creating document record...');
    
    const title = options.fileName.replace(/\.[^/.]+$/, ''); // Remove extension
    
    const { error: insertError } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        user_id: userId,
        title,
        original_filename: options.fileName,
        file_type: options.fileType,
        file_size: options.fileSize,
        storage_path: storagePath,
        extraction_status: 'pending',
        has_text: false,
        upload_id: uploadId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    
    if (insertError) {
      // Clean up uploaded file
      await supabase.storage.from('documents').remove([storagePath]);
      throw new Error(`Failed to save document: ${insertError.message}`);
    }
    
    // STEP 6: Trigger text extraction via Edge Function
    updateStatus({ status: 'extracting', progress: 70, message: 'Starting text extraction...' });
    onProgress?.(70, 'Starting text extraction...');
    
    // Call Edge Function (fire and forget - extraction happens async)
    supabase.functions
      .invoke('extract-text', {
        body: { documentId },
      })
      .then(({ error }) => {
        if (error) {
          log({
            level: 'error',
            action: 'extraction_trigger_failed',
            documentId,
            userId,
            details: { error: error.message },
          });
        }
      })
      .catch(err => {
        log({
          level: 'error',
          action: 'extraction_trigger_error',
          documentId,
          userId,
          details: { error: err.message },
        });
      });
    
    // STEP 7: Success
    updateStatus({ status: 'complete', progress: 100, message: 'Upload complete!' });
    onProgress?.(100, 'Upload complete!');
    
    await log({
      level: 'info',
      action: 'upload_completed',
      documentId,
      userId,
      details: { fileName: options.fileName, fileSize: options.fileSize },
    });
    
    return {
      success: true,
      documentId,
      document: {
        id: documentId,
        title,
        fileType: options.fileType,
        fileSize: options.fileSize,
        extractionStatus: 'pending',
      },
    };
    
  } catch (error: any) {
    const errorMessage = error.message || 'Upload failed';
    
    updateStatus({ status: 'error', progress: 0, message: errorMessage, error: errorMessage });
    
    await log({
      level: 'error',
      action: 'upload_failed',
      documentId: documentId || undefined,
      details: { error: errorMessage, uploadId },
    });
    
    return {
      success: false,
      documentId: documentId || '',
      error: errorMessage,
    };
  }
}

// ============================================
// DELETE DOCUMENT
// ============================================

/**
 * Delete a document (soft delete)
 * 
 * RBAC:
 * - Users can delete their own documents
 * - Admins can delete any document
 */
export async function deleteDocument(documentId: string): Promise<DeleteResult> {
  try {
    // Validate UUID
    if (!isValidUUID(documentId)) {
      throw new Error('Invalid document ID');
    }
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Please sign in to delete documents');
    }
    
    await log({
      level: 'info',
      action: 'delete_started',
      documentId,
      userId: user.id,
    });
    
    // Call soft_delete_document function (handles RBAC)
    const { data, error } = await supabase.rpc('soft_delete_document', { doc_id: documentId });
    
    if (error) {
      throw new Error(error.message);
    }
    
    await log({
      level: 'info',
      action: 'delete_completed',
      documentId,
      userId: user.id,
    });
    
    return { success: true };
    
  } catch (error: any) {
    const errorMessage = error.message || 'Delete failed';
    
    await log({
      level: 'error',
      action: 'delete_failed',
      documentId,
      details: { error: errorMessage },
    });
    
    return { success: false, error: errorMessage };
  }
}

// ============================================
// GET DOCUMENTS
// ============================================

/**
 * Get all documents for current user
 * RLS handles filtering
 */
export async function getDocuments(): Promise<DocumentStatus[]> {
  const { data, error } = await supabase
    .from('documents')
    .select(`
      id,
      title,
      extraction_status,
      has_text,
      text_length,
      vendor_id,
      vendor_name,
      vendor_confidence,
      file_type,
      file_size,
      created_at
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('[DocIntelligence] Failed to get documents:', error);
    return [];
  }
  
  // Get AI outputs for each document
  const documentIds = data.map(d => d.id);
  const { data: aiOutputs } = await supabase
    .from('document_ai_outputs')
    .select('document_id, output_type')
    .in('document_id', documentIds);
  
  const outputsByDoc = new Map<string, string[]>();
  aiOutputs?.forEach(o => {
    if (!outputsByDoc.has(o.document_id)) {
      outputsByDoc.set(o.document_id, []);
    }
    outputsByDoc.get(o.document_id)!.push(o.output_type);
  });
  
  return data.map(d => ({
    id: d.id,
    title: d.title,
    extractionStatus: d.extraction_status,
    hasText: d.has_text,
    textLength: d.text_length || 0,
    vendor: d.vendor_id ? {
      vendorId: d.vendor_id,
      vendorName: d.vendor_name,
      confidence: d.vendor_confidence,
      detected: true,
    } as VendorDetectionResult : undefined,
    aiOutputs: outputsByDoc.get(d.id) || [],
  }));
}

/**
 * Get a single document by ID
 */
export async function getDocument(documentId: string): Promise<DocumentStatus | null> {
  if (!isValidUUID(documentId)) {
    return null;
  }
  
  const { data, error } = await supabase
    .from('documents')
    .select(`
      id,
      title,
      extraction_status,
      has_text,
      text_length,
      extracted_text,
      vendor_id,
      vendor_name,
      vendor_confidence,
      file_type,
      file_size,
      created_at
    `)
    .eq('id', documentId)
    .is('deleted_at', null)
    .single();
  
  if (error || !data) {
    return null;
  }
  
  // Get AI outputs
  const { data: aiOutputs } = await supabase
    .from('document_ai_outputs')
    .select('output_type')
    .eq('document_id', documentId);
  
  return {
    id: data.id,
    title: data.title,
    extractionStatus: data.extraction_status,
    hasText: data.has_text,
    textLength: data.text_length || 0,
    vendor: data.vendor_id ? {
      vendorId: data.vendor_id,
      vendorName: data.vendor_name,
      confidence: data.vendor_confidence,
      detected: true,
    } as VendorDetectionResult : undefined,
    aiOutputs: aiOutputs?.map(o => o.output_type) || [],
  };
}

// ============================================
// AI PROCESSING
// ============================================

/**
 * Request AI processing for a document
 */
export async function requestAIProcessing(
  documentId: string,
  mode: ProcessingMode,
  options?: Record<string, any>
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    if (!isValidUUID(documentId)) {
      throw new Error('Invalid document ID');
    }
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Please sign in');
    }
    
    // Check if document exists and has text
    const { data: doc } = await supabase
      .from('documents')
      .select('extraction_status, has_text')
      .eq('id', documentId)
      .is('deleted_at', null)
      .single();
    
    if (!doc) {
      throw new Error('Document not found');
    }
    
    if (!doc.has_text) {
      throw new Error('Document text not extracted yet. Please wait for extraction to complete.');
    }
    
    // Queue the processing task
    const { data: task, error } = await supabase
      .from('processing_queue')
      .upsert(
        {
          document_id: documentId,
          job_type: `ai_${mode}`,
          status: 'queued',
          next_run_at: new Date().toISOString(),
          payload: { mode, options: options || {} },
          idempotency_key: `ai:${documentId}:${mode}`,
        },
        { onConflict: 'idempotency_key' }
      )
      .select('id')
      .single();
    
    if (error) {
      // Might be duplicate - check if already exists
      if (error.code === '23505') {
        return { success: true, taskId: 'existing' };
      }
      throw new Error(error.message);
    }
    
    // Trigger Edge Function
    supabase.functions.invoke('openai-proxy', {
      body: { documentId, mode, options, taskId: task.id },
    }).catch(err => {
      log({
        level: 'error',
        action: 'ai_processing_trigger_failed',
        documentId,
        userId: user.id,
        details: { mode, error: err.message },
      });
    });
    
    return { success: true, taskId: task.id };
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get AI output for a document
 */
export async function getAIOutput(
  documentId: string,
  mode: ProcessingMode
): Promise<AIOutput | null> {
  if (!isValidUUID(documentId)) {
    return null;
  }
  
  const { data, error } = await supabase
    .from('document_ai_outputs')
    .select('*')
    .eq('document_id', documentId)
    .eq('output_type', mode)
    .order('version', { ascending: false })
    .limit(1)
    .single();
  
  if (error || !data) {
    return null;
  }
  
  return {
    type: data.output_type as ProcessingMode,
    content: data.content,
    modelUsed: data.model_used,
    tokensUsed: data.tokens_used,
    createdAt: new Date(data.created_at),
  };
}

// ============================================
// REALTIME SUBSCRIPTIONS
// ============================================

/**
 * Subscribe to document changes
 */
export function subscribeToDocuments(
  userId: string,
  onInsert: (doc: any) => void,
  onUpdate: (doc: any) => void,
  onDelete: (docId: string) => void
): () => void {
  const channel = supabase
    .channel(`documents-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'documents',
        filter: `user_id=eq.${userId}`,
      },
      payload => onInsert(payload.new)
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'documents',
        filter: `user_id=eq.${userId}`,
      },
      payload => {
        // Check if soft deleted
        if (payload.new.deleted_at) {
          onDelete(payload.new.id);
        } else {
          onUpdate(payload.new);
        }
      }
    )
    .subscribe();
  
  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================
// EXPORTS
// ============================================

export default {
  uploadDocument,
  deleteDocument,
  getDocuments,
  getDocument,
  requestAIProcessing,
  getAIOutput,
  subscribeToStatus,
  subscribeToDocuments,
  getProcessingStatus,
};
