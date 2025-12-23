// Centralized Configuration - Update here to reflect everywhere
export var Config = {
  // API Endpoints
  SUPABASE_URL: 'https://cszorvgzihzamgezlfjj.supabase.co/functions/v1/openai-proxy',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzem9ydmd6aWh6YW1nZXpsZmpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNDAzNDYsImV4cCI6MjA4MTYxNjM0Nn0.FWuTPGrWNGLC1TATYYxUiC48QS8GSP5jytkR-Dwq2qM',
  PDFCO_API_KEY: 'ahmedadel737374@icloud.com_mtAS3HAWdp3sUN3kBTMuPkdKkEGHmQUeZMHlPSr3NYABQHEYHs2VJyTlZZmAasQL',
  
  // PDF.co Endpoints
  PDFCO_UPLOAD_URL: 'https://api.pdf.co/v1/file/upload/base64',
  PDFCO_PRESIGNED_URL: 'https://api.pdf.co/v1/file/upload/get-presigned-url',
  PDFCO_INFO_URL: 'https://api.pdf.co/v1/pdf/info',
  PDFCO_TEXT_URL: 'https://api.pdf.co/v1/pdf/convert/to/text',
  PDFCO_IMAGES_URL: 'https://api.pdf.co/v1/pdf/convert/to/png',
  
  // Processing Limits - GPT-4o can handle ~128k tokens, so we can send more
  MAX_CONTENT_LENGTH: 120000, // ~30k tokens worth of text
  MAX_CHUNK_SIZE: 50000, // Size per chunk if chunking needed
  PAGES_PER_CHUNK: 30,
  MAX_IMAGES_PER_PAGE: 3,
  LARGE_FILE_THRESHOLD: 10000000, // 10MB - use presigned upload for larger files
  
  // Timeouts (ms)
  UPLOAD_TIMEOUT: 600000, // 10 minutes for large file uploads
  EXTRACT_TIMEOUT: 300000, // 5 minutes for extraction
  API_TIMEOUT: 300000, // 5 minutes for AI processing (large documents need more time)
};

export default Config;
