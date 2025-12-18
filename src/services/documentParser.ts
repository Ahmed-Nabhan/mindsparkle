import * as FileSystem from 'expo-file-system';
import { Document } from '../types/document';

/**
 * Parse document content from file
 */
export const parseDocument = async (fileUri: string, fileType: string): Promise<string> => {
  try {
    // For text files, read directly
    if (fileType === 'text/plain' || fileType.includes('txt')) {
      const content = await FileSystem.readAsStringAsync(fileUri);
      return content;
    }
    
    // For PDF and DOCX, we'll need to implement or use a library
    // For now, return a placeholder
    console.warn('PDF and DOCX parsing not yet implemented');
    return 'Document content will be parsed here. PDF and DOCX support coming soon.';
  } catch (error) {
    console.error('Error parsing document:', error);
    throw new Error('Failed to parse document');
  }
};

/**
 * Extract metadata from document
 */
export const extractMetadata = async (fileUri: string): Promise<any> => {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    return {
      size: info.exists && !info.isDirectory ? (info as any).size : 0,
      exists: info.exists,
      uri: info.uri,
    };
  } catch (error) {
    console.error('Error extracting metadata:', error);
    throw new Error('Failed to extract metadata');
  }
};

/**
 * Validate document
 */
export const validateDocument = (document: Partial<Document>): boolean => {
  if (!document.fileName || !document.fileUri) {
    return false;
  }
  
  return true;
};
