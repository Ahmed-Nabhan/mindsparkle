import React, { createContext, useState, useContext, ReactNode } from 'react';
import { Document } from '../types/document';

interface DocumentContextType {
  currentDocument: Document | null;
  setCurrentDocument: (document: Document | null) => void;
  documents: Document[];
  setDocuments: (documents: Document[]) => void;
}

const DocumentContext = createContext<DocumentContextType | undefined>(undefined);

export const DocumentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  return (
    <DocumentContext.Provider
      value={{
        currentDocument,
        setCurrentDocument,
        documents,
        setDocuments,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
};

export const useDocument = () => {
  const context = useContext(DocumentContext);
  if (context === undefined) {
    throw new Error('useDocument must be used within a DocumentProvider');
  }
  return context;
};
