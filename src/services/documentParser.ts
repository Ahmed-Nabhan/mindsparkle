import * as FileSystem from 'expo-file-system/legacy';

const MAX_CHUNK_SIZE = 12000;
const MAX_FILE_SIZE_MB = 10240;
const CHUNK_READ_SIZE = 1024 * 1024; // Read 1MB at a time

export interface ParsedDocument {
  content: string;
  chunks: string[];
  totalChunks: number;
  isLargeFile: boolean;
}

export const parseDocument = async (fileUri: string, fileType: string): Promise<ParsedDocument> => {
  try {
    const fileInfo = await FileSystem. getInfoAsync(fileUri);
    const fileSize = fileInfo. exists && ! fileInfo.isDirectory ?  (fileInfo as any).size : 0;
    const fileSizeMB = fileSize / (1024 * 1024);

    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      throw new Error('File too large.  Maximum size is ' + MAX_FILE_SIZE_MB + 'MB.');
    }

    let content = '';

    if (fileType === 'text/plain' || fileType. includes('txt')) {
      content = await FileSystem. readAsStringAsync(fileUri);
    } else if (fileType === 'application/pdf' || fileType.includes('pdf')) {
      content = await extractPdfTextChunked(fileUri, fileSize);
    } else if (fileType.includes('word') || fileType.includes('docx') || fileType.includes('doc')) {
      content = await extractDocText(fileUri);
    } else if (fileType.includes('powerpoint') || fileType.includes('pptx') || fileType.includes('ppt') || fileType.includes('presentation')) {
      content = await extractPptxText(fileUri);
    } else {
      throw new Error('Unsupported file type. Please upload PDF, TXT, Word, or PowerPoint documents.');
    }

    if (! content || content.trim().length < 20) {
      throw new Error('Could not extract text.  The file may be scanned/image-based.');
    }

    const chunks = splitIntoChunks(content, MAX_CHUNK_SIZE);

    return {
      content:  content,
      chunks: chunks,
      totalChunks:  chunks.length,
      isLargeFile: chunks.length > 1,
    };
  } catch (error:  any) {
    console.error('Error parsing document:', error);
    throw new Error(error.message || 'Failed to parse document');
  }
};

const extractPdfTextChunked = async (fileUri: string, fileSize: number): Promise<string> => {
  try {
    let extractedText = '';
    const chunkSize = CHUNK_READ_SIZE;
    const totalChunks = Math.ceil(fileSize / chunkSize);
    
    // For very large files, only read first 20MB to extract text
    const maxBytesToRead = Math.min(fileSize, 20 * 1024 * 1024);
    const chunksToRead = Math.ceil(maxBytesToRead / chunkSize);
    
    console.log('Processing PDF:  ' + (fileSize / (1024 * 1024)).toFixed(2) + 'MB in ' + chunksToRead + ' chunks');

    for (let i = 0; i < chunksToRead; i++) {
      try {
        // Read file in base64 chunks
        const base64Chunk = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
          position: i * chunkSize,
          length: chunkSize,
        });

        if (!base64Chunk || base64Chunk.length === 0) continue;

        // Decode base64 to binary string
        const binaryString = atob(base64Chunk);
        
        // Extract text using simple pattern matching (no complex regex)
        const chunkText = extractTextSimple(binaryString);
        extractedText += chunkText + ' ';
        
        // Clear memory
        if (extractedText.length > 500000) {
          // Keep only meaningful content, trim excess
          extractedText = extractedText. substring(0, 500000);
          break;
        }
      } catch (chunkError) {
        console. log('Chunk ' + i + ' read error, skipping...');
        continue;
      }
    }

    // Clean up final text
    extractedText = cleanText(extractedText);

    if (extractedText. length < 30) {
      throw new Error('PDF may be scanned/image-based. Text extraction requires OCR.');
    }

    console.log('Extracted ' + extractedText. length + ' characters from PDF');
    return extractedText;
  } catch (error:  any) {
    throw new Error(error.message || 'Could not extract text from PDF.');
  }
};

const extractTextSimple = function(binaryString:  string): string {
  var result = '';
  var inText = false;
  var currentText = '';
  
  for (var i = 0; i < binaryString.length; i++) {
    var char = binaryString[i];
    var charCode = binaryString.charCodeAt(i);
    
    if (char === '(') {
      inText = true;
      currentText = '';
    } else if (char === ')' && inText) {
      inText = false;
      if (currentText.length > 1) {
        // Filter readable ASCII
        var readable = '';
        for (var j = 0; j < currentText. length; j++) {
          var c = currentText. charCodeAt(j);
          if (c >= 32 && c <= 126) {
            readable += currentText[j];
          }
        }
        if (readable.length > 1 && /[a-zA-Z]/.test(readable)) {
          result += readable + ' ';
        }
      }
    } else if (inText) {
      currentText += char;
    }
  }
  
  return result;
};

const cleanText = function(text: string): string {
  // Remove non-printable characters
  var cleaned = '';
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if ((code >= 32 && code <= 126) || code === 10 || code === 13) {
      cleaned += text[i];
    } else {
      cleaned += ' ';
    }
  }
  
  // Collapse multiple spaces
  cleaned = cleaned.replace(/  +/g, ' ').trim();
  
  return cleaned;
};

const extractDocText = async (fileUri: string): Promise<string> => {
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const binaryString = atob(base64);
    
    var textContent = binaryString
      .replace(/<w:t[^>]*>([^<]+)<\/w:t>/g, '$1 ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (textContent.length < 30) {
      throw new Error('Could not extract text from Word document.');
    }

    return textContent;
  } catch (error: any) {
    throw new Error(error.message || 'Could not extract text from Word document.');
  }
};

// Extract text from PowerPoint (PPTX) files
const extractPptxText = async (fileUri: string): Promise<string> => {
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const binaryString = atob(base64);
    
    // PPTX files are ZIP archives containing XML
    // Extract text from slide content using XML patterns
    var textContent = '';
    
    // Match text content in PowerPoint XML format
    // <a:t> tags contain text in PPTX files
      // Avoid running global regex on the entire binary string for large files.
      // Instead scan iteratively and collect a bounded number of matches.
      const MAX_PPTX_MATCHES = 5000;
      let pptxMatches = 0;
      for (let i = 0; i < binaryString.length; i++) {
        if (binaryString[i] === '<' && binaryString.substring(i, i + 4) === '<a:t') {
          // find '>'
          const startTagEnd = binaryString.indexOf('>', i);
          if (startTagEnd === -1) continue;
          const closeTag = '</a:t>';
          const endIdx = binaryString.indexOf(closeTag, startTagEnd + 1);
          if (endIdx === -1) continue;
          const text = binaryString.substring(startTagEnd + 1, endIdx);
          if (text && text.length > 0) {
            textContent += text + ' ';
            pptxMatches++;
            if (pptxMatches >= MAX_PPTX_MATCHES) break;
          }
          i = endIdx + closeTag.length - 1;
        }
      }
    
    // Also try to match <p:txBody> content
      // Additional safe scan for <p:txBody> inner text (if any)
      // (This is a lighter pass and will stop early if too many matches.)
      let bodyMatchesCount = 0;
      const MAX_BODY_MATCHES = 2000;
      for (let i = 0; i < binaryString.length; i++) {
        if (binaryString.substring(i, i + 8) === '<p:txBody') {
          // find the nearest closing </p:txBody> and scan contained <a:t> tags
          const blockEnd = binaryString.indexOf('</p:txBody>', i);
          const block = blockEnd === -1 ? binaryString.substring(i, Math.min(i + 10000, binaryString.length)) : binaryString.substring(i, blockEnd);
          // scan block for <a:t> occurrences
          for (let j = 0; j < block.length; j++) {
            if (block[j] === '<' && block.substring(j, j + 3) === '<a:') {
              const startTagEnd = block.indexOf('>', j);
              if (startTagEnd === -1) continue;
              const closeTag = '</a:t>';
              const endIdx = block.indexOf(closeTag, startTagEnd + 1);
              if (endIdx === -1) continue;
              const text = block.substring(startTagEnd + 1, endIdx);
              if (text && text.length > 0 && !textContent.includes(text)) {
                textContent += text + ' ';
                bodyMatchesCount++;
                if (bodyMatchesCount >= MAX_BODY_MATCHES) break;
              }
              j = endIdx + closeTag.length - 1;
            }
          }
          if (bodyMatchesCount >= MAX_BODY_MATCHES) break;
          i = blockEnd === -1 ? i + 10000 : blockEnd + 10;
        }
      }
    
    // Clean up extracted text
    textContent = textContent
      .replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (textContent.length < 30) {
      // Fallback: try to extract any readable ASCII text
      textContent = extractReadableText(binaryString);
    }
    
    if (textContent.length < 30) {
      throw new Error('Could not extract text from PowerPoint. The file may contain only images.');
    }

    console.log('Extracted ' + textContent.length + ' characters from PPTX');
    return textContent;
  } catch (error: any) {
    throw new Error(error.message || 'Could not extract text from PowerPoint document.');
  }
};

// Extract readable ASCII text from binary
const extractReadableText = (binaryString: string): string => {
  let result = '';
  let currentWord = '';
  
  for (let i = 0; i < binaryString.length; i++) {
    const code = binaryString.charCodeAt(i);
    
    // Check if character is printable ASCII
    if (code >= 32 && code <= 126) {
      currentWord += binaryString[i];
    } else {
      // End of word
      if (currentWord.length >= 3 && /[a-zA-Z]{2,}/.test(currentWord)) {
        result += currentWord + ' ';
      }
      currentWord = '';
    }
  }
  
  // Clean up: remove duplicate words and short sequences
  const words = result.split(' ').filter(w => w.length >= 3);
  const uniqueWords = [...new Set(words)];
  
  return uniqueWords.join(' ').trim();
};

const splitIntoChunks = function(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) {
    return [text];
  }

  var chunks: string[] = [];
  var start = 0;
  
  while (start < text.length) {
    var end = Math.min(start + maxSize, text.length);
    
    // Try to break at a space
    if (end < text.length) {
      var lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) {
        end = lastSpace;
      }
    }
    
    chunks.push(text. substring(start, end).trim());
    start = end + 1;
  }

  return chunks;
};

export const extractMetadata = async (fileUri: string): Promise<any> => {
  const info = await FileSystem. getInfoAsync(fileUri);
  return {
    size: info.exists && !info.isDirectory ? (info as any).size : 0,
    exists: info.exists,
    uri: info.uri,
  };
};

export const validateDocument = function(doc: any): boolean {
  return ! !(doc && doc.fileName && doc.fileUri);
};
