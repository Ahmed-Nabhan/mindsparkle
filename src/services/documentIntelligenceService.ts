/**
 * Document Intelligence Service for MindSparkle
 * 
 * Orchestrates the full AI document processing pipeline:
 * 1. Vendor Detection - Identifies document type (Cisco, AWS, etc.)
 * 2. Multi-Pass Processing - 4-pass validation for accuracy
 * 3. Knowledge Graph Generation - Builds concept relationships
 * 4. Real-time Progress Updates - Via event listeners for DocumentContext
 * 5. Supabase Storage - Persists all AI-generated content
 * 
 * PROCESSING PIPELINE:
 * ┌────────────────────────────────────────────────────────────────────┐
 * │                    AI Processing Pipeline                          │
 * ├────────────────────────────────────────────────────────────────────┤
 * │                                                                     │
 * │  [Document Upload]                                                  │
 * │        │                                                            │
 * │        ▼                                                            │
 * │  ┌──────────────────┐                                               │
 * │  │ 1. VENDOR DETECT │ → Cisco, AWS, Azure, CompTIA, etc.            │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 2. ANALYSIS      │ → Complexity, CLI commands, config blocks     │
 * │  │    (Model Route) │ → Select optimal AI model                     │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 3. MULTI-PASS    │ → Pass 1: Extract → Pass 2: Generate          │
 * │  │    PROCESSING    │ → Pass 3: Validate → Pass 4: Refine           │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 4. KNOWLEDGE     │ → Build concept graph, learning paths         │
 * │  │    GRAPH         │                                               │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 5. STORE TO DB   │ → document_analysis, ai_summaries,            │
 * │  │    (Supabase)    │    knowledge_graphs tables                    │
 * │  └──────────────────┘                                               │
 * │                                                                     │
 * └────────────────────────────────────────────────────────────────────┘
 * 
 * MULTI-PASS PROCESSING (4 Passes):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ Pass 1: EXTRACTION                                              │
 * │   - Extract key concepts, terms, definitions                    │
 * │   - Identify CLI commands and config blocks                     │
 * │   - Tag content by topic/section                                │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Pass 2: GENERATION                                              │
 * │   - Generate mode-specific output (summary, quiz, etc.)         │
 * │   - Use vendor-aware prompts                                    │
 * │   - Apply appropriate formatting                                │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Pass 3: VALIDATION                                              │
 * │   - Check for hallucinations                                    │
 * │   - Verify facts against source                                 │
 * │   - Validate CLI syntax and config accuracy                     │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Pass 4: REFINEMENT                                              │
 * │   - Apply corrections from validation                           │
 * │   - Polish output formatting                                    │
 * │   - Optimize for readability                                    │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * @module services/documentIntelligenceService
 */

import { callApi } from './apiService';
import { supabase } from './supabase';
import Config from './config';
import * as CloudStorage from './cloudStorageService';
import * as PdfService from './pdfService';
import { parseDocument } from './documentParser';
import { generateId } from '../utils/helpers';
import {
  createDocumentIntelligence,
  DocumentIntelligence,
  vendorDetector,
  modelRouter,
  promptBuilder,
  validateContent,
  createKnowledgeGraph,
  generateStoryboard,
  generateVoiceScript,
  ProcessingMode,
  DocumentAnalysis,
  VendorDetectionResult,
  AIModel,
  KnowledgeGraph,
} from './documentIntelligence';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Processing status for real-time UI updates
 * DocumentContext subscribes to these updates
 */
export interface ProcessingStatus {
  status: 'idle' | 'analyzing' | 'processing' | 'validating' | 'storing' | 'complete' | 'error';
  progress: number; // 0-100
  message: string;
  currentPass?: number;
  totalPasses?: number;
  currentMode?: string;
  error?: string;
}

/**
 * Document analysis as stored in Supabase
 */
export interface StoredDocumentAnalysis {
  id: string;
  documentId: string;
  vendorId: string | null;
  vendorName: string | null;
  vendorConfidence: number | null;
  certificationDetected: string | null;
  complexity: string;
  hasCliCommands: boolean;
  hasConfigBlocks: boolean;
  contentLength: number;
  aiModel: string;
  tokensUsed: number | null;
  suggestedModes: string[];
  processingStatus: string;
  processingProgress: number;
  processedAt: Date | null;
}

/**
 * AI summary as stored in Supabase
 */
export interface StoredAISummary {
  id: string;
  documentId: string;
  summaryType: string;
  language: string;
  content: string;
  validationPassed: boolean;
  validationScore: number | null;
  correctionsMAde: number;
  aiModel: string;
  tokensUsed: number | null;
  processingTimeMs: number;
  passesCompleted: number;
}

/**
 * Knowledge graph as stored in Supabase
 */
export interface StoredKnowledgeGraph {
  id: string;
  documentId: string;
  nodes: any[];
  edges: any[];
  rootNodes: string[];
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;
  learningPaths: any[];
  conceptClusters: any[];
}

/**
 * Complete AI processing result
 */
export interface FullProcessingResult {
  success: boolean;
  documentId: string;
  analysis: StoredDocumentAnalysis | null;
  summaries: StoredAISummary[];
  knowledgeGraph: StoredKnowledgeGraph | null;
  error?: string;
}

/**
 * Upload result from documentIntelligenceService.uploadDocument()
 */
export interface UploadResult {
  success: boolean;
  documentId: string;
  document?: {
    id: string;
    title: string;
    content: string;
    fileType: string;
    fileSize: number;
    storagePath?: string;
    extractedText: string;
    vendor?: VendorDetectionResult;
  };
  aiProcessingQueued: boolean;
  error?: string;
}

/**
 * Extracted data from document
 */
export interface ExtractedData {
  text: string;
  pages: Array<{
    pageNumber: number;
    text: string;
    images: any[];
    tables: any[];
  }>;
  images: any[];
  tables: any[];
  equations: any[];
  totalPages: number;
}

/**
 * Progress callback type
 */
type ProgressCallback = (status: ProcessingStatus) => void;

// ============================================
// EVENT LISTENERS FOR REAL-TIME UPDATES
// ============================================

/**
 * Listeners for processing status changes
 * DocumentContext subscribes to receive real-time updates
 */
const processingStatusListeners: ProgressCallback[] = [];

/**
 * Subscribe to processing status changes
 * Called by DocumentContext to receive real-time updates
 * 
 * @param listener - Callback function receiving ProcessingStatus
 * @returns Unsubscribe function
 * 
 * @example
 * // In DocumentContext:
 * useEffect(() => {
 *   const unsubscribe = onProcessingStatusChange((status) => {
 *     setProcessingStatus(status);
 *   });
 *   return unsubscribe;
 * }, []);
 */
export const onProcessingStatusChange = (listener: ProgressCallback): (() => void) => {
  processingStatusListeners.push(listener);
  return () => {
    const index = processingStatusListeners.indexOf(listener);
    if (index > -1) processingStatusListeners.splice(index, 1);
  };
};

/**
 * Notify all listeners of status change
 */
const notifyStatusChange = (status: ProcessingStatus): void => {
  processingStatusListeners.forEach(listener => {
    try {
      listener(status);
    } catch (error) {
      console.error('[DocIntelligenceService] Error in status listener:', error);
    }
  });
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Current processing status (singleton)
 */
let currentProcessingStatus: ProcessingStatus = {
  status: 'idle',
  progress: 0,
  message: '',
};

/**
 * Update and broadcast processing status
 */
const updateStatus = (status: Partial<ProcessingStatus>): void => {
  currentProcessingStatus = { ...currentProcessingStatus, ...status };
  notifyStatusChange(currentProcessingStatus);
};

/**
 * Get current processing status
 */
export const getProcessingStatus = (): ProcessingStatus => {
  return { ...currentProcessingStatus };
};

/**
 * API call wrapper for Document Intelligence
 * Routes through openai-proxy Edge Function
 */
const apiCallWrapper = async (
  systemPrompt: string,
  userPrompt: string,
  model: AIModel
): Promise<string> => {
  console.log(`[DocIntelligenceService] AI Call: model=${model}, promptLength=${userPrompt.length}`);
  
  try {
    const response = await callApi('chat', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: model,
      temperature: 0.3, // Lower temp for accuracy
      max_tokens: 4000,
    });
    
    return response.content || response.result || response.message || '';
  } catch (error) {
    console.error('[DocIntelligenceService] AI call failed:', error);
    throw error;
  }
};

// Create singleton instance
let docIntelligence: DocumentIntelligence | null = null;

/**
 * Get Document Intelligence instance
 */
export function getDocumentIntelligence(): DocumentIntelligence {
  if (!docIntelligence) {
    docIntelligence = createDocumentIntelligence(apiCallWrapper);
  }
  return docIntelligence;
}

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

/**
 * Analyze document to detect vendor, complexity, and recommended processing
 */
export function analyzeDocument(
  content: string,
  fileName?: string
): DocumentAnalysis {
  return getDocumentIntelligence().analyze(content, fileName);
}

/**
 * Quick vendor detection
 */
export function detectVendor(content: string, fileName?: string): VendorDetectionResult {
  return vendorDetector.detect(content, fileName);
}

/**
 * Get recommended AI model for content
 */
export function getRecommendedModel(
  content: string,
  mode: ProcessingMode = 'study'
): { model: AIModel; reason: string } {
  const vendor = vendorDetector.detect(content);
  const context = modelRouter.buildRoutingContext(content, vendor, mode);
  const decision = modelRouter.selectModel(context);
  return { model: decision.model, reason: decision.reason };
}

// ============================================
// UNIFIED UPLOAD FUNCTION
// ============================================

/**
 * Upload and process document through the full AI pipeline
 * 
 * ARCHITECTURE:
 * ┌────────────────────────────────────────────────────────────────────┐
 * │                    Upload Pipeline                                  │
 * ├────────────────────────────────────────────────────────────────────┤
 * │                                                                     │
 * │  [File Selected in UI]                                              │
 * │        │                                                            │
 * │        ▼                                                            │
 * │  ┌──────────────────┐                                               │
 * │  │ 1. UPLOAD        │ → cloudStorageService.uploadLargeFile()       │
 * │  │    TO STORAGE    │ → Supabase Storage bucket                     │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 2. EXTRACT TEXT  │ → PDF: PdfService.processDocument()           │
 * │  │                  │ → DOCX/PPTX: parseDocument()                  │
 * │  │                  │ → Cloud: Wait for server extraction           │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 3. DETECT VENDOR │ → Cisco, AWS, Azure, CompTIA, etc.            │
 * │  │    & ANALYZE     │                                               │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 4. INSERT TO DB  │ → documents table (Supabase)                  │
 * │  │                  │ → document_analysis table                     │
 * │  └────────┬─────────┘                                               │
 * │           ▼                                                          │
 * │  ┌──────────────────┐                                               │
 * │  │ 5. TRIGGER AI    │ → Queue processDocumentFull()                 │
 * │  │    PIPELINE      │ → Background processing                       │
 * │  └──────────────────┘                                               │
 * │                                                                     │
 * └────────────────────────────────────────────────────────────────────┘
 * 
 * @param fileName - Name of the file
 * @param fileUri - Local file URI
 * @param fileType - MIME type of the file
 * @param fileSize - Size in bytes
 * @param userId - User ID from auth
 * @param onProgress - Progress callback (0-100)
 * @returns UploadResult with document metadata and AI processing status
 */
export async function uploadDocument(
  fileName: string,
  fileUri: string,
  fileType: string,
  fileSize: number,
  userId: string,
  onProgress?: (progress: number, message: string) => void
): Promise<UploadResult> {
  const documentId = generateId();
  
  console.log(`[DocIntelligenceService] Starting upload: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
  
  const updateProgress = (progress: number, message: string) => {
    updateStatus({ progress, message });
    onProgress?.(progress, message);
  };

  try {
    // ========================================
    // STEP 1: DETERMINE PROCESSING STRATEGY
    // ========================================
    updateProgress(5, 'Analyzing file...');
    
    const fileNameLower = fileName.toLowerCase();
    const fileTypeLower = (fileType || '').toLowerCase();
    const isPdf = fileTypeLower.includes('pdf') || fileNameLower.endsWith('.pdf');
    const isPptx = fileTypeLower.includes('powerpoint') || fileTypeLower.includes('presentation') ||
                   fileNameLower.endsWith('.pptx') || fileNameLower.endsWith('.ppt');
    const isDocx = fileTypeLower.includes('word') || fileTypeLower.includes('document') ||
                   fileNameLower.endsWith('.docx') || fileNameLower.endsWith('.doc');
    
    const useCloudProcessing = CloudStorage.shouldUseCloudProcessing(fileSize);
    
    console.log(`[DocIntelligenceService] File type: isPdf=${isPdf}, isPptx=${isPptx}, isDocx=${isDocx}, useCloud=${useCloudProcessing}`);
    
    let extractedText = '';
    let storagePath: string | undefined;
    let extractedData: ExtractedData | undefined;
    
    // ========================================
    // STEP 2: UPLOAD TO CLOUD STORAGE (if large file)
    // ========================================
    if (useCloudProcessing) {
      updateProgress(10, 'Uploading to cloud storage...');
      
      const cloudResult = await CloudStorage.uploadLargeFile(
        userId,
        documentId,
        fileUri,
        fileName,
        fileType,
        fileSize,
        (progress, message) => {
          const scaledProgress = 10 + (progress * 0.4); // 10-50%
          updateProgress(scaledProgress, message);
        }
      );
      
      if (!cloudResult.success) {
        throw new Error(cloudResult.error || 'Cloud upload failed');
      }
      
      storagePath = cloudResult.storagePath;
      updateProgress(55, 'Waiting for text extraction...');
      
      // Wait for server-side extraction
      const cloudDoc = await CloudStorage.waitForProcessing(
        cloudResult.cloudDocumentId!,
        90000, // 90 second timeout
        1500   // Poll every 1.5 seconds
      );
      
      if (!cloudDoc || cloudDoc.status === 'error' || !cloudDoc.extractedText) {
        console.warn('[DocIntelligenceService] Cloud extraction failed, falling back to local processing...');
        updateProgress(60, 'Cloud extraction unavailable, trying local...');
        
        // For large PDFs (>25MB), try Google Docs OCR directly from client
        const fileSizeMB = fileSize / (1024 * 1024);
        if (isPdf && fileSizeMB > 25) {
          console.log(`[DocIntelligenceService] Large PDF (${fileSizeMB.toFixed(1)}MB), trying Google Docs OCR...`);
          updateProgress(62, 'Large file - using Google Docs OCR...');
          try {
            const { processWithGoogleDocsOCR } = await import('./googleDocsOCR');
            extractedText = await processWithGoogleDocsOCR(fileUri, fileSize, (progress) => {
              const scaledProgress = 62 + (progress * 0.18); // 62-80%
              updateProgress(scaledProgress, 'Google Docs OCR processing...');
            });
            console.log(`[DocIntelligenceService] Google Docs OCR extracted: ${extractedText?.length || 0} chars`);
          } catch (gDocsError: any) {
            console.error('[DocIntelligenceService] Google Docs OCR failed:', gDocsError.message);
            // Continue to local fallback
          }
        }
        
        // Fall back to local PDF processing if Google Docs OCR didn't work
        if (isPdf && (!extractedText || extractedText.length < 100)) {
          try {
            const processedDoc = await PdfService.processDocumentWithOcrFallback(fileUri, (progress, message) => {
              const scaledProgress = 60 + (progress * 0.2); // 60-80%
              updateProgress(scaledProgress, message);
            });
            extractedText = processedDoc.fullText;
            console.log(`[DocIntelligenceService] Local fallback extracted: ${extractedText?.length || 0} chars`);
          } catch (localError: any) {
            console.error('[DocIntelligenceService] Local fallback also failed:', localError.message);
            // Continue with empty text - will be caught by validation
          }
        }
      } else {
        extractedText = cloudDoc.extractedText || '';
      }
      
      extractedData = {
        text: extractedText,
        pages: [{ pageNumber: 1, text: extractedText, images: [], tables: [] }],
        images: [],
        tables: [],
        equations: [],
        totalPages: 1,
      };
      
    } else {
      // ========================================
      // STEP 2B: LOCAL TEXT EXTRACTION
      // ========================================
      updateProgress(10, 'Extracting text...');
      
      if (isPdf) {
        console.log('[DocIntelligenceService] Processing PDF locally...');
        try {
          const processedDoc = await PdfService.processDocumentWithOcrFallback(fileUri, (progress, message) => {
            const scaledProgress = 10 + (progress * 0.5); // 10-60%
            updateProgress(scaledProgress, message);
          });
          
          console.log(`[DocIntelligenceService] PDF processed: ${processedDoc.pageCount} pages, ${processedDoc.fullText?.length || 0} chars`);
          
          extractedText = processedDoc.fullText;
          storagePath = processedDoc.pdfUrl;
        extractedData = {
          text: extractedText,
          pages: processedDoc.pages.map((p, idx) => ({
            pageNumber: p.pageNum,
            text: p.text,
            images: p.imageUrl ? [{ id: `img-${idx}`, url: p.imageUrl, caption: '', pageNumber: p.pageNum, type: 'figure' as const }] : [],
            tables: [],
          })),
          images: processedDoc.pages.filter(p => p.imageUrl).map((p, idx) => ({
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
        } catch (pdfError: any) {
          console.error('[DocIntelligenceService] PDF processing error:', pdfError.message);
          throw new Error(`PDF processing failed: ${pdfError.message}`);
        }
        
      } else if (isPptx || isDocx) {
        updateProgress(30, `Parsing ${isPptx ? 'PowerPoint' : 'Word'} document...`);
        const parsed = await parseDocument(fileUri, fileType);
        extractedText = parsed.content;
        extractedData = {
          text: extractedText,
          pages: [{ pageNumber: 1, text: extractedText, images: [], tables: [] }],
          images: [],
          tables: [],
          equations: [],
          totalPages: 1,
        };
        
      } else {
        // Try generic parsing
        const parsed = await parseDocument(fileUri, fileType);
        extractedText = parsed.content;
        extractedData = {
          text: extractedText,
          pages: [{ pageNumber: 1, text: extractedText, images: [], tables: [] }],
          images: [],
          tables: [],
          equations: [],
          totalPages: 1,
        };
      }
    }
    
    console.log(`[DocIntelligenceService] Extracted text length: ${extractedText?.length || 0} chars`);
    
    if (!extractedText || extractedText.length < 10) {
      throw new Error('Could not extract text from document. The file may be empty, scanned, or password protected.');
    }
    
    // Warn if text is very short but continue
    if (extractedText.length < 100) {
      console.warn('[DocIntelligenceService] Warning: Very short text extracted, document may be partially scanned');
    }
    
    // ========================================
    // STEP 3: DETECT VENDOR & ANALYZE
    // ========================================
    updateProgress(65, 'Analyzing content...');
    
    const vendor = vendorDetector.detect(extractedText, fileName);
    const analysis = getDocumentIntelligence().analyze(extractedText, fileName);
    
    console.log(`[DocIntelligenceService] Vendor: ${vendor.vendorName} (${(vendor.confidence * 100).toFixed(0)}%)`);
    
    // ========================================
    // STEP 4: INSERT METADATA INTO SUPABASE (Optional - may fail if table doesn't exist)
    // ========================================
    updateProgress(75, 'Saving document...');
    
    let insertedDoc: any = null;
    
    // Try to insert into documents table (cloud sync)
    // This is optional - local storage will still work
    // NOTE: Only insert columns that exist in the database schema
    try {
      const { data, error: insertError } = await supabase
        .from('documents')
        .insert({
          id: documentId,
          user_id: userId,
          title: fileName.replace(/\.[^/.]+$/, ''), // Remove extension
          content: extractedText.substring(0, 100000), // Limit for DB  
          file_type: fileType,
          file_size: fileSize,
          file_uri: storagePath,
          summary: vendor.vendorName ? `Detected: ${vendor.vendorName}` : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (insertError) {
        console.warn('[DocIntelligenceService] DB insert failed (continuing with local only):', insertError.message);
      } else {
        insertedDoc = data;
        console.log('[DocIntelligenceService] Document saved to cloud:', documentId);
      }
    } catch (dbError: any) {
      console.warn('[DocIntelligenceService] DB operation failed (continuing with local only):', dbError.message);
    }
    
    // Store initial analysis - ONLY if document was successfully inserted to avoid FK violations
    updateProgress(80, 'Storing analysis...');
    
    if (insertedDoc) {
      try {
        await storeDocumentAnalysis(documentId, userId, analysis, extractedText.length);
      } catch (analysisError: any) {
        console.warn('[DocIntelligenceService] Analysis storage failed:', analysisError.message);
      }
    } else {
      console.log('[DocIntelligenceService] Skipping cloud analysis storage (document not in cloud)');
    }
    
    // ========================================
    // STEP 5: QUEUE AI PIPELINE (Background)
    // ========================================
    updateProgress(90, 'Queuing AI processing...');
    
    // Fire-and-forget AI processing - pass insertedDoc to determine if cloud storage should be used
    queueAIProcessing(documentId, extractedText, userId, !!insertedDoc).catch(err => {
      console.error('[DocIntelligenceService] Background AI processing failed:', err);
    });
    
    updateProgress(100, 'Upload complete!');
    
    updateStatus({ status: 'complete', progress: 100, message: 'Document uploaded successfully' });
    
    return {
      success: true,
      documentId,
      document: {
        id: documentId,
        title: insertedDoc?.title || fileName,
        content: extractedText,
        fileType,
        fileSize,
        storagePath,
        extractedText,
        vendor,
      },
      aiProcessingQueued: true,
    };
    
  } catch (error: any) {
    console.error('[DocIntelligenceService] Upload failed:', error);
    
    updateStatus({
      status: 'error',
      progress: 0,
      message: 'Upload failed',
      error: error.message,
    });
    
    return {
      success: false,
      documentId,
      aiProcessingQueued: false,
      error: error.message || 'Upload failed',
    };
  }
}

/**
 * Simple content hash for deduplication
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(content.length, 10000); i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Queue AI processing in background
 */
async function queueAIProcessing(
  documentId: string,
  content: string,
  userId: string,
  saveToCloud: boolean = false
): Promise<void> {
  console.log(`[DocIntelligenceService] Queuing AI processing for: ${documentId}`);
  
  // Small delay to let upload complete
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    // Process with summary, quiz, and flashcards by default
    await processDocumentFull(
      documentId,
      content,
      userId,
      ['summary', 'quiz', 'flashcards'],
      'en',
      saveToCloud
    );
  } catch (error) {
    console.error('[DocIntelligenceService] AI processing queue error:', error);
    // Only update cloud if document was saved there
    if (saveToCloud) {
      await supabase
        .from('documents')
        .update({ processing_status: 'error' })
        .eq('id', documentId);
    }
  }
}

// ============================================
// ENHANCED PROCESSING FUNCTIONS
// ============================================

/**
 * Generate summary with vendor awareness and validation
 */
export async function intelligentSummarize(
  content: string,
  options: {
    language?: 'en' | 'ar';
    validate?: boolean;
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<{
  summary: string;
  vendor: VendorDetectionResult;
  validation?: any;
}> {
  const { language = 'en', validate = false, onProgress } = options;

  if (onProgress) onProgress(10, 'Analyzing document...');

  const vendor = vendorDetector.detect(content);

  if (onProgress) onProgress(20, vendor.detected 
    ? `${vendor.vendorName} content detected` 
    : 'Processing document...');

  // Build vendor-aware prompt
  const prompt = promptBuilder.build({
    mode: 'summary',
    language,
    vendor,
    contentLength: content.length,
  }, content);

  if (onProgress) onProgress(50, 'Generating summary...');

  const summary = await apiCallWrapper(
    prompt.systemPrompt,
    prompt.userPrompt,
    prompt.recommendedModel
  );

  let validation;
  if (validate) {
    if (onProgress) onProgress(80, 'Validating accuracy...');
    validation = validateContent(summary, content, vendor);
  }

  if (onProgress) onProgress(100, 'Done!');

  return { summary, vendor, validation };
}

/**
 * Generate study guide with vendor awareness
 */
export async function intelligentStudyGuide(
  content: string,
  options: {
    language?: 'en' | 'ar';
    depth?: 'overview' | 'detailed' | 'comprehensive';
    useMultiPass?: boolean;
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<{
  studyGuide: string;
  vendor: VendorDetectionResult;
  knowledgeGraph?: any;
}> {
  const { language = 'en', depth = 'detailed', useMultiPass = true, onProgress } = options;

  if (onProgress) onProgress(10, 'Analyzing document...');

  const analysis = analyzeDocument(content);

  if (onProgress) onProgress(20, analysis.vendor.detected 
    ? `${analysis.vendor.vendorName} content detected` 
    : 'Processing document...');

  // Use multi-pass for complex content
  if (useMultiPass && (analysis.complexity === 'high' || analysis.complexity === 'expert')) {
    const result = await getDocumentIntelligence().process(content, 'study', {
      language,
      useMultiPass: true,
      buildKnowledgeGraph: true,
      modeOptions: { depth },
    });

    if (onProgress) onProgress(100, 'Done!');

    return {
      studyGuide: result.output,
      vendor: analysis.vendor,
      knowledgeGraph: result.knowledgeGraph,
    };
  }

  // Single-pass for simpler content
  const prompt = promptBuilder.build({
    mode: 'study',
    language,
    vendor: analysis.vendor,
    contentLength: content.length,
    options: { depth },
  }, content);

  if (onProgress) onProgress(50, 'Generating study guide...');

  const studyGuide = await apiCallWrapper(
    prompt.systemPrompt,
    prompt.userPrompt,
    prompt.recommendedModel
  );

  if (onProgress) onProgress(100, 'Done!');

  return { studyGuide, vendor: analysis.vendor };
}

/**
 * Generate quiz with vendor-aware questions
 */
export async function intelligentQuiz(
  content: string,
  options: {
    questionCount?: number;
    difficulty?: 'easy' | 'medium' | 'hard' | 'mixed';
    language?: 'en' | 'ar';
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<{
  questions: any[];
  vendor: VendorDetectionResult;
}> {
  const { questionCount = 10, difficulty = 'mixed', language = 'en', onProgress } = options;

  if (onProgress) onProgress(10, 'Analyzing document...');

  const vendor = vendorDetector.detect(content);

  if (onProgress) onProgress(30, vendor.detected 
    ? `Creating ${vendor.vendorName}-focused questions...` 
    : 'Generating quiz questions...');

  const prompt = promptBuilder.build({
    mode: 'quiz',
    language,
    vendor,
    contentLength: content.length,
    options: { questionCount, difficulty },
  }, content);

  if (onProgress) onProgress(50, 'Processing...');

  const response = await apiCallWrapper(
    prompt.systemPrompt,
    prompt.userPrompt,
    prompt.recommendedModel
  );

  if (onProgress) onProgress(100, 'Done!');

  // Parse questions from response
  let questions = [];
  try {
    const jsonMatch = response.match(/\{[\s\S]*"questions"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      questions = parsed.questions || [];
    }
  } catch (e) {
    console.error('[IntelligentQuiz] Failed to parse response:', e);
  }

  return { questions, vendor };
}

/**
 * Generate interview questions with vendor focus
 */
export async function intelligentInterview(
  content: string,
  options: {
    interviewType?: 'technical' | 'behavioral' | 'mixed';
    experienceLevel?: 'entry' | 'mid' | 'senior';
    language?: 'en' | 'ar';
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<{
  questions: string;
  vendor: VendorDetectionResult;
}> {
  const { interviewType = 'mixed', experienceLevel = 'mid', language = 'en', onProgress } = options;

  if (onProgress) onProgress(10, 'Analyzing document...');

  const vendor = vendorDetector.detect(content);

  if (onProgress) onProgress(30, 'Generating interview questions...');

  const prompt = promptBuilder.build({
    mode: 'interview',
    language,
    vendor,
    contentLength: content.length,
    options: { interviewType, experienceLevel },
  }, content);

  const questions = await apiCallWrapper(
    prompt.systemPrompt,
    prompt.userPrompt,
    prompt.recommendedModel
  );

  if (onProgress) onProgress(100, 'Done!');

  return { questions, vendor };
}

/**
 * Generate lab exercise with vendor-specific CLI
 */
export async function intelligentLabs(
  content: string,
  options: {
    labType?: 'guided' | 'challenge' | 'troubleshooting';
    includeTopology?: boolean;
    language?: 'en' | 'ar';
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<{
  labExercise: string;
  vendor: VendorDetectionResult;
  validation?: any;
}> {
  const { labType = 'guided', includeTopology = true, language = 'en', onProgress } = options;

  if (onProgress) onProgress(10, 'Analyzing document...');

  const analysis = analyzeDocument(content);

  if (!analysis.hasCliCommands && !analysis.vendor.detected) {
    throw new Error('This document does not appear to contain technical content suitable for lab exercises.');
  }

  if (onProgress) onProgress(20, analysis.vendor.detected 
    ? `Creating ${analysis.vendor.vendorName} lab...` 
    : 'Generating lab exercise...');

  // Always use multi-pass for labs to ensure accuracy
  const result = await getDocumentIntelligence().process(content, 'labs', {
    language,
    useMultiPass: true,
    validate: true,
    modeOptions: { labType, includeTopology },
  });

  if (onProgress) onProgress(100, 'Done!');

  return {
    labExercise: result.output,
    vendor: analysis.vendor,
    validation: result.validation,
  };
}

/**
 * Generate video content with storyboard
 */
export async function intelligentVideo(
  content: string,
  title: string,
  options: {
    duration?: number;
    style?: 'educational' | 'tutorial' | 'overview';
    language?: 'en' | 'ar';
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<{
  storyboard: any;
  voiceScript: any;
  vendor: VendorDetectionResult;
}> {
  const { duration = 10, style = 'educational', language = 'en', onProgress } = options;

  if (onProgress) onProgress(10, 'Analyzing document...');

  const vendor = vendorDetector.detect(content);

  if (onProgress) onProgress(30, 'Creating storyboard...');

  const storyboard = generateStoryboard(content, title, {
    language,
    style,
    targetDuration: duration,
    vendor,
  });

  if (onProgress) onProgress(70, 'Generating voice script...');

  const voiceScript = generateVoiceScript(storyboard);

  if (onProgress) onProgress(100, 'Done!');

  return { storyboard, voiceScript, vendor };
}

/**
 * Generate flashcards with vendor awareness
 */
export async function intelligentFlashcards(
  content: string,
  options: {
    count?: number;
    language?: 'en' | 'ar';
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<{
  flashcards: any[];
  vendor: VendorDetectionResult;
}> {
  const { count = 20, language = 'en', onProgress } = options;

  if (onProgress) onProgress(10, 'Analyzing document...');

  const vendor = vendorDetector.detect(content);

  if (onProgress) onProgress(30, 'Creating flashcards...');

  const prompt = promptBuilder.build({
    mode: 'flashcards',
    language,
    vendor,
    contentLength: content.length,
  }, content);

  const response = await apiCallWrapper(
    prompt.systemPrompt,
    prompt.userPrompt,
    prompt.recommendedModel
  );

  if (onProgress) onProgress(100, 'Done!');

  // Parse flashcards from response
  let flashcards = [];
  try {
    const jsonMatch = response.match(/\{[\s\S]*"flashcards"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      flashcards = parsed.flashcards || [];
    }
  } catch (e) {
    console.error('[IntelligentFlashcards] Failed to parse response:', e);
  }

  return { flashcards, vendor };
}

// ============================================
// KNOWLEDGE GRAPH
// ============================================

/**
 * Build knowledge graph from document
 */
export function buildKnowledgeGraph(documentId: string, content: string) {
  const vendor = vendorDetector.detect(content);
  return createKnowledgeGraph(documentId, content, vendor.vendorId);
}

// ============================================
// VALIDATION
// ============================================

/**
 * Validate generated content against source
 */
export function validateGeneratedContent(
  generatedContent: string,
  sourceContent: string
) {
  const vendor = vendorDetector.detect(sourceContent);
  return validateContent(generatedContent, sourceContent, vendor);
}

// ============================================
// FULL DOCUMENT PROCESSING PIPELINE
// ============================================

/**
 * Process a document through the complete AI pipeline
 * This is the main entry point after document upload
 * 
 * @param documentId - Supabase document ID (UUID)
 * @param content - Document text content
 * @param userId - User's ID for DB storage
 * @param modes - Processing modes to generate (default: summary, quiz, flashcards)
 * @param language - Output language ('en' or 'ar')
 * @param onProgress - Optional progress callback for custom handling
 * @returns Complete processing result with stored references
 * 
 * PROCESSING STEPS:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Step 1: ANALYZE (0-15%)                                     │
 * │   - Detect vendor (Cisco, AWS, etc.)                        │
 * │   - Determine complexity and features                       │
 * │   - Select optimal AI model                                 │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Step 2: STORE ANALYSIS (15-20%)                             │
 * │   - Save to document_analysis table                         │
 * │   - Mark document as processing                             │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Step 3: PROCESS MODES (20-80%)                              │
 * │   - For each mode (summary, quiz, etc.):                    │
 * │     - Build vendor-aware prompts                            │
 * │     - Run multi-pass processing (4 passes for complex)      │
 * │     - Validate generated content                            │
 * │     - Store to ai_summaries table                           │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Step 4: BUILD KNOWLEDGE GRAPH (80-90%)                      │
 * │   - Extract concepts and relationships                      │
 * │   - Store to knowledge_graphs table                         │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Step 5: FINALIZE (90-100%)                                  │
 * │   - Update analysis with completion status                  │
 * │   - Notify listeners of completion                          │
 * └─────────────────────────────────────────────────────────────┘
 */
export async function processDocumentFull(
  documentId: string,
  content: string,
  userId: string,
  modes: ProcessingMode[] = ['summary', 'quiz', 'flashcards'],
  language: 'en' | 'ar' = 'en',
  saveToCloud: boolean = false,
  onProgress?: ProgressCallback
): Promise<FullProcessingResult> {
  console.log(`[DocIntelligenceService] Starting full processing for document: ${documentId}`);
  console.log(`[DocIntelligenceService] Modes: ${modes.join(', ')}, Language: ${language}, SaveToCloud: ${saveToCloud}`);

  const startTime = Date.now();
  const storedSummaries: StoredAISummary[] = [];
  let storedAnalysis: StoredDocumentAnalysis | null = null;
  let storedGraph: StoredKnowledgeGraph | null = null;

  try {
    // ========================================
    // STEP 1: ANALYZE DOCUMENT
    // Detect vendor, complexity, and features
    // ========================================
    updateStatus({
      status: 'analyzing',
      progress: 5,
      message: language === 'ar' ? 'جاري تحليل المستند...' : 'Analyzing document...',
    });
    if (onProgress) onProgress(currentProcessingStatus);

    // Run vendor detection and content analysis
    const analysis = getDocumentIntelligence().analyze(content);
    
    console.log(`[DocIntelligenceService] Analysis complete:`, {
      vendor: analysis.vendor.vendorName,
      confidence: analysis.vendor.confidence,
      complexity: analysis.complexity,
      recommendedModel: analysis.recommendedModel,
      hasCliCommands: analysis.hasCliCommands,
    });

    updateStatus({
      progress: 15,
      message: analysis.vendor.detected 
        ? (language === 'ar' 
          ? `تم اكتشاف محتوى ${analysis.vendor.vendorName}` 
          : `${analysis.vendor.vendorName} content detected`)
        : (language === 'ar' ? 'جاري المعالجة...' : 'Processing...'),
    });
    if (onProgress) onProgress(currentProcessingStatus);

    // ========================================
    // STEP 2: STORE INITIAL ANALYSIS IN SUPABASE
    // Creates document_analysis record
    // ========================================
    updateStatus({
      progress: 18,
      message: language === 'ar' ? 'جاري حفظ التحليل...' : 'Storing analysis...',
    });
    if (onProgress) onProgress(currentProcessingStatus);

    // Only store to cloud if document was saved there
    if (saveToCloud) {
      storedAnalysis = await storeDocumentAnalysis(
        documentId,
        userId,
        analysis,
        content.length
      );
    } else {
      console.log('[DocIntelligenceService] Skipping cloud storage (local mode)');
    }

    // ========================================
    // STEP 3: MULTI-PASS PROCESSING FOR EACH MODE
    // Generates content with validation
    // ========================================
    const totalModes = modes.length;
    const progressPerMode = 55 / totalModes; // 55% of total (20% to 75%)

    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      const baseProgress = 20 + (i * progressPerMode);

      updateStatus({
        status: 'processing',
        progress: Math.round(baseProgress),
        message: language === 'ar' 
          ? `جاري إنشاء ${getModeLabel(mode, 'ar')}...` 
          : `Generating ${mode}...`,
        currentMode: mode,
        currentPass: 1,
        totalPasses: shouldUseMultiPassForMode(mode, analysis) ? 4 : 1,
      });
      if (onProgress) onProgress(currentProcessingStatus);

      try {
        // Determine if this mode needs multi-pass processing
        const useMultiPass = shouldUseMultiPassForMode(mode, analysis);
        
        // Process the content for this mode
        const result = await getDocumentIntelligence().process(content, mode, {
          language,
          useMultiPass,
          validate: true,
          buildKnowledgeGraph: false, // Build once at the end
          modeOptions: getModeOptions(mode, analysis),
        });

        // Update progress through passes (simulate for UI feedback)
        if (useMultiPass) {
          for (let pass = 1; pass <= 4; pass++) {
            updateStatus({
              progress: Math.round(baseProgress + (pass * progressPerMode / 5)),
              message: language === 'ar'
                ? `${getModeLabel(mode, 'ar')} - المرحلة ${pass}/4`
                : `${getModeLabel(mode, 'en')} - Pass ${pass}/4`,
              currentPass: pass,
              totalPasses: 4,
            });
            if (onProgress) onProgress(currentProcessingStatus);
            // Small delay to show progress
            await new Promise(r => setTimeout(r, 50));
          }
        }

        // Store the generated summary in Supabase (only if cloud storage is enabled)
        if (saveToCloud) {
          const stored = await storeAISummary(
            documentId,
            userId,
            mode,
            language,
            result.output,
            result.validation,
            result.metadata
          );
          storedSummaries.push(stored);
        }
        console.log(`[DocIntelligenceService] Stored ${mode} summary (${result.output.length} chars)`);

      } catch (error) {
        console.error(`[DocIntelligenceService] Failed to process mode ${mode}:`, error);
        // Continue with other modes even if one fails
      }
    }

    // ========================================
    // STEP 4: BUILD AND STORE KNOWLEDGE GRAPH
    // Extracts concepts and relationships
    // ========================================
    updateStatus({
      status: 'validating',
      progress: 80,
      message: language === 'ar' ? 'جاري بناء خريطة المعرفة...' : 'Building knowledge graph...',
      currentMode: undefined,
      currentPass: undefined,
      totalPasses: undefined,
    });
    if (onProgress) onProgress(currentProcessingStatus);

    // Only store knowledge graph if cloud storage is enabled
    if (saveToCloud) {
      try {
        // Build knowledge graph from document content
        const graph = createKnowledgeGraph(
          documentId,
          content,
          analysis.vendor.vendorId
        );

        // Store in Supabase
        storedGraph = await storeKnowledgeGraph(documentId, userId, graph);
        console.log(`[DocIntelligenceService] Knowledge graph stored: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

      } catch (error) {
        console.error('[DocIntelligenceService] Failed to build knowledge graph:', error);
        // Non-fatal - continue processing
      }
    }

    // ========================================
    // STEP 5: FINALIZE PROCESSING
    // Update status and notify completion
    // ========================================
    updateStatus({
      status: 'storing',
      progress: 95,
      message: language === 'ar' ? 'جاري إنهاء المعالجة...' : 'Finalizing...',
    });
    if (onProgress) onProgress(currentProcessingStatus);

    // Update document_analysis with completion status (only if cloud storage)
    if (saveToCloud) {
      await updateAnalysisStatus(documentId, 'complete', 100, Date.now() - startTime);

      // Also update the main documents table summary if we generated one
      const summaryResult = storedSummaries.find(s => s.summaryType === 'summary');
      if (summaryResult) {
        await updateDocumentSummary(documentId, summaryResult.content);
      }
    }

    // Mark processing complete
    updateStatus({
      status: 'complete',
      progress: 100,
      message: language === 'ar' ? 'تمت المعالجة بنجاح!' : 'Processing complete!',
    });
    if (onProgress) onProgress(currentProcessingStatus);

    const totalTime = Date.now() - startTime;
    console.log(`[DocIntelligenceService] Full processing complete in ${totalTime}ms`);
    console.log(`[DocIntelligenceService] Generated: ${storedSummaries.length} summaries, ${storedGraph ? 1 : 0} knowledge graph`);

    return {
      success: true,
      documentId,
      analysis: storedAnalysis,
      summaries: storedSummaries,
      knowledgeGraph: storedGraph,
    };

  } catch (error: any) {
    console.error('[DocIntelligenceService] Full processing failed:', error);
    
    updateStatus({
      status: 'error',
      progress: 0,
      message: language === 'ar' ? 'فشلت المعالجة' : 'Processing failed',
      error: error.message,
    });
    if (onProgress) onProgress(currentProcessingStatus);

    // Update analysis with error status
    if (storedAnalysis) {
      await updateAnalysisStatus(documentId, 'error', 0, 0, error.message);
    }

    return {
      success: false,
      documentId,
      analysis: storedAnalysis,
      summaries: storedSummaries,
      knowledgeGraph: storedGraph,
      error: error.message,
    };
  }
}

// ============================================
// SUPABASE STORAGE FUNCTIONS
// ============================================

/**
 * Store document analysis in Supabase
 * Called after initial vendor detection and analysis
 */
async function storeDocumentAnalysis(
  documentId: string,
  userId: string,
  analysis: DocumentAnalysis,
  contentLength: number
): Promise<StoredDocumentAnalysis> {
  const data = {
    document_id: documentId,
    user_id: userId,
    vendor_id: analysis.vendor.vendorId,
    vendor_name: analysis.vendor.vendorName,
    vendor_confidence: analysis.vendor.confidence,
    certification_detected: analysis.vendor.certificationDetected || null,
    complexity: analysis.complexity,
    has_cli_commands: analysis.hasCliCommands,
    has_config_blocks: analysis.hasConfigBlocks,
    content_length: contentLength,
    ai_model: analysis.recommendedModel,
    suggested_modes: analysis.suggestedModes,
    processing_status: 'processing',
    processing_progress: 20,
    processing_message: 'Analysis complete, generating content...',
  };

  const { data: result, error } = await supabase
    .from('document_analysis')
    .upsert(data, { onConflict: 'document_id' })
    .select()
    .single();

  if (error) {
    console.error('[DocIntelligenceService] Failed to store analysis:', error);
    // Don't throw - return partial result
    return mapAnalysisFromDB({ ...data, id: documentId });
  }

  return mapAnalysisFromDB(result);
}

/**
 * Store AI-generated summary in Supabase
 * Called after each mode is processed
 */
async function storeAISummary(
  documentId: string,
  userId: string,
  summaryType: ProcessingMode,
  language: string,
  content: string,
  validation: any,
  metadata: { model: AIModel; processingTime: number; tokensUsed?: number }
): Promise<StoredAISummary> {
  const data = {
    document_id: documentId,
    user_id: userId,
    summary_type: summaryType,
    language,
    content,
    validation_passed: validation?.isValid ?? true,
    validation_score: validation?.score ?? null,
    corrections_made: validation?.corrections?.length ?? 0,
    ai_model: metadata.model,
    tokens_used: metadata.tokensUsed || null,
    processing_time_ms: metadata.processingTime,
    passes_completed: ['study', 'labs', 'quiz'].includes(summaryType) ? 4 : 1,
  };

  const { data: result, error } = await supabase
    .from('ai_summaries')
    .upsert(data, { onConflict: 'document_id,summary_type,language' })
    .select()
    .single();

  if (error) {
    console.error('[DocIntelligenceService] Failed to store summary:', error);
    // Return partial result
    return mapSummaryFromDB({ ...data, id: `${documentId}-${summaryType}` });
  }

  return mapSummaryFromDB(result);
}

/**
 * Store knowledge graph in Supabase
 * Called after graph is built from document
 */
async function storeKnowledgeGraph(
  documentId: string,
  userId: string,
  graph: KnowledgeGraph
): Promise<StoredKnowledgeGraph> {
  // Calculate max depth via BFS
  const maxDepth = calculateGraphDepth(graph);

  const data = {
    document_id: documentId,
    user_id: userId,
    nodes: graph.nodes,
    edges: graph.edges,
    root_nodes: graph.rootNodes,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    max_depth: maxDepth,
    learning_paths: [],
    concept_clusters: [],
  };

  const { data: result, error } = await supabase
    .from('knowledge_graphs')
    .upsert(data, { onConflict: 'document_id' })
    .select()
    .single();

  if (error) {
    console.error('[DocIntelligenceService] Failed to store knowledge graph:', error);
    return mapGraphFromDB({ ...data, id: documentId });
  }

  return mapGraphFromDB(result);
}

/**
 * Update analysis processing status
 */
async function updateAnalysisStatus(
  documentId: string,
  status: string,
  progress: number,
  processingTimeMs?: number,
  error?: string
): Promise<void> {
  const update: any = {
    processing_status: status,
    processing_progress: progress,
  };

  if (status === 'complete') {
    update.processed_at = new Date().toISOString();
    update.processing_message = 'Processing complete';
  }

  if (error) {
    update.processing_error = error;
  }

  await supabase
    .from('document_analysis')
    .update(update)
    .eq('document_id', documentId);
}

/**
 * Update main documents table with generated summary
 */
async function updateDocumentSummary(documentId: string, summary: string): Promise<void> {
  await supabase
    .from('documents')
    .update({ summary, updated_at: new Date().toISOString() })
    .eq('id', documentId);
}

// ============================================
// RETRIEVAL FUNCTIONS
// ============================================

/**
 * Get stored analysis for a document
 */
export async function getStoredAnalysis(documentId: string): Promise<StoredDocumentAnalysis | null> {
  const { data, error } = await supabase
    .from('document_analysis')
    .select('*')
    .eq('document_id', documentId)
    .single();

  if (error || !data) return null;
  return mapAnalysisFromDB(data);
}

/**
 * Get stored summary for a document by type
 */
export async function getStoredSummary(
  documentId: string,
  summaryType: ProcessingMode,
  language: string = 'en'
): Promise<StoredAISummary | null> {
  const { data, error } = await supabase
    .from('ai_summaries')
    .select('*')
    .eq('document_id', documentId)
    .eq('summary_type', summaryType)
    .eq('language', language)
    .single();

  if (error || !data) return null;
  return mapSummaryFromDB(data);
}

/**
 * Get all stored summaries for a document
 */
export async function getAllStoredSummaries(documentId: string): Promise<StoredAISummary[]> {
  const { data, error } = await supabase
    .from('ai_summaries')
    .select('*')
    .eq('document_id', documentId);

  if (error || !data) return [];
  return data.map(mapSummaryFromDB);
}

/**
 * Get stored knowledge graph for a document
 */
export async function getStoredKnowledgeGraph(documentId: string): Promise<StoredKnowledgeGraph | null> {
  const { data, error } = await supabase
    .from('knowledge_graphs')
    .select('*')
    .eq('document_id', documentId)
    .single();

  if (error || !data) return null;
  return mapGraphFromDB(data);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get localized mode label
 */
function getModeLabel(mode: ProcessingMode, lang: 'en' | 'ar'): string {
  const labels: Record<ProcessingMode, { en: string; ar: string }> = {
    summary: { en: 'Summary', ar: 'ملخص' },
    study: { en: 'Study Guide', ar: 'دليل الدراسة' },
    quiz: { en: 'Quiz', ar: 'اختبار' },
    flashcards: { en: 'Flashcards', ar: 'بطاقات' },
    labs: { en: 'Labs', ar: 'مختبرات' },
    interview: { en: 'Interview Prep', ar: 'تحضير المقابلة' },
    video: { en: 'Video Script', ar: 'نص الفيديو' },
  };
  return labels[mode]?.[lang] || mode;
}

/**
 * Determine if mode should use multi-pass processing
 * Multi-pass is used for complex modes requiring validation
 */
function shouldUseMultiPassForMode(mode: ProcessingMode, analysis: DocumentAnalysis): boolean {
  // Always use multi-pass for labs (needs accuracy)
  if (mode === 'labs') return true;
  
  // Use multi-pass for complex content
  if (analysis.complexity === 'high' || analysis.complexity === 'expert') {
    return ['study', 'quiz'].includes(mode);
  }
  
  // Use multi-pass for vendor-specific content
  if (analysis.vendor.detected && analysis.vendor.confidence > 0.7) {
    return ['study', 'labs', 'quiz'].includes(mode);
  }
  
  return false;
}

/**
 * Get mode-specific options based on analysis
 */
function getModeOptions(mode: ProcessingMode, analysis: DocumentAnalysis): Record<string, any> {
  switch (mode) {
    case 'quiz':
      return {
        questionCount: analysis.complexity === 'expert' ? 20 : 10,
        includeMultipleChoice: true,
        includeTrueFalse: true,
        difficulty: analysis.complexity,
      };
    case 'labs':
      return {
        includeStepByStep: true,
        includeVerification: true,
        targetPlatform: analysis.vendor.vendorId,
      };
    case 'flashcards':
      return {
        maxCards: 30,
        includeDefinitions: true,
        includeCommands: analysis.hasCliCommands,
      };
    case 'study':
      return {
        depth: analysis.complexity === 'expert' ? 'comprehensive' : 'detailed',
      };
    default:
      return {};
  }
}

/**
 * Calculate max depth of knowledge graph via BFS
 */
function calculateGraphDepth(graph: KnowledgeGraph): number {
  if (graph.nodes.length === 0) return 0;
  
  const visited = new Set<string>();
  let maxDepth = 0;

  const traverse = (nodeId: string, depth: number) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    maxDepth = Math.max(maxDepth, depth);

    const children = graph.edges
      .filter(e => e.source === nodeId)
      .map(e => e.target);

    children.forEach(child => traverse(child, depth + 1));
  };

  graph.rootNodes.forEach(root => traverse(root, 0));
  return maxDepth;
}

// ============================================
// DATABASE MAPPERS
// ============================================

function mapAnalysisFromDB(data: any): StoredDocumentAnalysis {
  return {
    id: data.id,
    documentId: data.document_id,
    vendorId: data.vendor_id,
    vendorName: data.vendor_name,
    vendorConfidence: data.vendor_confidence,
    certificationDetected: data.certification_detected,
    complexity: data.complexity,
    hasCliCommands: data.has_cli_commands,
    hasConfigBlocks: data.has_config_blocks,
    contentLength: data.content_length,
    aiModel: data.ai_model,
    tokensUsed: data.tokens_used,
    suggestedModes: data.suggested_modes || [],
    processingStatus: data.processing_status,
    processingProgress: data.processing_progress,
    processedAt: data.processed_at ? new Date(data.processed_at) : null,
  };
}

function mapSummaryFromDB(data: any): StoredAISummary {
  return {
    id: data.id,
    documentId: data.document_id,
    summaryType: data.summary_type,
    language: data.language,
    content: data.content,
    validationPassed: data.validation_passed,
    validationScore: data.validation_score,
    correctionsMAde: data.corrections_made,
    aiModel: data.ai_model,
    tokensUsed: data.tokens_used,
    processingTimeMs: data.processing_time_ms,
    passesCompleted: data.passes_completed,
  };
}

function mapGraphFromDB(data: any): StoredKnowledgeGraph {
  return {
    id: data.id,
    documentId: data.document_id,
    nodes: data.nodes || [],
    edges: data.edges || [],
    rootNodes: data.root_nodes || [],
    nodeCount: data.node_count,
    edgeCount: data.edge_count,
    maxDepth: data.max_depth,
    learningPaths: data.learning_paths || [],
    conceptClusters: data.concept_clusters || [],
  };
}

// ============================================
// EXPORTS
// ============================================

export {
  vendorDetector,
  modelRouter,
  promptBuilder,
  createKnowledgeGraph,
  generateStoryboard,
  generateVoiceScript,
};

export type {
  DocumentAnalysis,
  VendorDetectionResult,
  AIModel,
  ProcessingMode,
};
