/**
 * Emergency admin bypass — temporary master unlock code ownership.
 * AuthWall grants an immediate local Master Admin session; the API only
 * updates an existing store_specialists row (never inserts).
 */

import type { StoreSpecialist } from "./types";

/** Temporary emergency master PIN — grants Master Admin until rotated off. */
export const EMERGENCY_MASTER_CODE = "MASTER-2026-TEMP";

export const EMERGENCY_ADMIN_USERNAME = "master_admin";
export const EMERGENCY_ADMIN_NAME = "Master Admin";

export function isEmergencyMasterCode(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim() === EMERGENCY_MASTER_CODE;
}

/**
 * Local Master Admin profile used when the master code is entered.
 * Bypasses PIN checks and does not depend on a successful DB insert.
 */
export function buildEmergencyAdminSpecialist(
  storeNumber = ""
): StoreSpecialist {
  return {
    id: "emergency-master-admin",
    store_number: String(storeNumber ?? "").trim(),
    name: EMERGENCY_ADMIN_NAME,
    role: "MasterAdmin",
    pin_code: EMERGENCY_MASTER_CODE,
    username: EMERGENCY_ADMIN_USERNAME,
    assigned_department: "all",
    must_change_credentials: false,
    must_change_pin: false,
    is_active: true,
    created_at: new Date().toISOString(),
  };
}

export type EmergencyUnlockResult = {
  ok: true;
  specialist: StoreSpecialist;
  /** True when Supabase row was updated; false when local-only fallback. */
  synced: boolean;
};

export type EmergencyUnlockError = {
  ok: false;
  error: string;
};

/**
 * Best-effort unlock: prefers the API update of an existing roster row.
 * On any API failure, still returns a local Master Admin specialist so login
 * never blocks on unique-constraint / insert errors.
 */
export async function requestEmergencyAdminUnlock(input: {
  code: string;
  storeNumber?: string;
}): Promise<EmergencyUnlockResult | EmergencyUnlockError> {
  if (!isEmergencyMasterCode(input.code)) {
    return { ok: false, error: "Invalid emergency unlock code" };
  }

  const local = buildEmergencyAdminSpecialist(input.storeNumber ?? "");

  try {
    const res = await fetch("/api/auth/emergency-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: input.code.trim(),
        store_number: input.storeNumber ?? "",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      specialist?: StoreSpecialist;
      synced?: boolean;
    };

    if (res.ok && json.specialist) {
      return {
        ok: true,
        specialist: {
          ...json.specialist,
          role: "MasterAdmin",
          is_active: true,
          must_change_credentials: false,
          must_change_pin: false,
          assigned_department: "all",
        },
        synced: json.synced !== false,
      };
    }

    // Unique constraint / missing row / network — still unlock locally.
    return { ok: true, specialist: local, synced: false };
  } catch {
    return { ok: true, specialist: local, synced: false };
  }
}
