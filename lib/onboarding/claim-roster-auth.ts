/**
 * Auth account claiming — composition owner.
 * Links auth.users.id onto an existing store_specialists row (email, invite
 * token, or specialist id). Never inserts a second roster card.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hashAuthToken } from "@/lib/auth-token";
import { persistSpecialistPatch } from "@/lib/onboarding/token-persist";
import { isMissingColumnError } from "@/lib/store-ops/errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeEmail(raw: unknown): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || !value.includes("@")) return null;
  if (value.endsWith("@deptsync.hub")) return null;
  return value;
}

function claimableStatus(raw: unknown): "active" | "suspended" {
  const status = String(raw ?? "").trim().toLowerCase();
  if (status === "suspended" || status === "inactive") return "suspended";
  return "active";
}

async function selectFirst(
  supabase: SupabaseClient,
  column: string,
  value: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("store_specialists")
    .select("*")
    .eq(column, value)
    .limit(5);
  if (error) {
    if (isMissingColumnError(error, column)) return null;
    return null;
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const invited = rows.find((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    return status === "invited" || status === "pending";
  });
  return invited ?? rows[0];
}

async function findClaimableRosterRow(input: {
  supabase: SupabaseClient;
  authUserId: string;
  email?: string | null;
  inviteToken?: string | null;
  specialistId?: string | null;
  phone?: string | null;
}): Promise<Record<string, unknown> | null> {
  const { supabase } = input;
  const specialistId = String(input.specialistId ?? "").trim();
  if (specialistId) {
    const byId = await selectFirst(supabase, "id", specialistId);
    if (byId) return byId;
  }

  const already = await selectFirst(supabase, "auth_user_id", input.authUserId);
  if (already) return already;

  const token = String(input.inviteToken ?? "").trim();
  if (token) {
    const hashed = hashAuthToken(token);
    const byAuthHash = await selectFirst(supabase, "auth_token_hash", hashed);
    if (byAuthHash) return byAuthHash;
    const byInviteHash = await selectFirst(supabase, "invite_token_hash", hashed);
    if (byInviteHash) return byInviteHash;
    if (UUID_RE.test(token)) {
      const byLegacy = await selectFirst(supabase, "invite_token", token);
      if (byLegacy) return byLegacy;
    }
  }

  const email = normalizeEmail(input.email);
  if (email) {
    const { data, error } = await supabase
      .from("store_specialists")
      .select("*")
      .ilike("email", email)
      .limit(5);
    if (!error) {
      const rows = (data ?? []) as Record<string, unknown>[];
      const unlinked = rows.find((row) => {
        const linked = String(row.auth_user_id ?? "").trim();
        return !linked || linked === input.authUserId;
      });
      if (unlinked) return unlinked;
    } else if (!isMissingColumnError(error, "email")) {
      /* ignore — email column may be absent until migration */
    }
  }

  const phone = String(input.phone ?? "").trim();
  if (phone) {
    const { data, error } = await supabase
      .from("store_specialists")
      .select("*")
      .eq("phone_number", phone)
      .limit(5);
    if (!error) {
      const rows = (data ?? []) as Record<string, unknown>[];
      const unlinked = rows.find((row) => {
        const linked = String(row.auth_user_id ?? "").trim();
        return !linked || linked === input.authUserId;
      });
      if (unlinked) return unlinked;
    }
  }

  return null;
}

/**
 * Stamp auth_user_id on the matching roster row and promote invited/pending → active.
 * Returns the claimed row, or null when nothing matched (caller must not insert).
 */
export async function claimRosterMemberForAuthUser(input: {
  supabase: SupabaseClient;
  authUserId: string;
  email?: string | null;
  inviteToken?: string | null;
  specialistId?: string | null;
  phone?: string | null;
}): Promise<Record<string, unknown> | null> {
  const authUserId = String(input.authUserId ?? "").trim();
  if (!authUserId) return null;

  const row = await findClaimableRosterRow({ ...input, authUserId });
  if (!row?.id) return null;

  const existingAuth = String(
    row.auth_user_id ?? row.user_id ?? row.auth_id ?? ""
  ).trim();
  if (existingAuth && existingAuth !== authUserId) {
    return row;
  }

  const nextStatus = claimableStatus(row.status);
  const email =
    normalizeEmail(input.email) ?? normalizeEmail(row.email) ?? null;

  const patch: Record<string, unknown> = {
    auth_user_id: authUserId,
    user_id: authUserId,
    auth_id: authUserId,
    status: nextStatus,
    is_active: nextStatus !== "suspended",
  };
  if (email) patch.email = email;

  const persisted = await persistSpecialistPatch(input.supabase, "update", patch, {
    id: String(row.id),
  });
  return persisted.data ?? row;
}
