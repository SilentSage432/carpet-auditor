/**
 * PRIORITY-UX-002 — Durable manual coverage priority at physical-bay scope.
 *
 * Persistence: existing store_locations.priority_override (true = High).
 * Mutation is topology-row fan-out for one (department_id, aisle, bay).
 * Does not create a physical_bays table. Does not write velocity_tier.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAisle } from "./aisle";
import { physicalBayKey } from "./physical-bay";
import { isEligibleRotationLocation } from "./location-eligibility";

export type RotationPriorityLevel = "standard" | "high";

export type AisleRotationPriorityLevel =
  | RotationPriorityLevel
  | "mixed";

export type PhysicalBayPriorityResult = {
  department_id: string;
  aisle: string;
  bay: number;
  priority: RotationPriorityLevel;
  physical_bay_key: string;
  surfaces_updated: number;
  reason: string;
};

export function parseRotationPriorityLevel(
  raw: unknown
): RotationPriorityLevel | null {
  if (raw === "standard" || raw === "high") return raw;
  if (raw === true) return "high";
  if (raw === false) return "standard";
  return null;
}

export function rotationPriorityToOverride(
  priority: RotationPriorityLevel
): boolean {
  return priority === "high";
}

/** OR across eligible sibling surfaces — High if any face is High. */
export function composePhysicalBayManualPriority(
  surfaces: Array<{
    priority_override?: boolean | null;
    is_active?: boolean | null;
    location_type?: string | null;
  }>
): RotationPriorityLevel {
  const eligible = surfaces.filter((loc) => isEligibleRotationLocation(loc));
  if (eligible.some((loc) => loc.priority_override === true)) return "high";
  return "standard";
}

/**
 * Derived aisle presentation. Mixed is not persisted — some High, some Standard.
 */
export function composeAisleManualPriority(
  locations: Array<{
    aisle?: string | number | null;
    priority_override?: boolean | null;
    is_active?: boolean | null;
    location_type?: string | null;
    department_id?: string | null;
    bay?: number | string | null;
  }>,
  aisle: string
): AisleRotationPriorityLevel {
  const needle = normalizeAisle(aisle);
  const eligible = locations.filter((loc) => {
    if (!isEligibleRotationLocation(loc)) return false;
    return normalizeAisle(loc.aisle) === needle;
  });
  if (eligible.length === 0) return "standard";

  const byBay = new Map<number, typeof eligible>();
  for (const loc of eligible) {
    const bay = Number(loc.bay) || 0;
    const list = byBay.get(bay) ?? [];
    list.push(loc);
    byBay.set(bay, list);
  }

  let high = 0;
  let standard = 0;
  for (const surfaces of byBay.values()) {
    if (composePhysicalBayManualPriority(surfaces) === "high") high += 1;
    else standard += 1;
  }
  if (high > 0 && standard > 0) return "mixed";
  if (high > 0) return "high";
  return "standard";
}

/**
 * Set Standard / High on every eligible sibling surface of one physical bay.
 * One UPDATE ... IN ids. Re-reads faces and fails if they disagree.
 */
export async function setPhysicalBayRotationPriority(
  supabase: SupabaseClient,
  input: {
    department_id: string;
    aisle: string;
    bay: number | string;
    priority: RotationPriorityLevel;
  }
): Promise<PhysicalBayPriorityResult> {
  const departmentId = String(input.department_id ?? "").trim();
  const aisle = normalizeAisle(input.aisle);
  const bay = Math.floor(Number(input.bay));
  if (!departmentId || !aisle) {
    throw new Error("department_id and aisle are required");
  }
  if (!Number.isFinite(bay) || bay < 0) {
    throw new Error("bay must be an integer ≥ 0");
  }

  const { data: locs, error } = await supabase
    .from("store_locations")
    .select("id, aisle, bay, type, location_type, is_active, priority_override")
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  const targetIds = (locs ?? [])
    .filter((loc) => {
      if (!isEligibleRotationLocation(loc)) return false;
      if (normalizeAisle(loc.aisle) !== aisle) return false;
      return (Number(loc.bay) || 0) === bay;
    })
    .map((loc) => String(loc.id));

  if (targetIds.length === 0) {
    throw new Error("No eligible physical-bay surfaces to update.");
  }

  const now = new Date().toISOString();
  const nextOverride = rotationPriorityToOverride(input.priority);
  const { error: updateError } = await supabase
    .from("store_locations")
    .update({
      priority_override: nextOverride,
      updated_at: now,
    })
    .in("id", targetIds);

  if (updateError) throw new Error(updateError.message);

  const { data: refreshed, error: readError } = await supabase
    .from("store_locations")
    .select("id, priority_override")
    .in("id", targetIds);

  if (readError) throw new Error(readError.message);

  const rows = refreshed ?? [];
  if (rows.length !== targetIds.length) {
    throw new Error("Could not confirm physical-bay priority on all surfaces.");
  }
  const disagree = rows.some(
    (row) => Boolean(row.priority_override) !== nextOverride
  );
  if (disagree) {
    throw new Error(
      "Physical-bay priority surfaces disagree after save — no success claimed."
    );
  }

  const key = physicalBayKey({
    department_id: departmentId,
    aisle,
    bay,
  });
  const label = input.priority === "high" ? "High priority" : "Standard";
  return {
    department_id: departmentId,
    aisle,
    bay,
    priority: input.priority,
    physical_bay_key: key,
    surfaces_updated: targetIds.length,
    reason: `${aisle} bay ${bay} set to ${label} (${targetIds.length} surface${
      targetIds.length === 1 ? "" : "s"
    }).`,
  };
}
