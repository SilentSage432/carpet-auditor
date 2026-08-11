/**
 * Emergency admin bypass — temporary master unlock code ownership.
 * AuthWall presents UI; /api/auth/emergency-unlock applies Supabase profile unlock.
 */

/** Temporary emergency master PIN — grants Master Admin until rotated off. */
export const EMERGENCY_MASTER_CODE = "MASTER-2026-TEMP";

export function isEmergencyMasterCode(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim() === EMERGENCY_MASTER_CODE;
}

export type EmergencyUnlockResult = {
  ok: true;
  specialist: import("./types").StoreSpecialist;
};

export type EmergencyUnlockError = {
  ok: false;
  error: string;
};

/**
 * Client: call emergency unlock API with the temp master code.
 * Server validates code, promotes/creates Master Admin row, clears lock flags.
 */
export async function requestEmergencyAdminUnlock(input: {
  code: string;
  storeNumber?: string;
}): Promise<EmergencyUnlockResult | EmergencyUnlockError> {
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
      specialist?: import("./types").StoreSpecialist;
    };
    if (!res.ok || !json.specialist) {
      return {
        ok: false,
        error: json.error || `Emergency unlock failed (${res.status})`,
      };
    }
    return { ok: true, specialist: json.specialist };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Emergency unlock failed",
    };
  }
}
