/**
 * Server-only Supabase admin client (service role).
 * Bypasses RLS for Store Operations / push APIs. Never import into client components.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  supabaseAdminMissingMessage,
} from "@/lib/supabase/env";

let admin: SupabaseClient | null = null;
let adminFingerprint: string | null = null;

/**
 * Create a service-role Supabase client.
 * Requires real NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (no anon fallback).
 */
export function createAdminClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();

  if (!url || !key) {
    throw new Error(supabaseAdminMissingMessage());
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "X-Client-Info": "deptsync-admin",
      },
    },
  });
}

/**
 * Lazy singleton for route handlers. Rebuilds if env fingerprint changes
 * (e.g. after restart with new keys).
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    admin = null;
    adminFingerprint = null;
    return null;
  }

  const fingerprint = `${url}::${key.slice(0, 8)}::${key.length}`;
  if (!admin || adminFingerprint !== fingerprint) {
    admin = createAdminClient();
    adminFingerprint = fingerprint;
  }
  return admin;
}

export function isStoreOpsDbConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseServiceRoleKey());
}

export function getSupabaseAdminOrThrow(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new Error(supabaseAdminMissingMessage());
  }
  return client;
}
