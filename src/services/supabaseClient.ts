import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "../config/supabase";

let client: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  const { enabled, url, publishableKey } = supabaseConfig;
  return Boolean(enabled && url && publishableKey && !publishableKey.startsWith("REPLACE_WITH"));
}

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!isSupabaseConfigured()) {
    client = null;
    return client;
  }

  client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
