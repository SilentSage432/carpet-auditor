/**
 * Token redemption — consume one-time hash on entry, then PIN setup via cookie.
 * Issues a Hub-bridge Auth session so Store Ops RLS continues to work.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AuthTokenPurpose,
  hashPin,
  isValidPermanentPin,
  mintAuthVerifyCookie,
} from "@/lib/auth-token";
import { deriveOnboardingStatus } from "@/lib/invite";
import { persistSpecialistPatch } from "@/lib/onboarding/token-persist";
import { mintHubBridgeSession } from "@/lib/store-ops/hub-bridge";
import { mapRow } from "@/lib/specialists";
import { readableError } from "@/lib/store-ops/errors";
import { departmentMeta, type DepartmentScope } from "@/lib/types";

export type AuthVerifyPreview = {
  specialist_id: string;
  name: string;
  username: string | null;
  store_number: string;
  department: string;
  department_label: string;
  purpose: AuthTokenPurpose;
};

export function publicVerifyPreview(
  row: Record<string, unknown>
): AuthVerifyPreview {
  const dept = (row.assigned_department as DepartmentScope) || "flooring";
  const status = deriveOnboardingStatus(row);
  return {
    specialist_id: String(row.id),
    name: String(row.name ?? ""),
    username: row.username ? String(row.username) : null,
    store_number: String(row.store_number ?? ""),
    department: dept,
    department_label: departmentMeta(dept).label,
    purpose: status === "invited" ? "invite" : "reset",
  };
}

export async function consumeAuthToken(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<{ preview: AuthVerifyPreview; cookie: string }> {
  const purpose: AuthTokenPurpose =
    deriveOnboardingStatus(row) === "invited" ? "invite" : "reset";
  const now = new Date().toISOString();
  const persisted = await persistSpecialistPatch(
    supabase,
    "update",
    {
      auth_token_hash: null,
      auth_token_expires_at: null,
      invite_token: null,
      invite_token_hash: null,
      invite_token_expires_at: null,
      invite_consumed_at: now,
    },
    { id: String(row.id) }
  );
  if (persisted.error) {
    throw new Error(readableError(persisted.error, "Could not consume invite"));
  }

  const cookie = mintAuthVerifyCookie(String(row.id), purpose);
  if (!cookie) {
    throw new Error("Could not start PIN setup session");
  }
  return { preview: publicVerifyPreview(row), cookie };
}

export async function completePinFromVerifySession(input: {
  supabase: SupabaseClient;
  specialistId: string;
  pin: string;
}): Promise<{
  specialist: ReturnType<typeof mapRow>;
  session: Awaited<ReturnType<typeof mintHubBridgeSession>>["session"];
}> {
  if (!isValidPermanentPin(input.pin)) {
    throw new Error("PIN must be 4–6 digits");
  }

  const { data: row, error: loadErr } = await input.supabase
    .from("store_specialists")
    .select("*")
    .eq("id", input.specialistId)
    .maybeSingle();
  if (loadErr || !row) {
    throw new Error("Setup session expired. Request a new invite or reset link.");
  }

  const record = row as Record<string, unknown>;
  if (record.is_active === false || String(record.status ?? "") === "suspended") {
    throw new Error("This profile is suspended");
  }

  const pinHash = hashPin(input.pin);
  const now = new Date().toISOString();
  const persisted = await persistSpecialistPatch(
    input.supabase,
    "update",
    {
      pin_hash: pinHash,
      pin_code: pinHash,
      pin_updated_at: now,
      status: "active",
      is_active: true,
      must_change_pin: false,
      must_change_credentials: false,
      temp_pin_hash: null,
      auth_token_hash: null,
      auth_token_expires_at: null,
      invite_token: null,
      invite_token_hash: null,
      invite_token_expires_at: null,
    },
    { id: input.specialistId }
  );

  if (persisted.error || !persisted.data) {
    throw new Error(readableError(persisted.error, "Could not save PIN"));
  }

  const specialist = mapRow(persisted.data);
  const bridged = await mintHubBridgeSession({
    specialist_id: specialist.id,
    pin: input.pin,
    store_number: specialist.store_number,
  });

  return {
    specialist: {
      ...bridged.specialist,
      pin_code: null,
      must_change_credentials: false,
      must_change_pin: false,
      status: "active",
      is_active: true,
    },
    session: bridged.session,
  };
}
