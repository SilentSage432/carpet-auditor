/**
 * Link auth.users → public.profiles (id = auth uid) and inject JWT app_metadata.
 * Called after phone OTP verify / credential reset so Store Ops APIs can resolve the actor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { toStoreOpsDepartmentCode } from "./department-codes";
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
  if (!storeNumber) return;

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
      .eq("store_number", storeNumber)
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

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: input.authUserId,
      email: input.email ?? null,
      role,
      assigned_department_id: departmentId,
      store_number: storeNumber,
      specialist_id: String(input.specialist.id),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (profileError) {
    throw new Error(profileError.message || "Could not link Auth profile");
  }

  const { error: metaError } = await admin.auth.admin.updateUserById(
    input.authUserId,
    {
      app_metadata: {
        store_number: storeNumber,
        department: departmentCode,
        role: jwtRole,
        specialist_id: String(input.specialist.id),
      },
    }
  );

  if (metaError) {
    throw new Error(metaError.message || "Could not update JWT app_metadata");
  }
}
