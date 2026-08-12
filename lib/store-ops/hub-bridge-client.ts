/**
 * Client Hub PIN → Auth session bridge.
 * After local PIN verify, mint a real Supabase session so Store Ops APIs
 * authorize without phone OTP.
 */

"use client";

import { getStoreNumber } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import type { StoreSpecialist } from "@/lib/types";

export type HubBridgeClientResult =
  | {
      ok: true;
      specialist_id: string;
      role?: string;
      store_number?: string | null;
    }
  | { ok: false; error: string };

export async function establishHubBridgeSession(input: {
  username?: string;
  specialist_id?: string;
  pin: string;
  store_number?: string | null;
}): Promise<HubBridgeClientResult> {
  try {
    const res = await fetch("/api/auth/hub-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: input.username,
        specialist_id: input.specialist_id,
        pin: input.pin,
        store_number:
          String(input.store_number ?? "").trim() || getStoreNumber() || undefined,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      specialist_id?: string;
      role?: string;
      store_number?: string | null;
      session?: {
        access_token: string;
        refresh_token: string;
      };
    };

    if (!res.ok || !body.session?.access_token || !body.session.refresh_token) {
      return {
        ok: false,
        error: body.error || `Hub Auth bridge failed (${res.status})`,
      };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return { ok: false, error: "Supabase client is not configured" };
    }

    const { error } = await supabase.auth.setSession({
      access_token: body.session.access_token,
      refresh_token: body.session.refresh_token,
    });

    if (error) {
      return { ok: false, error: error.message || "Could not persist Auth session" };
    }

    return {
      ok: true,
      specialist_id: String(body.specialist_id ?? input.specialist_id ?? ""),
      role: body.role,
      store_number: body.store_number,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Hub Auth bridge request failed",
    };
  }
}

/** After PIN entry: mint Auth session (blocks Store Ops unlock on failure). */
export async function tryEstablishHubBridgeSession(
  member: StoreSpecialist,
  pin: string
): Promise<string | null> {
  const result = await establishHubBridgeSession({
    username: member.username || member.name || "master_admin",
    specialist_id: member.id,
    pin,
    store_number: member.store_number,
  });
  return result.ok ? null : result.error;
}
