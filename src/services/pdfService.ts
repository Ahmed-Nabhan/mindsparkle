// Centralized PDF Processing Service
// All PDF operations go through here - update once, reflects everywhere

import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import Config from './config';

var pdfCoClient = axios.create({
  timeout: Config.UPLOAD_TIMEOUT,
  headers: { 'x-api-key': Config.PDFCO_API_KEY },
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});

// Read file as base64
export var readFileAsBase64 = async function(fileUri: string): Promise<string> {
  console.log('Reading file as base64...');
  var base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('File size:', Math.round(base64.length / 1024), 'KB');
  return base64;
};

// Upload PDF using presigned URL (much faster for large files)
async function uploadWithPresignedUrl(base64: string): Promise<string> {
  console.log('Getting presigned URL for upload...');
  
  // Step 1: Get presigned URL
  var presignedResp = await pdfCoClient.get(Config.PDFCO_PRESIGNED_URL, {
    params: { name: 'document.pdf', contenttype: 'application/pdf' },
    timeout: 30000,
  });
  
  if (presignedResp.data.error || !presignedResp.data.presignedUrl) {
    throw new Error('Failed to get presigned URL: ' + (presignedResp.data.message || 'Unknown error'));
  }
  
  var presignedUrl = presignedResp.data.presignedUrl;
  var fileUrl = presignedResp.data.url;
  
  console.log('Uploading via presigned URL...');
  
  // Step 2: Convert base64 to binary and upload
  var binaryData = Uint8Array.from(atob(base64), function(c) { return c.charCodeAt(0); });
  
  await axios.put(presignedUrl, binaryData, {
    headers: { 'Content-Type': 'application/pdf' },
    timeout: Config.UPLOAD_TIMEOUT,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  
  console.log('Upload complete via presigned URL');
  return fileUrl;
}

// Upload PDF to PDF.co cloud (auto-selects best method)
export var uploadPdf = async function(base64: string): Promise<string> {
  var fileSizeBytes = base64.length * 0.75; // base64 is ~33% larger than binary
  
  // For large files (>10MB), use presigned URL upload
  if (fileSizeBytes > Config.LARGE_FILE_THRESHOLD) {
    console.log('Large file detected (' + Math.round(fileSizeBytes / 1024 / 1024) + 'MB), using presigned upload...');
    try {
      return await uploadWithPresignedUrl(base64);
    } catch (err: any) {
      console.log('Presigned upload failed, falling back to base64:', err.message);
      // Fall through to base64 upload
    }
  }
  
  // Standard base64 upload for smaller files
  console.log('Uploading PDF to cloud...');
  var response = await pdfCoClient.post(Config.PDFCO_UPLOAD_URL, {
    file: base64,
    name: 'document.pdf'
  });
  
  if (response.data.error || !response.data.url) {
    throw new Error('Upload failed: ' + (response.data.message || 'No URL'));
  }
  
  console.log('Uploaded successfully');
  return response.data.url;
};

// Get PDF info (page count, etc)
export var getPdfInfo = async function(pdfUrl: string): Promise<{ pageCount: number; bookmarks?: string; title?: string }> {
  try {
    console.log('Getting PDF info...');
    var response = await pdfCoClient.post(Config.PDFCO_INFO_URL, { url: pdfUrl }, {
      timeout: Config.EXTRACT_TIMEOUT,
    });
    
    console.log('PDF info response:', JSON.stringify(response.data));
    
    // PDF.co returns "info" object with "PageCount" (capital P)
    var pageCount = 1;
    var bookmarks = '';
    var title = '';
    
    if (response.data.info) {
      pageCount = response.data.info.PageCount || response.data.info.pageCount || 1;
      bookmarks = response.data.info.Bookmarks || '';
      title = response.data.info.Title || '';
    } else if (response.data.pageCount) {
      pageCount = response.data.pageCount;
    } else if (response.data.PageCount) {
      pageCount = response.data.PageCount;
    }
    
    console.log('Detected page count:', pageCount);
    return { pageCount, bookmarks, title };
  } catch (err: any) {
    console.log('Error getting PDF info:', err.message);
    // If info fails, try to extract text and count pages that way
    return { pageCount: 1 }; // Will be corrected later
  }
};

// Extract ALL text from entire PDF at once (much faster and more reliable)
export var extractAllText = async function(
  pdfUrl: string,
  pageCount: number
): Promise<{ text: string; pages: { pageNum: number; text: string }[] }> {
  console.log('Extracting text from ALL', pageCount, 'pages...');
  
  var pages: { pageNum: number; text: string }[] = [];
  var allText = '';
  
  try {
    // Extract ALL pages at once using range 1-pageCount
    var response = await pdfCoClient.post(Config.PDFCO_TEXT_URL, {
      url: pdfUrl,
      pages: '1-' + pageCount, // ALL pages
      inline: true,
    }, { timeout: Config.EXTRACT_TIMEOUT * 3 }); // Triple timeout for large docs
    
    var fullText = '';
    if (response.data.body) {
      fullText = response.data.body;
    } else if (response.data.url) {
      console.log('Fetching text from URL...');
      var textResp = await axios.get(response.data.url, { timeout: Config.EXTRACT_TIMEOUT });
      fullText = textResp.data;
    }
    
    console.log('Extracted', fullText.length, 'characters total');
    allText = fullText;
    
    // PDF.co often separates pages with form feeds or multiple newlines
    // Split into approximate pages based on content length
    if (fullText && fullText.length > 0) {
      // Try to split by form feed character (common page separator)
      var pageSplit = fullText.split(/\f|\n{4,}/);
      
      if (pageSplit.length >= 2 && pageSplit.length <= pageCount * 2) {
        // Good split - use it
        var pageNum = 1;
        pageSplit.forEach(function(pageText: string) {
          var trimmed = pageText.trim();
          if (trimmed.length > 20) {
            pages.push({
              pageNum: pageNum,
              text: trimmed,
            });
            pageNum++;
          }
        });
      } else {
        // Split by estimated page length if form feed didn't work
        var avgPageLength = Math.ceil(fullText.length / pageCount);
        var chunks = [];
        var pos = 0;
        
        while (pos < fullText.length) {
          // Try to break at paragraph boundaries
          var endPos = Math.min(pos + avgPageLength, fullText.length);
          var breakPos = fullText.lastIndexOf('\n\n', endPos);
          
          if (breakPos > pos + avgPageLength / 2) {
            endPos = breakPos;
          }
          
          chunks.push(fullText.slice(pos, endPos).trim());
          pos = endPos;
        }
        
        chunks.forEach(function(pageText: string, index: number) {
          if (pageText.length > 20) {
            pages.push({
              pageNum: index + 1,
              text: pageText,
            });
          }
        });
      }
    }
    
    console.log('Split into', pages.length, 'content sections');
    
  } catch (err: any) {
    console.log('Error extracting full text:', err.message);
    // If bulk extraction fails, fall back to chunk extraction
    pages = await extractTextInChunks(pdfUrl, pageCount);
    allText = pages.map(p => p.text).join('\n\n');
  }
  
  return { text: allText, pages };
};

// Fallback: Extract text in chunks if bulk fails
var extractTextInChunks = async function(
  pdfUrl: string,
  pageCount: number
): Promise<{ pageNum: number; text: string }[]> {
  console.log('Falling back to chunk extraction...');
  var pages: { pageNum: number; text: string }[] = [];
  var chunkSize = 20; // 20 pages per chunk
  
  for (var start = 1; start <= pageCount; start += chunkSize) {
    var end = Math.min(start + chunkSize - 1, pageCount);
    console.log('Extracting chunk pages', start, '-', end);
    
    try {
      var response = await pdfCoClient.post(Config.PDFCO_TEXT_URL, {
        url: pdfUrl,
        pages: start + '-' + end,
        inline: true,
      }, { timeout: Config.EXTRACT_TIMEOUT });
      
      var chunkText = '';
      if (response.data.body) {
        chunkText = response.data.body;
      } else if (response.data.url) {
        var textResp = await axios.get(response.data.url);
        chunkText = textResp.data;
      }
      
      if (chunkText && chunkText.length > 0) {
        // Assign text to page range
        var pagesInChunk = end - start + 1;
        var avgLen = Math.ceil(chunkText.length / pagesInChunk);
        
        for (var p = start; p <= end; p++) {
          var idx = p - start;
          var pageText = chunkText.slice(idx * avgLen, (idx + 1) * avgLen).trim();
          if (pageText.length > 20) {
            pages.push({ pageNum: p, text: pageText });
          }
        }
      }
    } catch (err) {
      console.log('Error extracting chunk', start, '-', end);
    }
  }
  
  return pages;
};

// Legacy: Extract text from specific pages with page numbers (kept for compatibility)
export var extractTextWithPages = async function(
  pdfUrl: string, 
  startPage: number, 
  endPage: number
): Promise<{ text: string; pages: { pageNum: number; text: string }[] }> {
  // Just delegate to extractAllText
  return await extractAllText(pdfUrl, endPage);
};

// Extract text from page range (bulk - faster but no page numbers)
export var extractTextBulk = async function(pdfUrl: string, startPage: number, endPage: number): Promise<string> {
  var response = await pdfCoClient.post(Config.PDFCO_TEXT_URL, {
    url: pdfUrl,
    pages: startPage + '-' + endPage,
    inline: true,
  }, { timeout: Config.EXTRACT_TIMEOUT });
  
  if (response.data.body) return response.data.body;
  if (response.data.url) {
    var textResp = await axios.get(response.data.url);
    return textResp.data;
  }
  return '';
};

// Convert PDF pages to images (for slides/visual content)
export var extractPageImages = async function(
  pdfUrl: string, 
  startPage: number, 
  endPage: number
): Promise<{ pageNum: number; imageUrl: string }[]> {
  console.log('Converting pages', startPage, '-', endPage, 'to images');
  
  var response = await pdfCoClient.post(Config.PDFCO_IMAGES_URL, {
    url: pdfUrl,
    pages: startPage + '-' + endPage,
  }, { timeout: Config.EXTRACT_TIMEOUT });
  
  if (response.data.error) {
    console.log('Image extraction error:', response.data.message);
    return [];
  }
  
  var images: { pageNum: number; imageUrl: string }[] = [];
  if (response.data.urls && Array.isArray(response.data.urls)) {
    response.data.urls.forEach(function(url: string, index: number) {
      images.push({
        pageNum: startPage + index,
        imageUrl: url,
      });
    });
  }
  
  console.log('Extracted', images.length, 'page images');
  return images;
};

// Full document processing - extracts ALL text from entire PDF
export var processDocument = async function(
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<{
  pdfUrl: string;
  pageCount: number;
  pages: { pageNum: number; text: string; imageUrl?: string }[];
  fullText: string;
}> {
  if (onProgress) onProgress(5, 'Reading document...');
  var base64 = await readFileAsBase64(fileUri);
  var fileSizeKB = base64.length / 1024;
  
  if (onProgress) onProgress(15, 'Uploading to cloud...');
  var pdfUrl = await uploadPdf(base64);
  
  if (onProgress) onProgress(25, 'Analyzing document structure...');
  var info = await getPdfInfo(pdfUrl);
  var pageCount = info.pageCount;
  var bookmarks = info.bookmarks || '';
  var title = info.title || '';
  
  console.log('Bookmarks length:', bookmarks.length);
  console.log('Title:', title);
  
  // If page count is 1 but file is large, PDF.co info might have failed
  // Estimate pages based on file size (roughly 100KB per page average for text-heavy PDFs)
  if (pageCount <= 1 && fileSizeKB > 1000) {
    // Estimate pages - be generous to ensure we don't miss content
    var estimatedPages = Math.max(Math.ceil(fileSizeKB / 100), 50);
    console.log('Page count seems wrong for', fileSizeKB, 'KB file. Estimated pages:', estimatedPages);
    pageCount = estimatedPages;
  }
  
  console.log('Document has approximately', pageCount, 'pages');
  
  if (onProgress) onProgress(35, 'Extracting ALL content...');
  
  // Extract ALL text - use "0" for all pages in PDF.co
  var textResult = await extractAllPagesText(pdfUrl, pageCount);
  
  // If text extraction failed but we have bookmarks (table of contents), use that as fallback
  console.log('Checking bookmarks fallback - text length:', textResult.text.length, ', bookmarks length:', bookmarks.length);
  
  if ((!textResult.text || textResult.text.length < 500) && bookmarks && bookmarks.length > 100) {
    console.log('Text extraction limited, using bookmarks/TOC as content source...');
    // Parse bookmarks into sections - they contain the full document structure
    var tocContent = (title ? '# ' + title + '\n\n' : '') + 
      '## Document Structure and Table of Contents\n\n' + 
      'This document appears to be scanned/image-based. Here is the complete table of contents:\n\n' +
      bookmarks.replace(/\\r\\n/g, '\n').replace(/\r\n/g, '\n');
    
    // Create multiple page entries spread across the actual document
    // This ensures images from different parts of the document are associated
    var bookmarkPages: { pageNum: number; text: string }[] = [];
    var bookmarkLines = tocContent.split('\n').filter(function(l) { return l.trim().length > 10; });
    var linesPerPage = Math.ceil(bookmarkLines.length / Math.min(pageCount, 50));
    
    for (var i = 0; i < Math.min(pageCount, 50); i++) {
      var startIdx = i * linesPerPage;
      var endIdx = Math.min(startIdx + linesPerPage, bookmarkLines.length);
      var pageText = bookmarkLines.slice(startIdx, endIdx).join('\n');
      if (pageText.trim().length > 20) {
        bookmarkPages.push({ pageNum: i + 1, text: pageText });
      }
    }
    
    // If we couldn't split well, create pages with full content but different page numbers
    if (bookmarkPages.length < 3) {
      bookmarkPages = [];
      for (var p = 1; p <= Math.min(pageCount, 30); p++) {
        bookmarkPages.push({ pageNum: p, text: tocContent });
      }
    }
    
    textResult = {
      text: tocContent,
      pages: bookmarkPages
    };
    
    console.log('Created', bookmarkPages.length, 'page entries from bookmarks');
    console.log('Bookmarks content length:', tocContent.length);
    
    if (onProgress) onProgress(50, 'Using document structure (scanned PDF detected)...');
  }
  
  // Update actual page count based on what we extracted
  if (textResult.pages.length > 0) {
    pageCount = Math.max(pageCount, textResult.pages[textResult.pages.length - 1].pageNum);
  }
  
  console.log('Extracted text from', textResult.pages.length, 'sections');
  console.log('Total text length:', textResult.text.length, 'characters');
  
  if (onProgress) onProgress(60, 'Processing visual content...');
  
  // Extract page images from across the entire document (for slides in video)
  // For large documents, extract images from throughout, not just the beginning
  var totalPagesToExtract = Math.min(pageCount, 50); // Limit to 50 images max
  var imagePages: { pageNum: number; imageUrl: string }[] = [];
  
  if (pageCount <= 50) {
    // Small document - extract all pages
    imagePages = await extractPageImages(pdfUrl, 1, pageCount);
  } else {
    // Large document - extract evenly distributed pages
    var step = Math.floor(pageCount / 50);
    var pagesToExtract: number[] = [];
    for (var i = 1; i <= pageCount && pagesToExtract.length < 50; i += step) {
      pagesToExtract.push(i);
    }
    console.log('Extracting images from distributed pages:', pagesToExtract.length, 'pages across', pageCount, 'total');
    
    // Extract in batches
    for (var batch = 0; batch < pagesToExtract.length; batch += 10) {
      var batchPages = pagesToExtract.slice(batch, batch + 10);
      var startPage = batchPages[0];
      var endPage = batchPages[batchPages.length - 1];
      try {
        var batchImages = await extractPageImages(pdfUrl, startPage, endPage);
        imagePages = imagePages.concat(batchImages);
      } catch (err: any) {
        console.log('Error extracting batch', startPage, '-', endPage, ':', err.message);
      }
    }
  }
  
  console.log('Extracted', imagePages.length, 'page images total');
  
  var imageMap: { [key: number]: string } = {};
  imagePages.forEach(function(img) {
    imageMap[img.pageNum] = img.imageUrl;
  });
  
  // Combine text pages with available images
  var pages = textResult.pages.map(function(page) {
    return {
      pageNum: page.pageNum,
      text: page.text,
      imageUrl: imageMap[page.pageNum],
    };
  });
  
  if (onProgress) onProgress(80, 'Extracted ' + pages.length + ' content sections');
  
  return { 
    pdfUrl, 
    pageCount: textResult.pages.length || pageCount, 
    pages, 
    fullText: textResult.text,
  };
};

// Extract ALL pages using "0" parameter (PDF.co means all pages)
async function extractAllPagesText(
  pdfUrl: string,
  estimatedPageCount: number
): Promise<{ text: string; pages: { pageNum: number; text: string }[] }> {
  console.log('Extracting ALL pages from PDF...');
  
  try {
    // First try regular text extraction
    var response = await pdfCoClient.post(Config.PDFCO_TEXT_URL, {
      url: pdfUrl,
      pages: '0', // 0 = ALL pages
      inline: true,
    }, { timeout: Config.EXTRACT_TIMEOUT * 3 }); // Triple timeout for large docs
    
    var fullText = '';
    if (response.data.body) {
      fullText = response.data.body;
    } else if (response.data.url) {
      console.log('Fetching text from URL...');
      var textResp = await axios.get(response.data.url, { timeout: Config.EXTRACT_TIMEOUT });
      fullText = textResp.data;
    }
    
    console.log('Extracted', fullText.length, 'characters total');
    
    // If text extraction got very little content, try OCR mode
    if (!fullText || fullText.length < 500) {
      console.log('Low text content, trying OCR extraction...');
      try {
        var ocrResponse = await pdfCoClient.post(Config.PDFCO_TEXT_URL, {
          url: pdfUrl,
          pages: '0',
          inline: true,
          ocrMode: 'auto', // Enable OCR for scanned PDFs
          ocrLanguages: 'eng',
        }, { timeout: Config.EXTRACT_TIMEOUT * 4 });
        
        if (ocrResponse.data.body && ocrResponse.data.body.length > fullText.length) {
          fullText = ocrResponse.data.body;
          console.log('OCR extracted', fullText.length, 'characters');
        } else if (ocrResponse.data.url) {
          var ocrTextResp = await axios.get(ocrResponse.data.url, { timeout: Config.EXTRACT_TIMEOUT });
          if (ocrTextResp.data && ocrTextResp.data.length > fullText.length) {
            fullText = ocrTextResp.data;
            console.log('OCR extracted', fullText.length, 'characters');
          }
        }
      } catch (ocrErr: any) {
        console.log('OCR extraction failed:', ocrErr.message);
      }
    }
    
    if (!fullText || fullText.length < 100) {
      console.log('Empty result, trying page range...');
      // Try explicit range
      return await extractAllText(pdfUrl, estimatedPageCount);
    }
    
    // Split into pages
    var pages = splitTextIntoPages(fullText, estimatedPageCount);
    
    return { text: fullText, pages };
    
  } catch (err: any) {
    console.log('Error extracting all pages:', err.message);
    // Fall back to range extraction
    return await extractAllText(pdfUrl, estimatedPageCount);
  }
}

// Split extracted text into page sections
function splitTextIntoPages(
  fullText: string,
  estimatedPageCount: number
): { pageNum: number; text: string }[] {
  var pages: { pageNum: number; text: string }[] = [];
  
  // Try form feed split first (most PDFs use this)
  var formFeedSplit = fullText.split(/\f/);
  if (formFeedSplit.length > 1) {
    console.log('Split by form feed into', formFeedSplit.length, 'pages');
    formFeedSplit.forEach(function(pageText, index) {
      var trimmed = pageText.trim();
      if (trimmed.length > 20) {
        pages.push({ pageNum: index + 1, text: trimmed });
      }
    });
    if (pages.length > 0) return pages;
  }
  
  // Try double newline split
  var newlineSplit = fullText.split(/\n{3,}/);
  if (newlineSplit.length > 2 && newlineSplit.length <= estimatedPageCount * 2) {
    console.log('Split by newlines into', newlineSplit.length, 'sections');
    newlineSplit.forEach(function(pageText, index) {
      var trimmed = pageText.trim();
      if (trimmed.length > 50) {
        pages.push({ pageNum: index + 1, text: trimmed });
      }
    });
    if (pages.length > 0) return pages;
  }
  
  // If no good split found, divide by estimated page length
  var avgPageLength = Math.ceil(fullText.length / Math.max(estimatedPageCount, 10));
  var pageNum = 1;
  var pos = 0;
  
  while (pos < fullText.length) {
    var endPos = Math.min(pos + avgPageLength, fullText.length);
    
    // Try to break at paragraph boundary
    var breakPos = fullText.lastIndexOf('\n\n', endPos);
    if (breakPos > pos + avgPageLength / 2) {
      endPos = breakPos + 2;
    }
    
    var pageText = fullText.slice(pos, endPos).trim();
    if (pageText.length > 50) {
      pages.push({ pageNum, text: pageText });
      pageNum++;
    }
    
    pos = endPos;
  }
  
  console.log('Split into', pages.length, 'sections by length');
  return pages;
}

export default {
  readFileAsBase64,
  uploadPdf,
  getPdfInfo,
  extractAllText,
  extractTextWithPages,
  extractTextBulk,
  extractPageImages,
  processDocument,
};
