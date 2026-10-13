"use client";

/**
 * Browser helper to mint / drop the HTTP-only hub gate cookie.
 * Presentation never reads the cookie; middleware owns enforcement.
 *
 * AUTH-002: bounded fetch; callers must treat false as failure.
 */

import {
  AUTH_REQUEST_TIMEOUT_MS,
  boundedFetch,
} from "@/lib/auth/bounded-fetch";
import { getSupabaseAccessToken } from "@/lib/supabase/client";

export async function syncHubGateCookie(
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const token = await getSupabaseAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await boundedFetch(
      "/api/auth/gate",
      {
        method: "POST",
        credentials: "include",
        headers,
        body: "{}",
        signal,
      },
      AUTH_REQUEST_TIMEOUT_MS
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearHubGateCookie(): Promise<void> {
  try {
    await boundedFetch(
      "/api/auth/gate",
      {
        method: "DELETE",
        credentials: "include",
      },
      AUTH_REQUEST_TIMEOUT_MS
    );
  } catch {
    /* logout still clears local session */
  }
}
