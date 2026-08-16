/**
 * Optional-column specialist patch persist — used by invite, PIN reset, redeem, and roster create.
 * Does not own token crypto or SMS. Auth identity columns are omitted when empty so
 * roster-only inserts do not require an existing auth.users row.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, isNotNullViolationError } from "@/lib/store-ops/errors";

/** Columns that may be absent on older live schemas — dropped and retried. */
export const OPTIONAL_SPECIALIST_COLUMNS = [
  "accessible_departments",
  "status",
  "auth_token_hash",
  "auth_token_expires_at",
  "pin_hash",
  "pin_updated_at",
  "invite_token",
  "invite_token_hash",
  "invite_token_expires_at",
  "invite_consumed_at",
  "must_change_pin",
  "must_change_credentials",
  "temp_pin_hash",
  "phone_number",
  "email",
  "home_department",
  "store_id",
  "auth_user_id",
  "user_id",
  "auth_id",
] as const;

const AUTH_IDENTITY_COLUMNS = ["auth_user_id", "user_id", "auth_id"] as const;

function stripEmptyAuthIdentity(
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...patch };
  for (const col of AUTH_IDENTITY_COLUMNS) {
    const value = next[col];
    if (value == null || String(value).trim() === "") {
      delete next[col];
    }
  }
  return next;
}

function insertLogPayload(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    store_id: patch.store_id ?? null,
    store_number: patch.store_number ?? null,
    name: patch.name ?? null,
    role: patch.role ?? null,
    home_department: patch.home_department ?? patch.assigned_department ?? null,
    assigned_department: patch.assigned_department ?? null,
    auth_user_id: patch.auth_user_id ?? null,
  };
}

function persistErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    return [record.message, record.details, record.hint, record.code]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join(" — ");
  }
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

export async function persistSpecialistPatch(
  supabase: SupabaseClient,
  mode: "insert" | "update",
  patch: Record<string, unknown>,
  filter?: { id: string; storeNumber?: string }
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  let next: Record<string, unknown> = stripEmptyAuthIdentity(patch);
  const maxAttempts = OPTIONAL_SPECIALIST_COLUMNS.length + AUTH_IDENTITY_COLUMNS.length + 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (mode === "insert") {
      console.info("[roster insert] payload", insertLogPayload(next));
    }
    const result =
      mode === "update" && filter
        ? await (filter.storeNumber
            ? supabase
                .from("store_specialists")
                .update(next)
                .eq("id", filter.id)
                .eq("store_number", filter.storeNumber)
                .select("*")
                .maybeSingle()
            : supabase
                .from("store_specialists")
                .update(next)
                .eq("id", filter.id)
                .select("*")
                .maybeSingle())
        : await supabase
            .from("store_specialists")
            .insert(next)
            .select("*")
            .single();
    const { data, error } = result;
    if (!error && data && String((data as { id?: unknown }).id ?? "").trim()) {
      return { data: data as Record<string, unknown>, error: null };
    }
    if (mode === "insert" && (error || !data)) {
      console.error("Roster Insert Failed:", error ?? {
        reason: "empty_data",
        rows: 0,
        payload: insertLogPayload(next),
      });
    }
    if (!error && mode === "update") {
      return { data: (data as Record<string, unknown> | null) ?? null, error: null };
    }
    if (!error && mode === "insert") {
      return {
        data: null,
        error: new Error("Roster Insert Failed: 0 rows were inserted"),
      };
    }
    const missing = OPTIONAL_SPECIALIST_COLUMNS.find(
      (col) =>
        isMissingColumnError(error, col) &&
        Object.prototype.hasOwnProperty.call(next, col)
    );
    if (missing) {
      const { [missing]: _dropped, ...rest } = next;
      next = rest;
      continue;
    }
    const authCol = AUTH_IDENTITY_COLUMNS.find(
      (col) =>
        isNotNullViolationError(error, col) &&
        Object.prototype.hasOwnProperty.call(next, col)
    );
    if (authCol) {
      const { [authCol]: _dropped, ...rest } = next;
      next = rest;
      continue;
    }
    if (AUTH_IDENTITY_COLUMNS.some((col) => isNotNullViolationError(error, col))) {
      return {
        data: null,
        error: new Error(
          "Schema missing or out of date: apply supabase/migrations/20260815_roster_auth_link.sql so roster members can be saved without an Auth account."
        ),
      };
    }
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    if (code === "PGRST116" || persistErrorMessage(error).toLowerCase().includes("0 rows")) {
      return {
        data: null,
        error: new Error(
          "Roster Insert Failed: 0 rows returned (RLS may be hiding the row). Apply supabase/migrations/20260815_roster_insert_rls.sql."
        ),
      };
    }
    return { data: null, error };
  }
  return { data: null, error: new Error("Could not persist specialist patch") };
}
