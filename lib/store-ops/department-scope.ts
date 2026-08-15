/**
 * Actor department scoping for Store Ops APIs.
 * Composes StoreOpsActor.accessibleDepartmentCodes; does not own JWT claims.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorAccessibleDepartmentCodes,
  actorAllowsDepartmentCode,
  StoreOpsAuthError,
  type StoreOpsActor,
} from "./auth";
import { resolveDepartmentIdByCode } from "./rotations";

export {
  actorAccessibleDepartmentCodes,
  actorAllowsDepartmentCode,
};

export async function resolveScopedDepartmentId(
  supabase: SupabaseClient,
  actor: StoreOpsActor,
  storeId: string,
  requestedDepartmentId?: string | null
): Promise<string | null> {
  const requested = String(requestedDepartmentId ?? "").trim();

  if (actor.role === "super_admin") {
    return requested || null;
  }

  if (requested) {
    const { data, error } = await supabase
      .from("departments")
      .select("id, code")
      .eq("id", requested)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || !actorAllowsDepartmentCode(actor, String(data.code ?? ""))) {
      throw new StoreOpsAuthError("Department is outside your assigned scopes", 403);
    }
    return String(data.id);
  }

  if (!actor.departmentCode) {
    throw new StoreOpsAuthError("No department assigned", 403);
  }
  const primary = await resolveDepartmentIdByCode(
    supabase,
    actor.departmentCode,
    storeId
  );
  if (!primary) {
    throw new StoreOpsAuthError("Department not found", 404);
  }
  return primary;
}

export async function assertActorCanAccessDepartmentId(
  supabase: SupabaseClient,
  actor: StoreOpsActor,
  storeId: string,
  departmentId: string | null | undefined
): Promise<void> {
  if (actor.role === "super_admin") return;
  const id = String(departmentId ?? "").trim();
  if (!id) {
    throw new StoreOpsAuthError("Department is outside your assigned scopes", 403);
  }
  await resolveScopedDepartmentId(supabase, actor, storeId, id);
}
