export type Env = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  bucket: string;
  owner: string;
  leaseSeconds: number;
  pollIntervalMs: number;
  batchSize: number;
  ocrServiceUrl?: string;
  signedUrlSeconds: number;
  openAiApiKey?: string;
  documentIntelligenceUrl?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const num = Number(raw);
  return Number.isFinite(num) ? num : defaultValue;
}

export function loadEnv(): Env {
  const owner = process.env.JOB_OWNER || `${process.env.K_SERVICE || "worker"}:${process.pid}`;

  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "documents",
    owner,
    leaseSeconds: optionalInt("LEASE_SECONDS", 60),
    pollIntervalMs: optionalInt("POLL_INTERVAL_MS", 2000),
    batchSize: Math.max(10, Math.min(25, optionalInt("EXTRACT_BATCH_SIZE", 15))),
    ocrServiceUrl: process.env.OCR_SERVICE_URL,
    signedUrlSeconds: optionalInt("SIGNED_URL_SECONDS", 1800),
    openAiApiKey: process.env.OPENAI_API_KEY,
    documentIntelligenceUrl: process.env.DOCUMENT_INTELLIGENCE_URL,
  };
}
