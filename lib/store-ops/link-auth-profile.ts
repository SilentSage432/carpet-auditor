/**
 * Link auth.users → public.profiles (id = auth uid) and inject JWT app_metadata.
 * Called after Hub PIN bridge / phone OTP verify / credential reset so Store
 * Ops APIs can resolve the actor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { toStoreOpsDepartmentCode } from "./department-codes";
import { accessibleStoreOpsCodes } from "@/lib/department-access";
import type { StoreSpecialist } from "@/lib/types";
import { normalizeStoreNumber } from "@/lib/store";

function mapSpecialistRole(
  role: StoreSpecialist["role"]
): "super_admin" | "department_supervisor" | "associate" | null {
  if (role === "MasterAdmin") return "super_admin";
  if (role === "Supervisor") return "department_supervisor";
  if (role === "Associate") return "associate";
  return null;
}

/**
 * Upsert profiles row for the Auth user and set raw_app_meta_data claims
 * (store_number, department, role) used by JWT RLS + resolveStoreOpsActor.
 */
export async function linkAuthUserToSpecialistProfile(
  admin: SupabaseClient,
  input: {
    authUserId: string;
    email?: string | null;
    specialist: StoreSpecialist;
  }
): Promise<void> {
  const role = mapSpecialistRole(input.specialist.role);
  if (!role) return;

  const storeNumber = normalizeStoreNumber(
    String(input.specialist.store_number ?? "")
  );
  // Super Admin may bootstrap before a store is set — keep linking so Hub PIN works.
  if (!storeNumber && role !== "super_admin") return;
  const effectiveStore = storeNumber || "0001";

  let departmentId: string | null = null;
  let departmentCode: string | null = null;

  if (role !== "super_admin") {
    departmentCode = toStoreOpsDepartmentCode(
      input.specialist.assigned_department
    );
    if (!departmentCode) return;

    const { data: store } = await admin
      .from("stores")
      .select("id")
      .eq("store_number", effectiveStore)
      .maybeSingle();

    if (store?.id) {
      const { data: dept } = await admin
        .from("departments")
        .select("id, code")
        .eq("store_id", store.id)
        .eq("code", departmentCode)
        .maybeSingle();
      departmentId = dept?.id ? String(dept.id) : null;
    }
  }

  const jwtRole =
    role === "super_admin" ? "master_admin" : role === "associate" ? "associate" : "department_supervisor";

  const profilePayload: Record<string, unknown> = {
    id: input.authUserId,
    role,
    assigned_department_id: departmentId,
    store_number: effectiveStore,
    specialist_id: String(input.specialist.id),
    username: input.specialist.username ?? null,
    full_name: input.specialist.name ?? null,
    is_active: input.specialist.is_active !== false,
    must_change_credentials: Boolean(input.specialist.must_change_credentials),
    pin_code: input.specialist.pin_code ?? null,
    pin: input.specialist.pin_code ?? null,
    assigned_department:
      input.specialist.assigned_department &&
      input.specialist.assigned_department !== "all"
        ? input.specialist.assigned_department
        : null,
    accessible_departments: accessibleStoreOpsCodes(input.specialist),
  };

  const { error: profileError } = await admin
    .from("profiles")
    .upsert(profilePayload, { onConflict: "id" });

  if (profileError) {
    // Live schemas vary — retry with the minimal Store Ops identity columns.
    const { error: minimalError } = await admin.from("profiles").upsert(
      {
        id: input.authUserId,
        role,
        store_number: effectiveStore,
        specialist_id: String(input.specialist.id),
      },
      { onConflict: "id" }
    );
    if (minimalError) {
      throw new Error(
        profileError.message ||
          minimalError.message ||
          "Could not link Auth profile"
      );
    }
  }

  const { error: metaError } = await admin.auth.admin.updateUserById(
    input.authUserId,
    {
      app_metadata: {
        store_number: effectiveStore,
        department: departmentCode,
        role: jwtRole,
        specialist_id: String(input.specialist.id),
        accessible_departments: accessibleStoreOpsCodes(input.specialist),
      },
    }
  );

  if (metaError) {
    throw new Error(metaError.message || "Could not update JWT app_metadata");
  }

  const { claimRosterMemberForAuthUser } = await import(
    "@/lib/onboarding/claim-roster-auth"
  );
  await claimRosterMemberForAuthUser({
    supabase: admin,
    authUserId: input.authUserId,
    email: input.email ?? input.specialist.email ?? null,
    specialistId: String(input.specialist.id),
    phone: input.specialist.phone_number ?? null,
  });
}
