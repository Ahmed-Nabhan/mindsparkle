import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Document } from '../types/document';

interface ExtractedContent {
  text: string;
  images: ImageContent[];
  tables: TableContent[];
  equations: string[];
  logos: ImageContent[];
  diagrams: ImageContent[];
}

interface ImageContent {
  url: string;
  caption: string;
  pageNumber: number;
}

interface TableContent {
  headers: string[];
  rows: string[][];
  caption: string;
  pageNumber: number;
}

interface TeacherSettings {
  gender: 'male' | 'female';
  voiceSpeed: number;
  language: string;
}

interface DocumentContextType {
  currentDocument: Document | null;
  extractedContent: ExtractedContent | null;
  teacherSettings: TeacherSettings;
  isProcessing: boolean;
  processingMessage: string;
  setCurrentDocument: (doc: Document | null) => void;
  setExtractedContent: (content: ExtractedContent | null) => void;
  setTeacherSettings: (settings: TeacherSettings) => void;
  setIsProcessing: (loading: boolean) => void;
  setProcessingMessage: (msg:  string) => void;
  clearDocument: () => void;
}

var DocumentContext = createContext<DocumentContextType | undefined>(undefined);

export function DocumentProvider({ children }: { children:  ReactNode }) {
  var [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  var [extractedContent, setExtractedContent] = useState<ExtractedContent | null>(null);
  var [isProcessing, setIsProcessing] = useState(false);
  var [processingMessage, setProcessingMessage] = useState('');
  var [teacherSettings, setTeacherSettings] = useState<TeacherSettings>({
    gender: 'male',
    voiceSpeed: 1,
    language: 'en-US',
  });

  var clearDocument = function() {
    setCurrentDocument(null);
    setExtractedContent(null);
  };

  return (
    <DocumentContext.Provider
      value={{
        currentDocument,
        extractedContent,
        teacherSettings,
        isProcessing,
        processingMessage,
        setCurrentDocument,
        setExtractedContent,
        setTeacherSettings,
        setIsProcessing,
        setProcessingMessage,
        clearDocument,
      }}
    >
      {children}
    </DocumentContext. Provider>
  );
}

export function useDocumentContext() {
  var context = useContext(DocumentContext);
  if (context === undefined) {
    throw new Error('useDocumentContext must be used within a DocumentProvider');
  }
  return context;
}
