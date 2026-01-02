/**
 * Validation Utilities - Production Ready
 * 
 * @module utils/validators
 */

// ============================================
// UUID VALIDATION
// ============================================

/**
 * Validate UUID format (v1-5)
 * Used to distinguish cloud documents from local documents
 */
export const isValidUUID = (str: string | null | undefined): boolean => {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Check if ID is a local document ID (not a UUID)
 */
export const isLocalDocumentId = (id: string): boolean => {
  return !isValidUUID(id);
};

// ============================================
// EMAIL VALIDATION
// ============================================

/**
 * Validate email address
 */
export const isValidEmail = (email:  string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 */
export const isValidPassword = (password: string): boolean => {
  return password.length >= 8;
};

/**
 * Validate file type
 */
export const isValidFileType = (fileName: string, allowedTypes: string[]): boolean => {
  if (! fileName) return false;
  
  const lowerFileName = fileName.toLowerCase();
  const extension = lowerFileName.substring(lowerFileName.lastIndexOf('.'));
  
  // Check extension
  const isValidExt = allowedTypes.some(function(type) {
    return type.toLowerCase() === extension;
  });
  
  if (isValidExt) return true;
  
  // Also check if filename contains known extensions (for edge cases)
  const validExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt'];
  return validExtensions.some(function(ext) {
    return lowerFileName.endsWith(ext);
  });
};

/**
 * Validate file size
 */
export const isValidFileSize = (fileSize:  number, maxSize:  number): boolean => {
  return fileSize <= maxSize;
};

/**
 * Validate required field
 */
export const isRequired = (value: string): boolean => {
  return value.trim().length > 0;
};

// ============================================
// FILE VALIDATION
// ============================================

/**
 * Supported document types
 */
export const SUPPORTED_FILE_TYPES = {
  documents: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt'],
  images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  all: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.webp'],
};

/**
 * Maximum file sizes
 */
export const FILE_SIZE_LIMITS = {
  document: 100 * 1024 * 1024, // 100MB
  image: 10 * 1024 * 1024, // 10MB
  minimum: 100, // 100 bytes (empty file check)
};

/**
 * MIME type mappings
 */
export const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Comprehensive file validation
 */
export interface FileValidationResult {
  valid: boolean;
  error?: string;
  fileType?: string;
  extension?: string;
}

export const validateFile = (
  fileName: string,
  fileSize: number,
  mimeType?: string
): FileValidationResult => {
  // Check file name
  if (!fileName || fileName.length < 3) {
    return { valid: false, error: 'Invalid file name' };
  }
  
  // Check for empty file
  if (fileSize < FILE_SIZE_LIMITS.minimum) {
    return { valid: false, error: 'File is empty or too small' };
  }
  
  // Get extension
  const lowerFileName = fileName.toLowerCase();
  const lastDotIndex = lowerFileName.lastIndexOf('.');
  const extension = lastDotIndex > -1 ? lowerFileName.substring(lastDotIndex) : '';
  
  // Check extension
  if (!SUPPORTED_FILE_TYPES.all.includes(extension)) {
    return { 
      valid: false, 
      error: `File type "${extension}" not supported. Supported: PDF, Word, PowerPoint, Text, Images.`,
    };
  }
  
  // Check size based on type
  const isImage = SUPPORTED_FILE_TYPES.images.includes(extension);
  const maxSize = isImage ? FILE_SIZE_LIMITS.image : FILE_SIZE_LIMITS.document;
  
  if (fileSize > maxSize) {
    const maxMB = maxSize / 1024 / 1024;
    return { 
      valid: false, 
      error: `File too large. Maximum size is ${maxMB}MB.`,
    };
  }
  
  // Determine file type
  const fileType = mimeType || MIME_TYPES[extension] || 'application/octet-stream';
  
  return { 
    valid: true, 
    fileType,
    extension,
  };
};

// ============================================
// INPUT SANITIZATION
// ============================================

/**
 * Sanitize document title
 */
export const sanitizeTitle = (title: string): string => {
  if (!title) return 'Untitled Document';
  
  return title
    // Remove file extension
    .replace(/\.[^/.]+$/, '')
    // Remove special characters
    .replace(/[<>:"/\\|?*]/g, '')
    // Trim whitespace
    .trim()
    // Limit length
    .substring(0, 255)
    || 'Untitled Document';
};

/**
 * Sanitize search query
 */
export const sanitizeSearchQuery = (query: string): string => {
  if (!query) return '';
  
  return query
    // Remove potentially dangerous characters
    .replace(/[<>{}[\]\\]/g, '')
    // Trim whitespace
    .trim()
    // Limit length
    .substring(0, 500);
};
