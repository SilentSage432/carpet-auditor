/**
 * Optional-column specialist patch persist — used by invite, PIN reset, and redeem.
 * Does not own token crypto or SMS.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/store-ops/errors";

export const OPTIONAL_SPECIALIST_COLUMNS = [
  "accessible_departments",
  "status",
  "auth_token_hash",
  "auth_token_expires_at",
  "pin_hash",
  "pin_updated_at",
  "invite_token_hash",
  "invite_consumed_at",
  "must_change_pin",
  "temp_pin_hash",
  "phone_number",
] as const;

export async function persistSpecialistPatch(
  supabase: SupabaseClient,
  mode: "insert" | "update",
  patch: Record<string, unknown>,
  filter?: { id: string; storeNumber?: string }
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  let next: Record<string, unknown> = { ...patch };
  for (let attempt = 0; attempt < OPTIONAL_SPECIALIST_COLUMNS.length + 1; attempt += 1) {
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
            .maybeSingle();
    const { data, error } = result;
    if (!error) {
      return { data: (data as Record<string, unknown> | null) ?? null, error: null };
    }
    const missing = OPTIONAL_SPECIALIST_COLUMNS.find(
      (col) =>
        isMissingColumnError(error, col) &&
        Object.prototype.hasOwnProperty.call(next, col)
    );
    if (!missing) {
      return { data: null, error };
    }
    const { [missing]: _dropped, ...rest } = next;
    next = rest;
  }
  return { data: null, error: new Error("Could not persist specialist patch") };
}
