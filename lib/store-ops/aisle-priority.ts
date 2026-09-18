/**
 * ENGINE-PROD-004 — Manual aisle priority via existing priority_override.
 *
 * SET: all eligible physical-bay surfaces in department+aisle get
 * priority_override=true (both SELLING/TOPSTOCK siblings).
 *
 * CLEAR (Approach A — disclosed): clears priority_override for ALL surfaces
 * in that aisle. Cannot distinguish individual bay locks from aisle bulk —
 * no provenance column exists. Callers must disclose this to the DS.
 *
 * No schema. No seasonal write path (seasonal uses operational_context
 * location relevance, not this flag).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAisle } from "./aisle";

export type AislePriorityResult = {
  aisle: string;
  department_id: string;
  priority: boolean;
  surfaces_updated: number;
  /** True when clear may have removed individually set bay locks. */
  clear_erases_individual_locks: boolean;
  reason: string;
};

/**
 * Set or clear sticky priority_override for every active non-SHOWROOM
 * surface in a department aisle.
 */
export async function setAislePriorityOverride(
  supabase: SupabaseClient,
  input: {
    department_id: string;
    aisle: string;
    priority: boolean;
  }
): Promise<AislePriorityResult> {
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  if (!departmentId || !aisle) {
    throw new Error("department_id and aisle are required");
  }

  const { data: locs, error } = await supabase
    .from("store_locations")
    .select("id, aisle, location_type, is_active")
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  const targetIds = (locs ?? [])
    .filter((loc) => {
      if ((loc.location_type ?? "STANDARD") === "SHOWROOM_STACKOUT") return false;
      return normalizeAisle(loc.aisle) === aisle;
    })
    .map((loc) => String(loc.id));

  if (targetIds.length === 0) {
    return {
      aisle,
      department_id: departmentId,
      priority: input.priority,
      surfaces_updated: 0,
      clear_erases_individual_locks: !input.priority,
      reason: input.priority
        ? "No eligible aisle surfaces to mark high priority."
        : "No eligible aisle surfaces to clear.",
    };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("store_locations")
    .update({
      priority_override: input.priority === true,
      updated_at: now,
    })
    .in("id", targetIds);

  if (updateError) throw new Error(updateError.message);

  return {
    aisle,
    department_id: departmentId,
    priority: input.priority === true,
    surfaces_updated: targetIds.length,
    clear_erases_individual_locks: !input.priority,
    reason: input.priority
      ? `Aisle ${aisle} marked high priority (${targetIds.length} surfaces).`
      : `Aisle ${aisle} priority cleared on all ${targetIds.length} surfaces. This also clears any individual bay locks in that aisle.`,
  };
}
