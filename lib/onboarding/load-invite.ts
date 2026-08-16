/**
 * Public one-time token lookup — SHA-256 hash first, legacy invite columns fallback.
 */

import "server-only";

import { NextResponse } from "next/server";
import {
  hashAuthToken,
  isAuthTokenExpired,
  resolvedAuthTokenExpiresAt,
  resolvedAuthTokenHash,
} from "@/lib/auth-token";
import { isMissingColumnError, readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LoadedAuthToken = {
  supabase: SupabaseClient;
  row: Record<string, unknown>;
};

export function authTokenIsConsumed(row: Record<string, unknown>): boolean {
  if (row.invite_consumed_at) return true;
  const hasToken = Boolean(
    resolvedAuthTokenHash(row) || row.invite_token || row.auth_token_hash
  );
  return !hasToken;
}

export function authTokenRowExpired(row: Record<string, unknown>): boolean {
  return isAuthTokenExpired(resolvedAuthTokenExpiresAt(row));
}

async function selectByColumn(
  supabase: SupabaseClient,
  column: "auth_token_hash" | "invite_token_hash" | "invite_token",
  value: string
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  const { data, error } = await supabase
    .from("store_specialists")
    .select("*")
    .eq(column, value)
    .maybeSingle();
  if (error && isMissingColumnError(error, column)) {
    return { data: null, error: null };
  }
  if (error) return { data: null, error };
  return { data: (data as Record<string, unknown> | null) ?? null, error: null };
}

export async function loadAuthTokenBySecret(
  token: string
): Promise<
  | { ok: true; loaded: LoadedAuthToken }
  | { ok: false; response: NextResponse }
> {
  const secret = token.trim();
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing invite token" }, { status: 400 }),
    };
  }

  const { supabase, response } = requireSupabaseAdmin();
  if (!supabase) return { ok: false, response };

  const hashed = hashAuthToken(secret);
  const byAuth = await selectByColumn(supabase, "auth_token_hash", hashed);
  if (byAuth.error) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: readableError(byAuth.error, "Could not load invite") },
        { status: 500 }
      ),
    };
  }

  let row = byAuth.data;
  if (!row) {
    const byInviteHash = await selectByColumn(
      supabase,
      "invite_token_hash",
      hashed
    );
    if (byInviteHash.error) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: readableError(byInviteHash.error, "Could not load invite") },
          { status: 500 }
        ),
      };
    }
    row = byInviteHash.data;
  }

  if (!row && UUID_RE.test(secret)) {
    const byLegacy = await selectByColumn(supabase, "invite_token", secret);
    if (byLegacy.error) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: readableError(byLegacy.error, "Could not load invite") },
          { status: 500 }
        ),
      };
    }
    row = byLegacy.data;
  }

  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invite not found" }, { status: 404 }),
    };
  }

  if (authTokenIsConsumed(row)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This link has already been used." },
        { status: 410 }
      ),
    };
  }

  return { ok: true, loaded: { supabase, row } };
}

/** @deprecated Use loadAuthTokenBySecret */
export const loadInviteBySecret = loadAuthTokenBySecret;
export const inviteIsConsumed = authTokenIsConsumed;
export const inviteRowExpired = authTokenRowExpired;
