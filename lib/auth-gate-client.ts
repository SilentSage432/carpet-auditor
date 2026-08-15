"use client";

/**
 * Browser helper to mint / drop the HTTP-only hub gate cookie.
 * Presentation never reads the cookie; middleware owns enforcement.
 */

import { getSupabaseAccessToken } from "@/lib/supabase/client";

export async function syncHubGateCookie(): Promise<boolean> {
  try {
    const token = await getSupabaseAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch("/api/auth/gate", {
      method: "POST",
      credentials: "include",
      headers,
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearHubGateCookie(): Promise<void> {
  try {
    await fetch("/api/auth/gate", {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    /* logout still clears local session */
  }
}
