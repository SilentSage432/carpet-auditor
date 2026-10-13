/**
 * AUTH-002 — resolve a live Supabase Auth session for resume paths.
 * Wall session (localStorage) is never sufficient for Store Ops alone.
 */

"use client";

import { getSupabase } from "@/lib/supabase";

export type LiveSessionProbe = {
  hasAccessToken: boolean;
  refreshed: boolean;
};

/**
 * Prefer an existing access token; otherwise attempt one refreshSession().
 * Never invents credentials. Returns false when no refreshable session exists.
 */
export async function resolveLiveSupabaseSession(): Promise<LiveSessionProbe> {
  const supabase = getSupabase();
  if (!supabase) {
    return { hasAccessToken: false, refreshed: false };
  }

  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      return { hasAccessToken: true, refreshed: false };
    }
  } catch {
    /* try refresh below */
  }

  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.access_token) {
      return { hasAccessToken: true, refreshed: true };
    }
  } catch {
    /* no refreshable session */
  }

  return { hasAccessToken: false, refreshed: false };
}

/** True when localStorage may hold a refreshable Supabase Auth session. */
export function hasStoredSupabaseAuthHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      // Supabase JS persists under sb-<ref>-auth-token (and legacy variants).
      if (
        key.includes("-auth-token") ||
        (key.startsWith("sb-") && key.includes("auth"))
      ) {
        const raw = window.localStorage.getItem(key);
        if (raw && raw.includes("refresh_token")) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
