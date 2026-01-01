// Centralized Configuration - Update here to reflect everywhere
export var Config = {
  // API Endpoints - Supabase (for OpenAI proxy)
  // NOTE: Do NOT commit secrets. Provide these via environment variables
  // or your platform's secret store (e.g. Supabase project secrets).
  OPENAI_PROXY_URL: process.env.EXPO_PUBLIC_OPENAI_PROXY_URL || 'https://cszorvgzihzamgezlfjj.supabase.co/functions/v1/openai-proxy',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  
  // PDF Extraction is now 100% FREE (local only)
  // No paid API keys needed!
  
  // Processing Limits
  MAX_CONTENT_LENGTH: 120000, // ~30k tokens worth of text
  MAX_CHUNK_SIZE: 50000, // Size per chunk if chunking needed
  PAGES_PER_CHUNK: 30,
  MAX_IMAGES_PER_PAGE: 3,
  
  // Timeouts (ms)
  API_TIMEOUT: 300000, // 5 minutes for AI processing
};

export default Config;
