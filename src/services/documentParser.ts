import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';

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

// Extract text from PowerPoint (PPTX) files using proper ZIP parsing
const extractPptxText = async (fileUri: string): Promise<string> => {
  try {
    // Get file info first
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = (fileInfo as any).size || 0;
    const fileSizeMB = Math.round(fileSize / (1024 * 1024));
    
    console.log('[PPTX] Processing file with JSZip, size:', fileSizeMB, 'MB');
    
    // For very large files (>50MB), skip local processing - too slow/memory intensive
    if (fileSizeMB > 50) {
      console.log('[PPTX] File too large for local processing, will use cloud');
      throw new Error('File too large for local processing (>50MB). Using cloud extraction.');
    }
    
    // Read file as base64
    console.log('[PPTX] Reading file as base64...');
    const base64Content = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    console.log('[PPTX] Base64 content length:', base64Content.length);
    
    // PPTX is a ZIP file - use JSZip to properly extract
    console.log('[PPTX] Loading ZIP...');
    const zip = new JSZip();
    await zip.loadAsync(base64Content, { base64: true });
    
    // Debug: list all files in the ZIP
    const allFiles: string[] = [];
    zip.forEach((relativePath: string) => {
      allFiles.push(relativePath);
    });
    console.log('[PPTX] ZIP contains', allFiles.length, 'files');
    console.log('[PPTX] Sample files:', allFiles.slice(0, 10));
    
    // Find all slide XML files
    const slideFiles: string[] = [];
    zip.forEach((relativePath: string) => {
      if (relativePath.match(/ppt\/slides\/slide\d+\.xml$/)) {
        slideFiles.push(relativePath);
      }
    });
    
    // Sort by slide number
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });
    
    console.log('[PPTX] Found', slideFiles.length, 'slides:', slideFiles.slice(0, 5));
    
    let allText = '';
    
    // Extract text from each slide
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideXml = await zip.file(slideFile)?.async('string');
      
      if (slideXml) {
        // Debug first slide
        if (i === 0) {
          console.log('[PPTX] First slide XML length:', slideXml.length);
          console.log('[PPTX] First slide XML preview:', slideXml.substring(0, 500));
        }
        
        // Extract all <a:t> text elements - handle various formats
        // Pattern 1: <a:t>text</a:t>
        // Pattern 2: <a:t xml:space="preserve">text</a:t>
        const slideTexts: string[] = [];
        
        // Use a more robust approach - find all a:t tags and extract content
        let searchStart = 0;
        while (searchStart < slideXml.length) {
          const tagStart = slideXml.indexOf('<a:t', searchStart);
          if (tagStart === -1) break;
          
          const tagEnd = slideXml.indexOf('>', tagStart);
          if (tagEnd === -1) break;
          
          // Check if self-closing tag
          if (slideXml[tagEnd - 1] === '/') {
            searchStart = tagEnd + 1;
            continue;
          }
          
          const closeTag = '</a:t>';
          const closeStart = slideXml.indexOf(closeTag, tagEnd);
          if (closeStart === -1) {
            searchStart = tagEnd + 1;
            continue;
          }
          
          const text = slideXml.substring(tagEnd + 1, closeStart);
          if (text && text.trim()) {
            // Decode XML entities
            const decoded = text
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
              .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
              .trim();
            if (decoded) {
              slideTexts.push(decoded);
            }
          }
          
          searchStart = closeStart + closeTag.length;
        }
        
        // Debug first slide extraction
        if (i === 0) {
          console.log('[PPTX] First slide extracted texts:', slideTexts.length, 'items');
          console.log('[PPTX] First slide sample:', slideTexts.slice(0, 5));
        }
        
        if (slideTexts.length > 0) {
          allText += `\n--- Slide ${i + 1} ---\n${slideTexts.join(' ')}\n`;
        }
      }
      
      // Progress logging every 50 slides
      if (i > 0 && i % 50 === 0) {
        console.log('[PPTX] Processed', i, '/', slideFiles.length, 'slides');
      }
    }
    
    // Also try to extract from notesSlides (speaker notes)
    try {
      const notesFiles: string[] = [];
      zip.forEach((relativePath: string) => {
        if (relativePath.match(/ppt\/notesSlides\/notesSlide\d+\.xml$/)) {
          notesFiles.push(relativePath);
        }
      });
      
      if (notesFiles.length > 0) {
        console.log('[PPTX] Found', notesFiles.length, 'notes slides');
        allText += '\n\n--- Speaker Notes ---\n';
        
        for (const notesFile of notesFiles) {
          const notesXml = await zip.file(notesFile)?.async('string');
          if (notesXml) {
            const textPattern = /<a:t[^>]*>([^<]*)<\/a:t>/g;
            let match;
            while ((match = textPattern.exec(notesXml)) !== null) {
              const text = match[1].trim();
              if (text && text.length > 2) {
                allText += text + ' ';
              }
            }
          }
        }
      }
    } catch (notesError) {
      // Ignore notes extraction errors
    }
    
    // Clean up the text
    allText = allText.trim();
    
    console.log('[PPTX] Extracted', allText.length, 'chars from', slideFiles.length, 'slides');
    
    if (allText.length < 30) {
      throw new Error('Could not extract text from PowerPoint. The file may contain only images or be corrupted.');
    }
    
    return allText;
    
  } catch (error: any) {
    console.error('[PPTX] Extraction error:', error.message);
    
    // Fall back to legacy streaming extraction for very large files
    if (error.message?.includes('memory') || error.message?.includes('heap')) {
      console.log('[PPTX] Falling back to streaming extraction due to memory');
      return extractPptxTextStreaming(fileUri);
    }
    
    throw new Error(error.message || 'Could not extract text from PowerPoint document.');
  }
};

// Legacy streaming extraction for very large PPTX files
const extractPptxTextStreaming = async (fileUri: string): Promise<string> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = (fileInfo as any).size || 0;
    const fileSizeMB = Math.round(fileSize / (1024 * 1024));
    
    console.log('[PPTX] Streaming fallback for', fileSizeMB, 'MB file');
    
    // True streaming: read file in small chunks
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB raw chunks
    const MAX_TOTAL_TEXT = 800000;
    const MAX_PPTX_MATCHES = 10000;
    const MAX_BYTES_TO_READ = 150 * 1024 * 1024;
    
    let textContent = '';
    let pptxMatches = 0;
    let bytesRead = 0;
    let chunkIdx = 0;
    let carryOver = '';
    
    while (bytesRead < fileSize && bytesRead < MAX_BYTES_TO_READ && pptxMatches < MAX_PPTX_MATCHES) {
      try {
        const base64Chunk = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
          position: bytesRead,
          length: CHUNK_SIZE,
        });
        
        if (!base64Chunk || base64Chunk.length === 0) break;
        
        let binaryChunk: string;
        try {
          binaryChunk = atob(base64Chunk);
        } catch (e) {
          bytesRead += CHUNK_SIZE;
          chunkIdx++;
          continue;
        }
        
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
            
            if (endIdx === -1) {
              carryOver = fullChunk.substring(i);
              break;
            }
            
            if (endIdx > startTagEnd + 500) continue;
            
            const text = fullChunk.substring(startTagEnd + 1, endIdx);
            if (text && text.length > 0 && text.length < 200) {
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
        
        if (textContent.length > MAX_TOTAL_TEXT) {
          textContent = textContent.substring(0, MAX_TOTAL_TEXT);
          break;
        }
        
        bytesRead += CHUNK_SIZE;
        chunkIdx++;
        
        if (chunkIdx % 10 === 0) {
          console.log('[PPTX Streaming] Processed', Math.round(bytesRead / (1024 * 1024)), 'MB');
        }
        
      } catch (chunkError: any) {
        bytesRead += CHUNK_SIZE;
        chunkIdx++;
        continue;
      }
    }
    
    textContent = textContent.trim();
    
    if (textContent.length < 30) {
      throw new Error('Could not extract text from PowerPoint. The file may contain only images.');
    }
    
    console.log('[PPTX Streaming] Extracted', textContent.length, 'chars');
    return textContent;
    
  } catch (error: any) {
    console.error('[PPTX Streaming] Error:', error.message);
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
