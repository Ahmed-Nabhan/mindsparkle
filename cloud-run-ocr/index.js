const express = require('express');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument } = require('pdf-lib');

const app = express();
app.use(express.json({ limit: '100mb' }));

// Environment variables
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'mindsparkle';
const LOCATION = 'us';
const PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || '1779b9e8fa4f0cd3';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Document AI page limit
const MAX_PAGES_PER_CHUNK = 15;

// Initialize clients
const documentAIClient = new DocumentProcessorServiceClient();

// Create Supabase client
function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase credentials not configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Split PDF into chunks
async function splitPdfIntoChunks(pdfBuffer, chunkSize = MAX_PAGES_PER_CHUNK) {
  console.log('Splitting PDF into chunks...');
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  console.log(`PDF has ${totalPages} pages, splitting into chunks of ${chunkSize} pages`);
  
  const chunks = [];
  for (let i = 0; i < totalPages; i += chunkSize) {
    const endPage = Math.min(i + chunkSize, totalPages);
    const newPdf = await PDFDocument.create();
    const pages = await newPdf.copyPages(pdfDoc, Array.from({ length: endPage - i }, (_, j) => i + j));
    pages.forEach(page => newPdf.addPage(page));
    const chunkBytes = await newPdf.save();
    chunks.push({
      buffer: Buffer.from(chunkBytes),
      startPage: i + 1,
      endPage: endPage,
      pageCount: endPage - i
    });
    console.log(`Created chunk ${chunks.length}: pages ${i + 1}-${endPage}`);
  }
  
  return chunks;
}

// Get OAuth token for Google APIs
async function getGoogleAuthToken() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  const authClient = await auth.getClient();
  const token = await authClient.getAccessToken();
  return token.token;
}

// Process with Google Docs OCR (for scanned PDFs)
async function processWithGoogleDocsOCR(pdfBuffer, fileName) {
  console.log(`Processing ${fileName} with Google Docs OCR...`);
  
  const accessToken = await getGoogleAuthToken();
  const drive = google.drive({ version: 'v3' });
  
  // Upload PDF to Google Drive with conversion
  const uploadResponse = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.document'
    },
    media: {
      mimeType: 'application/pdf',
      body: require('stream').Readable.from(pdfBuffer)
    },
    fields: 'id'
  }, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  const fileId = uploadResponse.data.id;
  console.log(`Uploaded to Google Drive: ${fileId}`);
  
  try {
    // Export as plain text
    const exportResponse = await drive.files.export({
      fileId: fileId,
      mimeType: 'text/plain'
    }, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const extractedText = exportResponse.data;
    console.log(`Extracted ${extractedText.length} characters`);
    
    return extractedText;
  } finally {
    // Clean up - delete the temporary file
    try {
      await drive.files.delete({ fileId }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      console.log(`Deleted temp file ${fileId}`);
    } catch (e) {
      console.warn(`Failed to delete temp file: ${e.message}`);
    }
  }
}

// Process with Document AI (for structured PDFs)
async function processWithDocumentAI(pdfBuffer) {
  console.log('Processing with Document AI...');
  
  const name = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;
  
  const request = {
    name,
    rawDocument: {
      content: pdfBuffer.toString('base64'),
      mimeType: 'application/pdf',
    },
  };
  
  const [result] = await documentAIClient.processDocument(request);
  return result.document?.text || '';
}

// Process large PDF with Document AI in chunks
async function processLargePdfWithDocumentAI(pdfBuffer) {
  // Split PDF into chunks
  const chunks = await splitPdfIntoChunks(pdfBuffer, MAX_PAGES_PER_CHUNK);
  console.log(`Processing ${chunks.length} chunks with Document AI...`);
  
  const allText = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length} (pages ${chunk.startPage}-${chunk.endPage})...`);
    
    try {
      const chunkText = await processWithDocumentAI(chunk.buffer);
      if (chunkText) {
        allText.push(`--- Pages ${chunk.startPage}-${chunk.endPage} ---\n${chunkText}`);
        console.log(`Chunk ${i + 1} extracted ${chunkText.length} chars`);
      }
    } catch (error) {
      console.error(`Chunk ${i + 1} failed: ${error.message}`);
      // Continue with other chunks even if one fails
      allText.push(`--- Pages ${chunk.startPage}-${chunk.endPage} (extraction failed) ---`);
    }
    
    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return allText.join('\n\n');
}

// Update document status in Supabase
async function updateDocumentStatus(tesupabase, documentId, status, metadata = {}) {
  const updateData = {
    status,
    updated_at: new Date().toISOString(),
    ...metadata
  };
  
  const { error } = await supabase
    .from('cloud_documents')
    .update(updateData)
    .eq('id', documentId);
    
  if (error) {
    console.error('Failed to update document status:', error);
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'healthy', service: 'mindsparkle-ocr' });
});

// Main OCR endpoint
app.post('/extract-text', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { cloudDocumentId, storagePath, useDocumentAI = true } = req.body; // Default to Document AI
    
    if (!cloudDocumentId || !storagePath) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: cloudDocumentId and storagePath'
      });
    }
    
    console.log(`Processing document: ${cloudDocumentId}, path: ${storagePath}`);
    
    const supabase = getSupabaseClient();
    
    // Update status to processing
    await updateDocumentStatus(supabase, cloudDocumentId, 'processing');
    
    // Download file from Supabase storage
    console.log('Downloading file from Supabase storage...');
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('documents')
      .download(storagePath);
    
    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message || 'No data'}`);
    }
    
    const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);
    console.log(`Downloaded ${fileSizeMB.toFixed(2)}MB`);
    
    let extractedText = '';
    let ocrMethod = 'document_ai_chunked';
    
    // ENTERPRISE-GRADE: Use Document AI first (scales to millions of users)
    // Document AI: No storage limits, auto-scales, 99.9% SLA, ~$1.50/1000 pages
    try {
      console.log('Using Document AI with chunked processing (enterprise-grade)...');
      extractedText = await processLargePdfWithDocumentAI(pdfBuffer);
      
      if (extractedText && extractedText.trim().length > 100) {
        console.log('Document AI extraction successful');
      } else {
        throw new Error('Insufficient text extracted from Document AI');
      }
    } catch (docAiError) {
      console.log(`Document AI failed: ${docAiError.message}, trying Google Docs OCR as fallback...`);
      ocrMethod = 'google_docs_fallback';
      try {
        const fileName = storagePath.split('/').pop() || 'document.pdf';
        extractedText = await processWithGoogleDocsOCR(pdfBuffer, fileName);
      } catch (docsError) {
        console.error(`Google Docs OCR also failed: ${docsError.message}`);
        throw new Error(`All OCR methods failed. Document AI: ${docAiError.message}. Google Docs: ${docsError.message}`);
      }
    }
    
    if (!extractedText || extractedText.trim().length < 50) {
      throw new Error('Failed to extract meaningful text from document');
    }
    
    // Update document with extracted text
    await updateDocumentStatus(supabase, cloudDocumentId, 'completed', {
      extracted_text: extractedText,
      ocr_method: ocrMethod,
      processing_time_ms: Date.now() - startTime
    });
    
    const processingTime = Date.now() - startTime;
    console.log(`Processing completed in ${processingTime}ms`);
    
    res.json({
      success: true,
      documentId: cloudDocumentId,
      textLength: extractedText.length,
      ocrMethod,
      processingTimeMs: processingTime,
      fileSizeMB: fileSizeMB.toFixed(2)
    });
    
  } catch (error) {
    console.error('OCR processing error:', error);
    
    // Try to update document status to failed
    try {
      const supabase = getSupabaseClient();
      await updateDocumentStatus(supabase, req.body.cloudDocumentId, 'failed', {
        processing_error: error.message
      });
    } catch (e) {
      console.error('Failed to update error status:', e);
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// OCR endpoint using signed URL (called by Edge Function)
// OPTIMIZED FOR MILLIONS OF USERS - Document AI first
app.post('/ocr', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { signedUrl, fileSize, documentId, pageStart, pageEnd } = req.body;
    
    if (!signedUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: signedUrl'
      });
    }
    
    console.log(`Processing via signed URL, documentId: ${documentId}, size: ${fileSize}`);
    
    // Download PDF from signed URL
    console.log('Downloading from signed URL...');
    const pdfResponse = await fetch(signedUrl);
    
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
    }
    
    let pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);
    console.log(`Downloaded ${fileSizeMB.toFixed(2)}MB`);

    // Optional: OCR only a specific page range (1-based, inclusive).
    // This prevents re-OCRing the full document when the caller batches pages.
    const ps = Number(pageStart);
    const pe = Number(pageEnd);
    if (Number.isFinite(ps) && Number.isFinite(pe) && ps >= 1 && pe >= ps) {
      try {
        const full = await PDFDocument.load(pdfBuffer);
        const total = full.getPageCount();
        const start = Math.max(1, Math.min(total, Math.floor(ps)));
        const end = Math.max(start, Math.min(total, Math.floor(pe)));

        if (start !== 1 || end !== total) {
          console.log(`Slicing PDF for OCR: pages ${start}-${end} of ${total}`);
          const sliced = await PDFDocument.create();
          const indices = Array.from({ length: end - start + 1 }, (_, i) => (start - 1) + i);
          const pages = await sliced.copyPages(full, indices);
          pages.forEach((p) => sliced.addPage(p));
          const slicedBytes = await sliced.save();
          pdfBuffer = Buffer.from(slicedBytes);
        }
      } catch (e) {
        console.warn(`Failed to slice PDF for OCR; falling back to full document. Error: ${e.message}`);
      }
    }
    
    let extractedText = '';
    let ocrMethod = 'document_ai_chunked';
    
    // ENTERPRISE-GRADE: Use Document AI first (scales to millions of users)
    // Document AI advantages:
    // - No storage limits (processes in memory)
    // - Auto-scales to handle thousands of concurrent requests
    // - 99.9% SLA - enterprise reliability
    // - ~$1.50 per 1,000 pages - predictable pricing
    // - Handles custom fonts, scanned documents, complex layouts
    try {
      console.log('Using Document AI with chunked processing (enterprise-grade)...');
      extractedText = await processLargePdfWithDocumentAI(pdfBuffer);
      
      if (extractedText && extractedText.trim().length > 100) {
        console.log(`Document AI extracted ${extractedText.length} chars successfully`);
      } else {
        throw new Error('Insufficient text extracted from Document AI');
      }
    } catch (docAiError) {
      console.log(`Document AI failed: ${docAiError.message}, trying Google Docs OCR as fallback...`);
      ocrMethod = 'google_docs_fallback';
      try {
        extractedText = await processWithGoogleDocsOCR(pdfBuffer, `document_${documentId}.pdf`);
      } catch (docsError) {
        console.error(`Google Docs OCR also failed: ${docsError.message}`);
        throw new Error(`All OCR methods failed. Document AI: ${docAiError.message}. Google Docs: ${docsError.message}`);
      }
    }
    
    if (!extractedText || extractedText.trim().length < 50) {
      throw new Error('Failed to extract meaningful text from document');
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`Processing completed in ${processingTime}ms, extracted ${extractedText.length} chars`);
    
    res.json({
      success: true,
      text: extractedText,
      textLength: extractedText.length,
      ocrMethod,
      duration: processingTime,
      fileSizeMB: fileSizeMB.toFixed(2)
    });
    
  } catch (error) {
    console.error('OCR processing error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`OCR service listening on port ${PORT}`);
});
