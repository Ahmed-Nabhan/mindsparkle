import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createServiceClient(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
}): SupabaseClient {
  return createClient(params.supabaseUrl, params.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
