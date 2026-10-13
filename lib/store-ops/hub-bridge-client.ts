/**
 * Client Hub PIN → Auth session bridge.
 * After local PIN verify, mint a real Supabase session so Store Ops APIs
 * authorize without phone OTP.
 *
 * AUTH-002: bounded fetch, terminal error states, no blind retries.
 */

"use client";

import {
  AUTH_REQUEST_TIMEOUT_MS,
  authNetworkErrorMessage,
  boundedFetch,
  isAuthRequestTimeoutError,
} from "@/lib/auth/bounded-fetch";
import { getStoreNumber } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import type { StoreSpecialist } from "@/lib/types";

export type HubBridgeClientResult =
  | {
      ok: true;
      specialist_id: string;
      role?: string;
      store_number?: string | null;
      specialist?: StoreSpecialist;
      timings?: {
        resolve_user_ms?: number;
        mint_session_ms?: number;
        total_ms?: number;
        client_ms?: number;
      };
    }
  | {
      ok: false;
      error: string;
      code?:
        | "AUTH_REQUEST_TIMEOUT"
        | "NETWORK"
        | "RATE_LIMITED"
        | "AUTH_FAILED"
        | "CONFIG";
      retryable: boolean;
    };

export async function establishHubBridgeSession(input: {
  username?: string;
  specialist_id?: string;
  pin: string;
  store_number?: string | null;
  signal?: AbortSignal;
}): Promise<HubBridgeClientResult> {
  const clientStarted = Date.now();
  try {
    const res = await boundedFetch(
      "/api/auth/hub-bridge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: input.username,
          specialist_id: input.specialist_id,
          pin: input.pin,
          store_number:
            String(input.store_number ?? "").trim() ||
            getStoreNumber() ||
            undefined,
        }),
        signal: input.signal,
      },
      AUTH_REQUEST_TIMEOUT_MS
    );

    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      specialist_id?: string;
      role?: string;
      store_number?: string | null;
      specialist?: StoreSpecialist;
      session?: {
        access_token: string;
        refresh_token: string;
      };
      timings?: {
        resolve_user_ms?: number;
        mint_session_ms?: number;
        total_ms?: number;
      };
    };

    if (res.status === 429 || body.code === "RATE_LIMITED") {
      return {
        ok: false,
        error:
          body.error ||
          "Too many sign-in attempts. Wait a few minutes, then try once.",
        code: "RATE_LIMITED",
        retryable: false,
      };
    }

    if (res.status === 503 || body.code === "AUTH_LIMITER_UNAVAILABLE") {
      return {
        ok: false,
        error:
          body.error ||
          "Sign-in temporarily unavailable. Try again in a moment.",
        code: "CONFIG",
        retryable: true,
      };
    }

    if (!res.ok || !body.session?.access_token || !body.session.refresh_token) {
      const invalid = /invalid username or pin/i.test(String(body.error ?? ""));
      return {
        ok: false,
        error: body.error || `Hub Auth bridge failed (${res.status})`,
        code: "AUTH_FAILED",
        retryable: !invalid,
      };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return {
        ok: false,
        error: "Supabase client is not configured",
        code: "CONFIG",
        retryable: false,
      };
    }

    const { error } = await supabase.auth.setSession({
      access_token: body.session.access_token,
      refresh_token: body.session.refresh_token,
    });

    if (error) {
      return {
        ok: false,
        error: error.message || "Could not persist Auth session",
        code: "AUTH_FAILED",
        retryable: true,
      };
    }

    if (process.env.NODE_ENV !== "production" && body.timings) {
      console.info("[auth-002] hub-bridge timings", {
        ...body.timings,
        client_ms: Date.now() - clientStarted,
      });
    }

    return {
      ok: true,
      specialist_id: String(body.specialist_id ?? input.specialist_id ?? ""),
      role: body.role,
      store_number: body.store_number,
      specialist: body.specialist,
      timings: {
        ...body.timings,
        client_ms: Date.now() - clientStarted,
      },
    };
  } catch (err) {
    if (isAuthRequestTimeoutError(err)) {
      return {
        ok: false,
        error: err.message,
        code: "AUTH_REQUEST_TIMEOUT",
        retryable: true,
      };
    }
    return {
      ok: false,
      error: authNetworkErrorMessage(err),
      code: "NETWORK",
      retryable: true,
    };
  }
}

/** After PIN entry: mint Auth session (blocks Store Ops unlock on failure). */
export async function tryEstablishHubBridgeSession(
  member: StoreSpecialist,
  pin: string,
  signal?: AbortSignal
): Promise<string | null> {
  const result = await establishHubBridgeSession({
    username: member.username || member.name || "master_admin",
    specialist_id: member.id,
    pin,
    store_number: member.store_number,
    signal,
  });
  return result.ok ? null : result.error;
}
