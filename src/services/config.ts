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
  
  // PDF Extraction is now 100% FREE (local only)
  // No paid API keys needed!
  
  // Processing Limits - MAXIMUM SPEED (aggressive parallelism)
  MAX_CONTENT_LENGTH: 200000, // ~50k tokens - larger single request = instant for most docs
  MAX_CHUNK_SIZE: 120000, // Larger chunks = fewer API calls = FASTER for huge docs
  PAGES_PER_CHUNK: 50,
  MAX_IMAGES_PER_PAGE: 3,
  
  // Timeouts (ms)
  API_TIMEOUT: 300000, // 5 minutes for AI processing
};

export default Config;
