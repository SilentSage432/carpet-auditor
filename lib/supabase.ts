import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

let client: SupabaseClient | null = null;
let clientFingerprint: string | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    client = null;
    clientFingerprint = null;
    return null;
  }

  const fingerprint = `${url}::${key.slice(0, 8)}::${key.length}`;
  if (!client || clientFingerprint !== fingerprint) {
    client = createClient(url, key, {
      auth: {
        // Persist Supabase Auth (phone OTP) session in localStorage alongside DeptSync roster session.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
      },
    });
    clientFingerprint = fingerprint;
  }

  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}
