export interface Document {
  id: string;
  title: string;
  fileName: string;
  fileUri: string;
  fileType: string;
  fileSize: number;
  uploadedAt: Date;
  updatedAt?: Date;
  content?:  string;
  chunks?: string[];
  totalChunks?: number;
  isLargeFile?: boolean;
  summary?: string;
  userId?: string;
  pdfCloudUrl?: string;
  extractedData?: ExtractedData;
}

export interface ExtractedData {
  text: string;
  pages: PageContent[];
  images: ExtractedImage[];
  tables: ExtractedTable[];
  equations:  string[];
  totalPages: number;
}

export interface PageContent {
  pageNumber: number;
  text: string;
  images: ExtractedImage[];
  tables: ExtractedTable[];
}

export interface ExtractedImage {
  id: string;
  url: string;
  base64?:  string;
  caption:  string;
  pageNumber: number;
  type: 'logo' | 'diagram' | 'chart' | 'photo' | 'icon' | 'figure';
}

export interface ExtractedTable {
  id: string;
  title: string;
  headers: string[];
  rows: string[][];
  pageNumber: number;
}

export interface DocumentUploadResult {
  success:  boolean;
  document?:  Document;
  error?: string;
}

export interface DocumentMetadata {
  pageCount?:  number;
  wordCount?: number;
  characterCount?: number;
  language?: string;
}

export interface VideoLesson {
  id: string;
  title: string;
  sections: VideoSection[];
  teacher: TeacherConfig;
  totalDuration: string;
}

export interface VideoSection {
  id: string;
  title:  string;
  timestamp: string;
  duration: number;
  narration: string;
  visuals: SectionVisual[];
  keyPoints: string[];
}

export interface SectionVisual {
  type: 'text' | 'image' | 'table' | 'equation' | 'diagram';
  content: any;
  caption?: string;
}

export interface TeacherConfig {
  gender: 'male' | 'female';
  name: string;
  avatar: string;
  voiceId: string;
}
