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
import { departmentCodesMatch, departmentIdsMatchingCode } from "./department-codes";
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
    const { data: byId, error } = await supabase
      .from("departments")
      .select("id, code")
      .eq("id", requested)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    let data = byId;
    if (!data) {
      const { data: rows, error: listError } = await supabase
        .from("departments")
        .select("id, code")
        .eq("store_id", storeId);
      if (listError) throw new Error(listError.message);
      data =
        (rows ?? []).find((row) =>
          departmentCodesMatch(String(row.code ?? ""), requested)
        ) ?? null;
    }
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

/**
 * Map a department UUID or Lowe's/hub code to every departments.id in that
 * family for this store (flooring ≡ D23). Null requested → no filter.
 */
export async function resolveStoreLocationDepartmentIds(
  supabase: SupabaseClient,
  storeId: string,
  requested: string | null | undefined
): Promise<string[] | null> {
  const needle = String(requested ?? "").trim();
  if (!needle) return null;

  const { data, error } = await supabase
    .from("departments")
    .select("id, code")
    .eq("store_id", storeId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; code: string | null }>;
  const ids = departmentIdsMatchingCode(
    rows.map((row) => ({ id: String(row.id), code: String(row.code ?? "") })),
    needle
  );
  return ids.length > 0 ? ids : [needle];
}
