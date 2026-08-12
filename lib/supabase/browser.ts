/**
 * Browser Supabase Auth helpers.
 * Access tokens must come from the same client that persists phone OTP
 * (`lib/supabase.getSupabase` → localStorage), not a separate cookie jar.
 */

"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export function createSupabaseBrowserClient(): SupabaseClient | null {
  return getSupabase();
}

/** Access token for Authorization: Bearer on Store Ops API calls. */
export async function getSupabaseAccessToken(): Promise<string | null> {
  const client = createSupabaseBrowserClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token?.trim() || null;
}
