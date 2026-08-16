/**
 * Hub PIN reset / upsert (service role).
 * Writes pin_code to store_specialists (login source of truth) and upserts
 * store_profiles when present so Master Admin Change PIN never fails on a
 * missing profile row.
 */

import "server-only";

import { DEFAULT_SUPERVISOR_PIN, mapRow } from "@/lib/specialists";
import { hashPin, verifyStoredPin } from "@/lib/invite";
import { normalizeStoreNumber } from "@/lib/store";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StoreSpecialist } from "@/lib/types";

const MASTER_NAMES = new Set(["master admin", "master_admin", "super admin"]);

function isMasterRole(raw: unknown): boolean {
  const value = String(raw ?? "")
    .toLowerCase()
    .trim();
  return (
    value === "masteradmin" ||
    value === "master_admin" ||
    value === "master admin" ||
    value === "super_admin" ||
    value === "superadmin" ||
    value.includes("master")
  );
}

async function loadSpecialistRow(input: {
  specialistId?: string | null;
  username?: string | null;
  storeNumber?: string | null;
}): Promise<StoreSpecialist | null> {
  const admin = createAdminClient();
  const store = normalizeStoreNumber(input.storeNumber ?? "");

  if (input.specialistId) {
    const { data, error } = await admin
      .from("store_specialists")
      .select("*")
      .eq("id", String(input.specialistId))
      .maybeSingle();
    if (error) throw new Error(error.message || "Could not load specialist");
    if (data) return mapRow(data as Record<string, unknown>);
  }

  const username = String(input.username ?? "").trim();
  if (username) {
    let query = admin
      .from("store_specialists")
      .select("*")
      .ilike("username", username)
      .eq("is_active", true)
      .limit(5);
    if (store) query = query.eq("store_number", store);
    const { data, error } = await query;
    if (error) throw new Error(error.message || "Could not load specialist");
    if (data?.[0]) return mapRow(data[0] as Record<string, unknown>);
  }

  // Master Admin fallback by role / name
  let masterQuery = admin
    .from("store_specialists")
    .select("*")
    .eq("role", "MasterAdmin")
    .eq("is_active", true)
    .limit(5);
  if (store) masterQuery = masterQuery.eq("store_number", store);
  const { data: masters, error: masterErr } = await masterQuery;
  if (masterErr) throw new Error(masterErr.message || "Could not load Master Admin");
  if (masters?.[0]) return mapRow(masters[0] as Record<string, unknown>);

  const { data: byName } = await admin
    .from("store_specialists")
    .select("*")
    .ilike("name", "Master Admin")
    .limit(1)
    .maybeSingle();
  if (byName) return mapRow(byName as Record<string, unknown>);

  return null;
}

async function upsertStoreProfiles(
  specialist: StoreSpecialist,
  pin: string
): Promise<void> {
  const admin = createAdminClient();
  const probe = await admin.from("store_profiles").select("id").limit(1);
  if (
    probe.error &&
    /does not exist|schema cache|could not find the table/i.test(
      probe.error.message
    )
  ) {
    return;
  }

  const store = normalizeStoreNumber(specialist.store_number ?? "") || "0001";
  const username =
    specialist.username?.trim() ||
    (specialist.role === "MasterAdmin" ? "master_admin" : null);

  const profilePayload: Record<string, unknown> = {
    username,
    full_name: specialist.name,
    name: specialist.name,
    role:
      specialist.role === "MasterAdmin"
        ? "MasterAdmin"
        : specialist.role === "Supervisor"
          ? "Supervisor"
          : "Associate",
    pin,
    pin_code: pin,
    store_number: store,
    specialist_id: String(specialist.id),
    is_active: specialist.is_active !== false,
    must_change_credentials: false,
    assigned_department:
      specialist.assigned_department && specialist.assigned_department !== "all"
        ? specialist.assigned_department
        : null,
  };

  const { data: bySpecialist } = await admin
    .from("store_profiles")
    .select("id")
    .eq("specialist_id", String(specialist.id))
    .maybeSingle();

  if (bySpecialist?.id) {
    const { error } = await admin
      .from("store_profiles")
      .update(profilePayload)
      .eq("id", bySpecialist.id);
    if (error) throw new Error(error.message || "Could not update store_profiles");
    return;
  }

  if (username) {
    const { data: byUser } = await admin
      .from("store_profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (byUser?.id) {
      const { error } = await admin
        .from("store_profiles")
        .update(profilePayload)
        .eq("id", byUser.id);
      if (error) {
        throw new Error(error.message || "Could not update store_profiles");
      }
      return;
    }
  }

  if (specialist.role === "MasterAdmin") {
    const { data: roleRows } = await admin
      .from("store_profiles")
      .select("id, role, full_name, name")
      .limit(50);
    const masterRow = (roleRows ?? []).find((row) => {
      const roleOk = isMasterRole(row.role);
      const name = String(row.full_name ?? row.name ?? "")
        .toLowerCase()
        .trim();
      return roleOk || MASTER_NAMES.has(name);
    });
    if (masterRow?.id) {
      // Prefer super_admin label when that column style is used on profiles.
      const payload = {
        ...profilePayload,
        role: isMasterRole(masterRow.role) ? masterRow.role : "MasterAdmin",
      };
      const { error } = await admin
        .from("store_profiles")
        .update(payload)
        .eq("id", masterRow.id);
      if (error) {
        throw new Error(error.message || "Could not update store_profiles");
      }
      return;
    }
  }

  const { error: insertError } = await admin
    .from("store_profiles")
    .insert(profilePayload);
  if (insertError) {
    if (/relation .*store_profiles.* does not exist|schema cache/i.test(
      insertError.message
    )) {
      return;
    }
    if (username) {
      const { error: upsertError } = await admin.from("store_profiles").upsert(
        { ...profilePayload, username },
        { onConflict: "username" }
      );
      if (
        upsertError &&
        !/does not exist|schema cache/i.test(upsertError.message)
      ) {
        throw new Error(
          upsertError.message || "Could not upsert store_profiles"
        );
      }
      return;
    }
    throw new Error(insertError.message || "Could not create store_profiles row");
  }
}

async function syncAuthProfilePin(
  specialist: StoreSpecialist,
  pin: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: linked } = await admin
    .from("profiles")
    .select("id")
    .eq("specialist_id", String(specialist.id))
    .maybeSingle();
  if (!linked?.id) return;

  await admin
    .from("profiles")
    .update({
      pin,
      pin_code: pin,
      must_change_credentials: false,
      username: specialist.username,
      full_name: specialist.name,
      store_number: normalizeStoreNumber(specialist.store_number ?? "") || null,
    })
    .eq("id", linked.id);

  // Keep Auth password aligned for optional direct recovery (hub-bridge rotates too).
  await admin.auth.admin.updateUserById(String(linked.id), {
    password: pin,
    email_confirm: true,
  });
}

export type ResetPinResult = {
  specialist: StoreSpecialist;
  created_specialist: boolean;
  upserted_store_profiles: boolean;
};

/**
 * Verify current PIN (when required) and write the new PIN to roster + profiles.
 */
export async function resetHubPin(input: {
  specialist_id?: string | null;
  username?: string | null;
  store_number?: string | null;
  current_pin?: string | null;
  new_pin: string;
  /** Super Admin actor may skip current_pin for admin-driven resets. */
  require_current_pin?: boolean;
  /** Auto-create Master Admin roster row when missing. */
  ensure_master?: boolean;
}): Promise<ResetPinResult> {
  const newPin = String(input.new_pin ?? "").trim();
  if (!/^\d{4}$/.test(newPin)) {
    throw new Error("New PIN must be exactly 4 digits");
  }

  const admin = createAdminClient();
  const store = normalizeStoreNumber(input.store_number ?? "");
  let createdSpecialist = false;

  let specialist = await loadSpecialistRow({
    specialistId: input.specialist_id,
    username: input.username,
    storeNumber: store,
  });

  if (!specialist && input.ensure_master) {
    const { data, error } = await admin
      .from("store_specialists")
      .insert({
        name: "Master Admin",
        username: "master_admin",
        role: "MasterAdmin",
        assigned_department: "all",
        pin_code: newPin,
        store_number: store || "0001",
        is_active: true,
        must_change_credentials: false,
        must_change_pin: false,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Could not create Master Admin roster");
    }
    specialist = mapRow(data as Record<string, unknown>);
    createdSpecialist = true;
  }

  if (!specialist || specialist.is_active === false) {
    throw new Error("Profile not found");
  }

  if (input.require_current_pin !== false) {
    const current = String(input.current_pin ?? "").trim();
    const storedPin =
      specialist.pin_hash?.trim() || specialist.pin_code?.trim() || "";
    const pinOk = storedPin
      ? verifyStoredPin(current, storedPin)
      : current === DEFAULT_SUPERVISOR_PIN;
    if (!current || !pinOk) {
      throw new Error("Current PIN is incorrect");
    }
  }

  const pinHash = hashPin(newPin);
  const { data: updated, error: updateError } = await admin
    .from("store_specialists")
    .update({
      pin_code: pinHash,
      pin_hash: pinHash,
      pin_updated_at: new Date().toISOString(),
      must_change_credentials: false,
      must_change_pin: false,
      status: "active",
      username: specialist.username || (specialist.role === "MasterAdmin" ? "master_admin" : specialist.username),
      is_active: true,
    })
    .eq("id", specialist.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message || "Could not update roster PIN");
  }

  const saved = mapRow(updated as Record<string, unknown>);

  let upsertedProfiles = false;
  try {
    await upsertStoreProfiles(saved, newPin);
    upsertedProfiles = true;
  } catch (err) {
    // Master Admin must not fail solely because store_profiles is missing —
    // rethrow only if this is not a "relation missing" style failure already handled.
    const message = err instanceof Error ? err.message : String(err);
    if (!/store_profiles/i.test(message)) {
      throw err;
    }
  }

  try {
    await syncAuthProfilePin(saved, newPin);
  } catch {
    // Auth sync is best-effort; roster PIN is authoritative for Hub bridge.
  }

  return {
    specialist: saved,
    created_specialist: createdSpecialist,
    upserted_store_profiles: upsertedProfiles,
  };
}
