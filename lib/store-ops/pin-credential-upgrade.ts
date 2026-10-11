/**
 * AUTH-HARDEN-001 — atomic login-time PIN credential upgrade to scrypt.
 * Never claims success unless the conditional UPDATE matches the prior stored value.
 */

import "server-only";

import {
  hashPinScrypt,
  needsPinCredentialUpgrade,
  verifyStoredPin,
} from "@/lib/auth-token";
import { createAdminClient } from "@/lib/supabase/admin";

export type PinUpgradeResult =
  | { status: "skipped"; reason: "already_canonical" | "not_needed" }
  | { status: "upgraded" }
  | { status: "conflict"; reason: "credential_changed" }
  | { status: "failed"; reason: string };

/**
 * After a successful verify against `previousStored`, persist a scrypt hash
 * only if pin_code / pin_hash still equal that exact prior material.
 */
export async function persistPinCredentialUpgrade(input: {
  specialistId: string;
  pin: string;
  previousStored: string;
  /** Injected for tests — defaults to service-role admin client. */
  admin?: ReturnType<typeof createAdminClient>;
}): Promise<PinUpgradeResult> {
  const specialistId = String(input.specialistId ?? "").trim();
  const pin = String(input.pin ?? "").trim();
  const previousStored = String(input.previousStored ?? "").trim();
  if (!specialistId || !pin || !previousStored) {
    return { status: "failed", reason: "missing_upgrade_inputs" };
  }

  if (!needsPinCredentialUpgrade(previousStored)) {
    return { status: "skipped", reason: "already_canonical" };
  }

  // Defense: never persist an upgrade if the presented PIN no longer verifies.
  if (!verifyStoredPin(pin, previousStored)) {
    return { status: "failed", reason: "pin_no_longer_verifies" };
  }

  const nextHash = hashPinScrypt(pin);
  const admin = input.admin ?? createAdminClient();
  const nowIso = new Date().toISOString();

  // Prefer pin_code match (login source); also accept pin_hash-only legacy rows.
  const attempt = async (column: "pin_code" | "pin_hash") => {
    const { data, error } = await admin
      .from("store_specialists")
      .update({
        pin_code: nextHash,
        pin_hash: nextHash,
        pin_updated_at: nowIso,
      })
      .eq("id", specialistId)
      .eq(column, previousStored)
      .select("id")
      .maybeSingle();
    return { data, error };
  };

  let { data, error } = await attempt("pin_code");
  if (!error && !data) {
    ({ data, error } = await attempt("pin_hash"));
  }

  if (error) {
    return {
      status: "failed",
      reason: "persist_error",
    };
  }

  if (!data?.id) {
    return { status: "conflict", reason: "credential_changed" };
  }

  return { status: "upgraded" };
}
