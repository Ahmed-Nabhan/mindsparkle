export interface Document {
  id: string;
  title: string;
  fileName: string;
  fileUri: string;
  fileType: string;
  fileSize: number;
  uploadedAt: Date;
  content?: string;
  summary?: string;
  userId?: string;
}

export interface DocumentUploadResult {
  success: boolean;
  document?: Document;
  error?: string;
}

export interface DocumentMetadata {
  pageCount?: number;
  wordCount?: number;
  characterCount?: number;
  language?: string;
}
