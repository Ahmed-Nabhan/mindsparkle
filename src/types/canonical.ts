/**
 * Canonical Document Model
 * 
 * Standardized document structure returned by the backend extraction service.
 * All documents (PDF, DOCX, PPTX, Images) are normalized to this format.
 * 
 * This model is populated by Google Document AI and stored in Supabase.
 * The client never does extraction - it only consumes this normalized data.
 */

// ============================================
// EXTRACTION STATUS
// ============================================

export type ExtractionStatus = 
  | 'uploaded'      // File uploaded to storage, waiting for extraction
  | 'processing'    // Extraction in progress
  | 'extracted'     // Text extracted successfully
  | 'analyzed'      // Vendor detection + analysis complete
  | 'failed';       // Extraction failed

// ============================================
// CANONICAL DOCUMENT MODEL
// ============================================

/**
 * Main canonical document structure
 * This is the normalized output from backend extraction
 */
export interface CanonicalDocument {
  /** Document ID (UUID) */
  id: string;
  
  /** User who owns this document */
  userId: string;
  
  /** Document title (filename without extension) */
  title: string;
  
  /** Original filename */
  originalFilename: string;
  
  /** MIME type */
  mimeType: string;
  
  /** File size in bytes */
  fileSize: number;
  
  /** Supabase Storage path */
  storagePath: string;
  
  /** Current extraction status */
  status: ExtractionStatus;
  
  /** Extraction metadata */
  extraction: ExtractionMetadata;
  
  /** Structured content */
  content: DocumentContent;
  
  /** Vendor/domain detection results */
  vendor: VendorDetection | null;
  
  /** Quality metrics */
  quality: QualityMetrics;
  
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
  extractedAt: Date | null;
}

// ============================================
// EXTRACTION METADATA
// ============================================

export interface ExtractionMetadata {
  /** Extraction method used */
  method: 'document_ai' | 'text_only' | 'ocr_only' | 'failed';
  
  /** Google Document AI processor used (if applicable) */
  processorType?: 'OCR' | 'FORM' | 'LAYOUT' | 'GENERAL';
  
  /** Processing time in milliseconds */
  processingTimeMs: number;
  
  /** Whether OCR was needed (scanned document) */
  ocrUsed: boolean;
  
  /** Number of pages processed */
  pageCount: number;
  
  /** Total character count */
  characterCount: number;
  
  /** Detected language(s) */
  languages: string[];
  
  /** Any errors or warnings during extraction */
  errors: string[];
  warnings: string[];
}

// ============================================
// DOCUMENT CONTENT
// ============================================

export interface DocumentContent {
  /** Full text content (concatenated from all pages) */
  fullText: string;
  
  /** Structured pages */
  pages: CanonicalPage[];
  
  /** All tables extracted */
  tables: CanonicalTable[];
  
  /** All images/figures extracted */
  figures: CanonicalFigure[];
  
  /** Key-value pairs (forms) */
  formFields: FormField[];
}

export interface CanonicalPage {
  /** Page number (1-indexed) */
  pageNumber: number;
  
  /** Page text content */
  text: string;
  
  /** Layout blocks with positions */
  blocks: LayoutBlock[];
  
  /** Page dimensions (if available) */
  width?: number;
  height?: number;
}

export interface LayoutBlock {
  /** Block type */
  type: 'paragraph' | 'heading' | 'list_item' | 'table' | 'figure' | 'code' | 'equation';
  
  /** Block text content */
  text: string;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Bounding box (normalized 0-1) */
  boundingBox?: BoundingBox;
}

export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanonicalTable {
  /** Table ID */
  id: string;
  
  /** Page number where table appears */
  pageNumber: number;
  
  /** Table title/caption (if detected) */
  title?: string;
  
  /** Column headers */
  headers: string[];
  
  /** Table rows */
  rows: TableRow[];
  
  /** Confidence score */
  confidence: number;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  text: string;
  rowSpan?: number;
  colSpan?: number;
}

export interface CanonicalFigure {
  /** Figure ID */
  id: string;
  
  /** Page number */
  pageNumber: number;
  
  /** Figure type */
  type: 'image' | 'diagram' | 'chart' | 'logo' | 'screenshot';
  
  /** Caption (if detected) */
  caption?: string;
  
  /** Base64 encoded image data (optional, for small images) */
  base64?: string;
  
  /** Storage URL for the image */
  storageUrl?: string;
  
  /** Bounding box */
  boundingBox?: BoundingBox;
}

export interface FormField {
  /** Field name/label */
  name: string;
  
  /** Field value */
  value: string;
  
  /** Field type */
  type: 'text' | 'checkbox' | 'date' | 'number' | 'unknown';
  
  /** Confidence score */
  confidence: number;
}

// ============================================
// VENDOR DETECTION
// ============================================

export interface VendorDetection {
  /** Detected vendor ID */
  vendorId: VendorId | null;
  
  /** Vendor display name */
  vendorName: string | null;
  
  /** Detection confidence (0-1) */
  confidence: number;
  
  /** Detected certification (e.g., "CCNA", "AZ-104") */
  certification?: string;
  
  /** Content domain */
  domain: ContentDomain;
  
  /** Detected topics/keywords */
  topics: string[];
}

export type VendorId = 
  | 'cisco'
  | 'aws'
  | 'azure'
  | 'gcp'
  | 'comptia'
  | 'oracle'
  | 'vmware'
  | 'redhat'
  | 'generic';

export type ContentDomain = 
  | 'networking'
  | 'cloud'
  | 'security'
  | 'programming'
  | 'database'
  | 'devops'
  | 'general_it'
  | 'academic'
  | 'business'
  | 'other';

// ============================================
// QUALITY METRICS
// ============================================

export interface QualityMetrics {
  /** Overall quality score (0-100) */
  overallScore: number;
  
  /** Text extraction confidence */
  textConfidence: number;
  
  /** Layout detection confidence */
  layoutConfidence: number;
  
  /** Is document scanned (image-based)? */
  isScanned: boolean;
  
  /** Does document have extractable text? */
  hasText: boolean;
  
  /** Is document password protected? */
  isPasswordProtected: boolean;
  
  /** Estimated reading time (minutes) */
  estimatedReadingTime: number;
  
  /** Word count */
  wordCount: number;
}

// ============================================
// API TYPES
// ============================================

/**
 * Request to upload a document
 */
export interface UploadDocumentRequest {
  fileName: string;
  fileUri: string;
  fileType: string;
  fileSize: number;
}

/**
 * Response from upload endpoint
 */
export interface UploadDocumentResponse {
  success: boolean;
  documentId: string;
  status: ExtractionStatus;
  message: string;
  error?: string;
}

/**
 * Document status polling response
 */
export interface DocumentStatusResponse {
  documentId: string;
  status: ExtractionStatus;
  progress: number; // 0-100
  message: string;
  document?: CanonicalDocument;
  error?: string;
}
