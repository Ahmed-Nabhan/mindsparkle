/**
 * Google Docs OCR Service for MindSparkle
 * 
 * Handles OCR for large PDFs by uploading directly to Google Drive
 * and converting to Google Docs (which triggers OCR).
 * 
 * This bypasses the Edge Function memory limits for large files.
 */

import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';

// Service account credentials (loaded from Supabase secrets)
let cachedAccessToken: string | null = null;
let tokenExpiry: number = 0;

interface GoogleCredentials {
  client_email: string;
  private_key: string;
}

/**
 * Get service account credentials from Supabase
 */
async function getCredentials(): Promise<GoogleCredentials | null> {
  try {
    // Call a simple edge function that returns the credentials
    const { data, error } = await supabase.functions.invoke('get-google-credentials');
    if (error || !data?.credentials) {
      console.log('[GoogleDocsOCR] Could not get credentials from server');
      return null;
    }
    return data.credentials;
  } catch (e) {
    console.error('[GoogleDocsOCR] Error getting credentials:', e);
    return null;
  }
}

/**
 * Base64url encode a string
 */
function base64url(str: string): string {
  // For React Native, use a simple implementation
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Get OAuth access token from service account
 * Uses JWT assertion grant type
 */
async function getAccessToken(credentials: GoogleCredentials): Promise<string> {
  // Check if we have a valid cached token
  if (cachedAccessToken && Date.now() < tokenExpiry - 60000) {
    return cachedAccessToken;
  }

  console.log('[GoogleDocsOCR] Getting new access token...');
  
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  // Create JWT header and claim
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const claimB64 = base64url(JSON.stringify(claim));
  const unsignedToken = `${headerB64}.${claimB64}`;

  // For React Native, we need to sign the JWT differently
  // We'll use a server-side endpoint to sign the JWT
  const { data: signData, error: signError } = await supabase.functions.invoke('sign-jwt', {
    body: { unsignedToken, privateKey: credentials.private_key }
  });

  if (signError || !signData?.signature) {
    throw new Error('Failed to sign JWT: ' + (signError?.message || 'Unknown error'));
  }

  const jwt = `${unsignedToken}.${signData.signature}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  if (tokenData.error) {
    throw new Error(`Token error: ${tokenData.error_description || tokenData.error}`);
  }

  cachedAccessToken = tokenData.access_token;
  tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
  
  return cachedAccessToken;
}

/**
 * Upload a file to Google Drive using resumable upload
 */
async function uploadToDrive(
  fileUri: string,
  fileSize: number,
  accessToken: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  console.log(`[GoogleDocsOCR] Starting upload to Google Drive (${(fileSize / 1024 / 1024).toFixed(2)}MB)...`);

  // Initialize resumable upload
  const initResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/pdf',
        'X-Upload-Content-Length': fileSize.toString(),
      },
      body: JSON.stringify({
        name: `ocr_temp_${Date.now()}.pdf`,
        mimeType: 'application/pdf',
      }),
    }
  );

  if (!initResponse.ok) {
    const err = await initResponse.text();
    throw new Error(`Resumable upload init failed: ${initResponse.status} - ${err}`);
  }

  const uploadUrl = initResponse.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('No upload URL returned');
  }

  console.log('[GoogleDocsOCR] Got upload URL, uploading file...');

  // Read and upload in chunks
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
  let uploadedBytes = 0;

  while (uploadedBytes < fileSize) {
    const chunkEnd = Math.min(uploadedBytes + CHUNK_SIZE, fileSize);
    const isLastChunk = chunkEnd >= fileSize;

    // Read chunk from file
    const chunk = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: uploadedBytes,
      length: chunkEnd - uploadedBytes,
    });

    // Convert base64 to binary
    const binaryString = atob(chunk);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload chunk
    const chunkResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': bytes.length.toString(),
        'Content-Range': `bytes ${uploadedBytes}-${uploadedBytes + bytes.length - 1}/${fileSize}`,
        'Content-Type': 'application/pdf',
      },
      body: bytes,
    });

    if (chunkResponse.status !== 308 && chunkResponse.status !== 200 && chunkResponse.status !== 201) {
      const err = await chunkResponse.text();
      throw new Error(`Chunk upload failed: ${chunkResponse.status} - ${err}`);
    }

    uploadedBytes += bytes.length;
    onProgress?.(Math.round((uploadedBytes / fileSize) * 50)); // 0-50% for upload

    if (chunkResponse.status === 200 || chunkResponse.status === 201) {
      const uploadData = await chunkResponse.json();
      console.log(`[GoogleDocsOCR] Upload complete, fileId: ${uploadData.id}`);
      return uploadData.id;
    }
  }

  throw new Error('Upload did not complete properly');
}

/**
 * Convert PDF to Google Docs (triggers OCR) and export as text
 */
async function convertAndExtract(
  fileId: string,
  accessToken: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  console.log('[GoogleDocsOCR] Converting to Google Docs (OCR)...');
  onProgress?.(60);

  // Copy file and convert to Google Docs
  const copyResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `ocr_converted_${Date.now()}`,
        mimeType: 'application/vnd.google-apps.document',
      }),
    }
  );

  const copyData = await copyResponse.json();
  if (copyData.error) {
    // Clean up original file
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    throw new Error(`Conversion error: ${copyData.error.message}`);
  }

  const docId = copyData.id;
  console.log(`[GoogleDocsOCR] Converted to Google Doc, docId: ${docId}`);
  onProgress?.(75);

  // Export as plain text
  console.log('[GoogleDocsOCR] Exporting text...');
  const exportResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!exportResponse.ok) {
    throw new Error(`Export error: ${exportResponse.statusText}`);
  }

  const text = await exportResponse.text();
  console.log(`[GoogleDocsOCR] Extracted ${text.length} characters`);
  onProgress?.(90);

  // Clean up files from Drive
  console.log('[GoogleDocsOCR] Cleaning up temp files...');
  await Promise.all([
    fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }),
    fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }),
  ]);

  onProgress?.(100);
  return text;
}

/**
 * Main function: Process a PDF file with Google Docs OCR
 * 
 * @param fileUri - Local file URI (from document picker)
 * @param fileSize - File size in bytes
 * @param onProgress - Optional progress callback (0-100)
 * @returns Extracted text from the PDF
 */
export async function processWithGoogleDocsOCR(
  fileUri: string,
  fileSize: number,
  onProgress?: (progress: number) => void
): Promise<string> {
  console.log(`[GoogleDocsOCR] Starting OCR for ${(fileSize / 1024 / 1024).toFixed(2)}MB file...`);
  onProgress?.(5);

  // Get credentials
  const credentials = await getCredentials();
  if (!credentials) {
    throw new Error('Google service account not configured');
  }

  // Get access token
  const accessToken = await getAccessToken(credentials);
  onProgress?.(10);

  // Upload to Google Drive
  const fileId = await uploadToDrive(fileUri, fileSize, accessToken, onProgress);

  // Convert and extract text
  const text = await convertAndExtract(fileId, accessToken, onProgress);

  return text;
}

/**
 * Check if Google Docs OCR is available
 */
export async function isGoogleDocsOCRAvailable(): Promise<boolean> {
  try {
    const credentials = await getCredentials();
    return credentials !== null;
  } catch {
    return false;
  }
}
