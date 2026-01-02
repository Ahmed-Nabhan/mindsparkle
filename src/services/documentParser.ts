import * as FileSystem from 'expo-file-system';

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
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = fileInfo.exists && !fileInfo.isDirectory ?  (fileInfo as any).size : 0;
    const fileSizeMB = fileSize / (1024 * 1024);

    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      throw new Error('File too large.  Maximum size is ' + MAX_FILE_SIZE_MB + 'MB.');
    }

    let content = '';

    if (fileType === 'text/plain' || fileType.includes('txt')) {
      content = await FileSystem.readAsStringAsync(fileUri);
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
      throw new Error('Could not extract text. The file may be scanned/image-based.');
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
          extractedText = extractedText.substring(0, 500000);
          break;
        }
      } catch (chunkError) {
        console.log('Chunk ' + i + ' read error, skipping...');
        continue;
      }
    }

    // Clean up final text
    extractedText = cleanText(extractedText);

    if (extractedText.length < 30) {
      throw new Error('PDF may be scanned/image-based. Text extraction requires OCR.');
    }

    console.log('Extracted ' + extractedText.length + ' characters from PDF');
    return extractedText;
  } catch (error:  any) {
    throw new Error(error.message || 'Could not extract text from PDF.');
  }
};

const extractTextSimple = function(binaryString:  string): string {
  var result = '';
  var inText = false;
  var currentText = '';
  
  // Method 1: Standard PDF text in parentheses (...)
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
        for (var j = 0; j < currentText.length; j++) {
          var c = currentText.charCodeAt(j);
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
  
  // Method 2: Extract hex-encoded text <...> common in PDFs with custom fonts
  // Look for patterns like <0048006500..> where each 4 hex chars = 1 character
  var hexMatches = binaryString.match(/<[0-9A-Fa-f]{8,}>/g) || [];
  for (var h = 0; h < hexMatches.length && h < 1000; h++) {
    var hex = hexMatches[h].slice(1, -1); // Remove < >
    var decoded = '';
    // Try UTF-16BE decoding (2 bytes per char)
    for (var k = 0; k < hex.length - 3; k += 4) {
      var codePoint = parseInt(hex.substr(k, 4), 16);
      if (codePoint >= 32 && codePoint <= 126) {
        decoded += String.fromCharCode(codePoint);
      } else if (codePoint >= 0x20 && codePoint <= 0xFFFF) {
        // Try as Unicode
        var ch = String.fromCharCode(codePoint);
        if (/[\w\s.,!?;:'-]/.test(ch)) {
          decoded += ch;
        }
      }
    }
    if (decoded.length > 2 && /[a-zA-Z]{2,}/.test(decoded)) {
      result += decoded + ' ';
    }
  }
  
  // Method 3: Look for BT...ET text blocks and extract Tj/TJ operators
  var btMatches = binaryString.match(/BT[\s\S]{1,2000}?ET/g) || [];
  for (var b = 0; b < btMatches.length && b < 500; b++) {
    var block = btMatches[b];
    // Look for Tj operator (string) Tj
    var tjMatches = block.match(/\(([^)]{1,200})\)\s*Tj/g) || [];
    for (var t = 0; t < tjMatches.length; t++) {
      var match = tjMatches[t].match(/\(([^)]+)\)/);
      if (match && match[1]) {
        var txt = match[1];
        var clean = '';
        for (var m = 0; m < txt.length; m++) {
          var code = txt.charCodeAt(m);
          if (code >= 32 && code <= 126) clean += txt[m];
        }
        if (clean.length > 1 && /[a-zA-Z]/.test(clean)) {
          result += clean + ' ';
        }
      }
    }
  }
  
  // Method 4: Extract text from stream content (decompressed text)
  // Look for readable word sequences
  var words = binaryString.match(/[A-Za-z][a-z]{2,15}(?:\s+[A-Za-z][a-z]{2,15}){2,}/g) || [];
  for (var w = 0; w < words.length && w < 500; w++) {
    result += words[w] + ' ';
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
  
  // Collapse multiple spaces iteratively to avoid OOM on large strings
  // Instead of global regex, we'll split and join which is safer for massive strings
  // or just leave it if it's too big.
  if (cleaned.length > 1000000) {
     // For huge strings, just return as is to be safe, or do a very simple pass
     return cleaned;
  }
  
  // Safe for reasonable sizes
  return cleaned.replace(/  +/g, ' ').trim();
};

const extractDocText = async (fileUri: string): Promise<string> => {
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const binaryString = atob(base64);
    
    // Avoid chaining multiple global regexes on the full string
    // Process in a more memory-efficient way if possible
    // For now, we'll just simplify the regexes to be less aggressive
    
    let textContent = binaryString;
    
    // 1. Remove XML tags (iterative or simplified)
    textContent = textContent.replace(/<[^>]+>/g, ' ');
    
    // 2. Keep only printable
    textContent = textContent.replace(/[^\x20-\x7E\n]/g, ' ');
    
    // 3. Collapse spaces (only if size permits)
    if (textContent.length < 1000000) {
        textContent = textContent.replace(/\s+/g, ' ');
    }
    
    textContent = textContent.trim();

    if (textContent.length < 30) {
      throw new Error('Could not extract text from Word document.');
    }

    return textContent;
  } catch (error: any) {
    throw new Error(error.message || 'Could not extract text from Word document.');
  }
};

// Extract text from PowerPoint (PPTX) files - handles large files with true streaming
const extractPptxText = async (fileUri: string): Promise<string> => {
  try {
    // Get file info first
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = (fileInfo as any).size || 0;
    const fileSizeMB = Math.round(fileSize / (1024 * 1024));
    
    console.log('[PPTX] Processing file, size:', fileSizeMB, 'MB');
    
    // True streaming: read file in small chunks, never load entire file
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB raw chunks
    const MAX_TOTAL_TEXT = 800000; // Increased max chars to extract for large presentations
    const MAX_PPTX_MATCHES = 10000; // Increased: 542 slides × ~10-15 blocks each = need 5000-8000+
    const MAX_BYTES_TO_READ = 150 * 1024 * 1024; // Increased: read more of large files (150MB max)
    
    let textContent = '';
    let pptxMatches = 0;
    let bytesRead = 0;
    let chunkIdx = 0;
    let carryOver = ''; // Text that spans chunk boundaries
    
    console.log('[PPTX] Using streaming mode for', fileSizeMB, 'MB file');
    
    while (bytesRead < fileSize && bytesRead < MAX_BYTES_TO_READ && pptxMatches < MAX_PPTX_MATCHES) {
      try {
        // Read chunk directly from file (this is the key - read only what we need)
        const base64Chunk = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
          position: bytesRead,
          length: CHUNK_SIZE,
        });
        
        if (!base64Chunk || base64Chunk.length === 0) break;
        
        // Decode this chunk only
        let binaryChunk: string;
        try {
          binaryChunk = atob(base64Chunk);
        } catch (e) {
          console.log('[PPTX] Chunk', chunkIdx, 'decode failed, skipping');
          bytesRead += CHUNK_SIZE;
          chunkIdx++;
          continue;
        }
        
        // Prepend any carry-over from previous chunk
        const fullChunk = carryOver + binaryChunk;
        carryOver = '';
        
        // Extract <a:t> tags from this chunk
        let lastProcessedIdx = 0;
        for (let i = 0; i < fullChunk.length && pptxMatches < MAX_PPTX_MATCHES; i++) {
          if (fullChunk[i] === '<' && i + 4 < fullChunk.length && fullChunk.substring(i, i + 4) === '<a:t') {
            const startTagEnd = fullChunk.indexOf('>', i);
            if (startTagEnd === -1 || startTagEnd > i + 50) continue;
            
            const closeTag = '</a:t>';
            const endIdx = fullChunk.indexOf(closeTag, startTagEnd + 1);
            
            // If we can't find close tag, might span chunks
            if (endIdx === -1) {
              // Save the rest for next chunk
              carryOver = fullChunk.substring(i);
              break;
            }
            
            if (endIdx > startTagEnd + 500) continue;
            
            const text = fullChunk.substring(startTagEnd + 1, endIdx);
            if (text && text.length > 0 && text.length < 200) {
              // Clean text char by char (no regex)
              let cleanText = '';
              for (let c = 0; c < text.length; c++) {
                const code = text.charCodeAt(c);
                if (code >= 32 && code <= 126) cleanText += text[c];
              }
              if (cleanText.length > 0) {
                textContent += cleanText + ' ';
                pptxMatches++;
              }
            }
            lastProcessedIdx = endIdx + closeTag.length;
            i = lastProcessedIdx - 1;
          }
        }
        
        // Check if we have enough text
        if (textContent.length > MAX_TOTAL_TEXT) {
          textContent = textContent.substring(0, MAX_TOTAL_TEXT);
          break;
        }
        
        bytesRead += CHUNK_SIZE;
        chunkIdx++;
        
        // Log progress every 10 chunks
        if (chunkIdx % 10 === 0) {
          console.log('[PPTX] Processed', Math.round(bytesRead / (1024 * 1024)), 'MB, found', pptxMatches, 'text blocks');
        }
        
      } catch (chunkError: any) {
        console.log('[PPTX] Chunk', chunkIdx, 'error:', chunkError.message);
        bytesRead += CHUNK_SIZE;
        chunkIdx++;
        continue;
      }
    }
    
    // Simple cleanup
    textContent = textContent.trim();
    
    // Add note if file was truncated
    if (bytesRead < fileSize) {
      const percentRead = Math.round((bytesRead / fileSize) * 100);
      textContent = '[Note: Large presentation (' + fileSizeMB + 'MB). Processed ' + percentRead + '% of content.]\n\n' + textContent;
    }

    console.log('[PPTX] Extracted', textContent.length, 'chars,', pptxMatches, 'text blocks from', Math.round(bytesRead / (1024 * 1024)), 'MB');

    if (textContent.length < 30) {
      throw new Error('Could not extract text from PowerPoint. The file may contain only images.');
    }

    console.log('[PPTX] Extracted ' + textContent.length + ' characters, ' + pptxMatches + ' text blocks');
    return textContent;
  } catch (error: any) {
    console.error('[PPTX] Extraction error:', error.message);
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
    
    chunks.push(text.substring(start, end).trim());
    start = end + 1;
  }

  return chunks;
};

export const extractMetadata = async (fileUri: string): Promise<any> => {
  const info = await FileSystem.getInfoAsync(fileUri);
  return {
    size: info.exists && !info.isDirectory ? (info as any).size : 0,
    exists: info.exists,
    uri: info.uri,
  };
};

export const validateDocument = function(doc: any): boolean {
  return ! !(doc && doc.fileName && doc.fileUri);
};
