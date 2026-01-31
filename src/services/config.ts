import Constants from 'expo-constants';

// Centralized Configuration - Update here to reflect everywhere
// Prefer Expo config extras so production builds get the right secrets
// without relying on .env being present on device.
var extra = Constants.expoConfig?.extra || {};

export var Config = {
  // API Endpoints - Supabase (for OpenAI proxy)
  // NOTE: Do NOT commit secrets. Provide these via environment variables
  // or your platform's secret store (e.g. Supabase project secrets).
  OPENAI_PROXY_URL:
    (extra as any).openaiProxyUrl ||
    ((extra as any).supabaseUrl
      ? `${(extra as any).supabaseUrl}/functions/v1/openai-proxy`
      : undefined) ||
    process.env.EXPO_PUBLIC_OPENAI_PROXY_URL ||
    'https://cszorvgzihzamgezlfjj.supabase.co/functions/v1/openai-proxy',
  SUPABASE_ANON_KEY:
    (extra as any).supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  
  // Document Intelligence Service - Production-grade extraction
  // Handles all document types: PDF, PPTX, DOCX up to 500MB
  // Deploy: cd cloud-run/document-intelligence && ./deploy.sh
  DOCUMENT_INTELLIGENCE_URL: 'https://mindsparkle-document-intelligence-900398462112.us-central1.run.app',
  
  // AI Presentation Generator - Multi-AI presentation creation
  // GPT-4o + DALL-E 3 + Mermaid + python-pptx
  // Deploy: cd cloud-run/presentation-ai && ./deploy.sh
  PRESENTATION_AI_URL: 'https://mindsparkle-presentation-ai-900398462112.us-central1.run.app',
  
  // Processing Limits
  // IMPORTANT: Must stay <= supabase/functions/openai-proxy MAX_CONTENT_LENGTH (currently 100,000 chars)
  // Leave headroom for prompt wrappers added on the client.
  MAX_CONTENT_LENGTH: 80000,
  MAX_CHUNK_SIZE: 80000,
  PAGES_PER_CHUNK: 100,
  MAX_IMAGES_PER_PAGE: 5,
  
  // Large file threshold - files > 25MB use cloud processing
  LARGE_FILE_THRESHOLD_MB: 25,
  
  // Timeouts (ms)
  API_TIMEOUT: 300000, // 5 minutes for AI processing
};

export default Config;
