/**
 * MindSparkle OCR Service - Cloud Run
 * 
 * Processes large PDFs using Google Docs OCR
 * Memory: 1GB-8GB (configurable)
 * Timeout: Up to 60 minutes
 * 
 * Endpoints:
 * - POST /ocr - Extract text from PDF via signed URL
 * - GET /health - Health check
 */

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const PORT = process.env.PORT || 8080;

// Service account credentials from environment
const getCredentials = () => {
  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credsJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable not set');
  }
  return JSON.parse(credsJson);
};

// Create authenticated Google Drive client
const getDriveClient = async () => {
  const credentials = getCredentials();
  
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  
  return google.drive({ version: 'v3', auth });
};

/**
 * Upload PDF to Google Drive
 */
async function uploadPdfToDrive(drive, pdfBuffer, fileName) {
  console.log(`[OCR] Uploading ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB to Google Drive...`);
  
  const { Readable } = require('stream');
  const stream = Readable.from(pdfBuffer);
  
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/pdf',
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id',
  });
  
  console.log(`[OCR] Uploaded PDF, fileId: ${response.data.id}`);
  return response.data.id;
}

/**
 * Convert PDF to Google Docs (triggers OCR)
 */
async function convertToGoogleDocs(drive, pdfFileId) {
  console.log(`[OCR] Converting to Google Docs (OCR)...`);
  
  const response = await drive.files.copy({
    fileId: pdfFileId,
    requestBody: {
      name: `ocr_converted_${Date.now()}`,
      mimeType: 'application/vnd.google-apps.document',
    },
  });
  
  console.log(`[OCR] Converted to Google Doc, docId: ${response.data.id}`);
  return response.data.id;
}

/**
 * Export Google Doc as plain text
 */
async function exportAsText(drive, docId) {
  console.log(`[OCR] Exporting Google Doc as text...`);
  
  const response = await drive.files.export({
    fileId: docId,
    mimeType: 'text/plain',
  });
  
  const text = response.data;
  console.log(`[OCR] Extracted ${text.length} characters`);
  return text;
}

/**
 * Delete files from Google Drive
 */
async function cleanupFiles(drive, fileIds) {
  console.log(`[OCR] Cleaning up ${fileIds.length} temp files...`);
  
  await Promise.all(
    fileIds.map(id => 
      drive.files.delete({ fileId: id }).catch(err => 
        console.warn(`[OCR] Failed to delete file ${id}:`, err.message)
      )
    )
  );
}

/**
 * Main OCR processing function
 */
async function processOCR(signedUrl, fileSize) {
  const startTime = Date.now();
  const drive = await getDriveClient();
  const filesToClean = [];
  
  try {
    // Step 1: Download PDF from signed URL
    console.log(`[OCR] Downloading PDF from signed URL (${(fileSize / 1024 / 1024).toFixed(2)}MB)...`);
    const pdfResponse = await fetch(signedUrl);
    
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
    }
    
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    console.log(`[OCR] Downloaded ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    
    // Step 2: Upload to Google Drive
    const pdfFileId = await uploadPdfToDrive(drive, pdfBuffer, `ocr_temp_${Date.now()}.pdf`);
    filesToClean.push(pdfFileId);
    
    // Step 3: Convert to Google Docs (triggers OCR)
    const docId = await convertToGoogleDocs(drive, pdfFileId);
    filesToClean.push(docId);
    
    // Step 4: Export as text
    const extractedText = await exportAsText(drive, docId);
    
    // Step 5: Cleanup
    await cleanupFiles(drive, filesToClean);
    
    const duration = Date.now() - startTime;
    console.log(`[OCR] Complete in ${duration}ms`);
    
    return {
      success: true,
      text: extractedText,
      textLength: extractedText.length,
      duration,
      method: 'google-docs-ocr',
    };
    
  } catch (error) {
    // Cleanup on error
    if (filesToClean.length > 0) {
      await cleanupFiles(drive, filesToClean);
    }
    throw error;
  }
}

// ============================================
// ENDPOINTS
// ============================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mindsparkle-ocr', timestamp: new Date().toISOString() });
});

/**
 * OCR endpoint
 * 
 * Request body:
 * {
 *   signedUrl: string,  // Supabase signed URL for the PDF
 *   fileSize: number,   // File size in bytes
 *   documentId?: string // Optional document ID for logging
 * }
 */
app.post('/ocr', async (req, res) => {
  const { signedUrl, fileSize, documentId } = req.body;
  
  console.log(`[OCR] === START === Document: ${documentId || 'unknown'}, Size: ${fileSize ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : 'unknown'}`);
  
  // Validate request
  if (!signedUrl) {
    return res.status(400).json({ success: false, error: 'Missing signedUrl' });
  }
  
  if (!fileSize || fileSize <= 0) {
    return res.status(400).json({ success: false, error: 'Missing or invalid fileSize' });
  }
  
  // Check file size limit (500MB max)
  const MAX_SIZE_MB = 500;
  if (fileSize > MAX_SIZE_MB * 1024 * 1024) {
    return res.status(413).json({ 
      success: false, 
      error: `File too large: ${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_SIZE_MB}MB limit` 
    });
  }
  
  try {
    const result = await processOCR(signedUrl, fileSize);
    console.log(`[OCR] === SUCCESS === Extracted ${result.textLength} chars in ${result.duration}ms`);
    res.json(result);
    
  } catch (error) {
    console.error(`[OCR] === ERROR ===`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'OCR processing failed',
    });
  }
});

/**
 * Alternative: Direct PDF upload endpoint (for smaller files)
 */
app.post('/ocr/upload', express.raw({ type: 'application/pdf', limit: '100mb' }), async (req, res) => {
  const pdfBuffer = req.body;
  
  if (!pdfBuffer || pdfBuffer.length === 0) {
    return res.status(400).json({ success: false, error: 'No PDF data received' });
  }
  
  console.log(`[OCR] === UPLOAD === Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`);
  
  try {
    const startTime = Date.now();
    const drive = await getDriveClient();
    const filesToClean = [];
    
    // Upload to Google Drive
    const pdfFileId = await uploadPdfToDrive(drive, pdfBuffer, `ocr_upload_${Date.now()}.pdf`);
    filesToClean.push(pdfFileId);
    
    // Convert to Google Docs
    const docId = await convertToGoogleDocs(drive, pdfFileId);
    filesToClean.push(docId);
    
    // Export as text
    const extractedText = await exportAsText(drive, docId);
    
    // Cleanup
    await cleanupFiles(drive, filesToClean);
    
    const duration = Date.now() - startTime;
    console.log(`[OCR] === SUCCESS === Extracted ${extractedText.length} chars in ${duration}ms`);
    
    res.json({
      success: true,
      text: extractedText,
      textLength: extractedText.length,
      duration,
      method: 'google-docs-ocr-upload',
    });
    
  } catch (error) {
    console.error(`[OCR] === ERROR ===`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'OCR processing failed',
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[OCR] MindSparkle OCR Service running on port ${PORT}`);
  console.log(`[OCR] Memory limit: ${process.env.MEMORY_LIMIT || 'default'}`);
});
