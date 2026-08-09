/**
 * Store Operations rotation engine — cycle pick + complete.
 * Cool-down: COMPLETED locations stay out of picks until the department cycle resets.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Department, StoreLocation, WeeklyRotation } from "./types";
import { isoWeekLabel, pickRandom } from "./week";

export type GenerateRotationsResult = {
  assigned_week: string;
  cycle_number: number;
  cycle_reset: boolean;
  rotations: WeeklyRotation[];
  locations: StoreLocation[];
};

async function loadPendingLocations(
  supabase: SupabaseClient,
  departmentId: string
): Promise<{ locations: StoreLocation[]; cycleNumber: number }> {
  const { data: anyLoc, error: sampleError } = await supabase
    .from("store_locations")
    .select("cycle_number")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .order("cycle_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sampleError) throw new Error(sampleError.message);

  const cycleNumber = anyLoc?.cycle_number ?? 1;

  const { data, error } = await supabase
    .from("store_locations")
    .select("*")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .eq("status", "PENDING")
    .eq("cycle_number", cycleNumber);

  if (error) throw new Error(error.message);
  return {
    locations: (data ?? []) as StoreLocation[],
    cycleNumber,
  };
}

/**
 * Return stale ASSIGNED bays (not on this week's open rotation) to PENDING
 * so the weekly engine can keep moving.
 */
export async function reclaimStaleAssignments(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string
): Promise<number> {
  const { data: openThisWeek, error: openError } = await supabase
    .from("weekly_rotations")
    .select("location_id")
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel)
    .eq("is_completed", false);

  if (openError) throw new Error(openError.message);

  const keep = new Set((openThisWeek ?? []).map((r) => r.location_id as string));

  const { data: assigned, error: assignedError } = await supabase
    .from("store_locations")
    .select("id")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .eq("status", "ASSIGNED");

  if (assignedError) throw new Error(assignedError.message);

  const staleIds = (assigned ?? [])
    .map((r) => r.id as string)
    .filter((id) => !keep.has(id));

  if (staleIds.length === 0) return 0;

  const { error: resetError } = await supabase
    .from("store_locations")
    .update({
      status: "PENDING",
      updated_at: new Date().toISOString(),
    })
    .in("id", staleIds);

  if (resetError) throw new Error(resetError.message);
  return staleIds.length;
}

/**
 * When every active location is COMPLETED (or none PENDING), bump cycle and
 * reset all active locations in the department to PENDING.
 */
export async function resetDepartmentCycleIfNeeded(
  supabase: SupabaseClient,
  departmentId: string
): Promise<{ reset: boolean; cycleNumber: number; pending: StoreLocation[] }> {
  const { locations: pending, cycleNumber } = await loadPendingLocations(
    supabase,
    departmentId
  );

  if (pending.length > 0) {
    return { reset: false, cycleNumber, pending };
  }

  const { data: active, error: activeError } = await supabase
    .from("store_locations")
    .select("id, status")
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (activeError) throw new Error(activeError.message);
  if (!active || active.length === 0) {
    return { reset: false, cycleNumber, pending: [] };
  }

  const allCompleted = active.every((row) => row.status === "COMPLETED");
  if (!allCompleted) {
    return { reset: false, cycleNumber, pending: [] };
  }

  const nextCycle = cycleNumber + 1;
  const { error: resetError } = await supabase
    .from("store_locations")
    .update({
      status: "PENDING",
      cycle_number: nextCycle,
      updated_at: new Date().toISOString(),
    })
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (resetError) throw new Error(resetError.message);

  const reloaded = await loadPendingLocations(supabase, departmentId);
  return {
    reset: true,
    cycleNumber: reloaded.cycleNumber,
    pending: reloaded.locations,
  };
}

export async function generateWeeklyRotations(
  supabase: SupabaseClient,
  departmentId: string,
  count: number,
  weekLabel: string = isoWeekLabel()
): Promise<GenerateRotationsResult> {
  if (!Number.isFinite(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }

  await reclaimStaleAssignments(supabase, departmentId, weekLabel);

  const { reset, cycleNumber, pending } = await resetDepartmentCycleIfNeeded(
    supabase,
    departmentId
  );

  if (pending.length === 0) {
    throw new Error(
      "No PENDING locations available for this department. Map bays in Store Map first, or finish ASSIGNED work."
    );
  }

  const selected = pickRandom(pending, Math.min(count, pending.length));
  const ids = selected.map((loc) => loc.id);
  const now = new Date().toISOString();

  const { error: assignError } = await supabase
    .from("store_locations")
    .update({ status: "ASSIGNED", updated_at: now })
    .in("id", ids);

  if (assignError) throw new Error(assignError.message);

  const rows = selected.map((loc) => ({
    department_id: departmentId,
    location_id: loc.id,
    assigned_week: weekLabel,
    is_completed: false,
  }));

  const { data: rotations, error: insertError } = await supabase
    .from("weekly_rotations")
    .upsert(rows, { onConflict: "location_id,assigned_week" })
    .select("*");

  if (insertError) throw new Error(insertError.message);

  const { data: locations, error: locError } = await supabase
    .from("store_locations")
    .select("*")
    .in("id", ids);

  if (locError) throw new Error(locError.message);

  return {
    assigned_week: weekLabel,
    cycle_number: cycleNumber,
    cycle_reset: reset,
    rotations: (rotations ?? []) as WeeklyRotation[],
    locations: (locations ?? []) as StoreLocation[],
  };
}

export type DepartmentCronResult = {
  department_id: string;
  department_code: string;
  department_name: string;
  weekly_bay_target: number;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  created?: number;
  cycle_number?: number;
  cycle_reset?: boolean;
  assigned_week?: string;
};

/**
 * Sunday cron: for every active department, queue up to weekly_bay_target bays.
 */
export async function runWeeklyRotationForAllDepartments(
  supabase: SupabaseClient,
  weekLabel: string = isoWeekLabel()
): Promise<DepartmentCronResult[]> {
  const { data: departments, error } = await supabase
    .from("departments")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw new Error(error.message);

  const results: DepartmentCronResult[] = [];

  for (const dept of (departments ?? []) as Department[]) {
    const target = Math.max(1, Number(dept.weekly_bay_target) || 10);
    const base: DepartmentCronResult = {
      department_id: dept.id,
      department_code: dept.code,
      department_name: dept.name,
      weekly_bay_target: target,
      ok: false,
    };

    try {
      const { count, error: locCountError } = await supabase
        .from("store_locations")
        .select("id", { count: "exact", head: true })
        .eq("department_id", dept.id)
        .eq("is_active", true);

      if (locCountError) throw new Error(locCountError.message);
      if (!count) {
        results.push({
          ...base,
          ok: true,
          skipped: true,
          reason: "No mapped store locations",
        });
        continue;
      }

      const generated = await generateWeeklyRotations(
        supabase,
        dept.id,
        target,
        weekLabel
      );

      results.push({
        ...base,
        ok: true,
        created: generated.rotations.length,
        cycle_number: generated.cycle_number,
        cycle_reset: generated.cycle_reset,
        assigned_week: generated.assigned_week,
      });
    } catch (err) {
      results.push({
        ...base,
        ok: false,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return results;
}

export async function completeWeeklyRotation(
  supabase: SupabaseClient,
  rotationId: string,
  expectedDepartmentId?: string | null
): Promise<{ rotation: WeeklyRotation; location: StoreLocation }> {
  const { data: rotation, error: fetchError } = await supabase
    .from("weekly_rotations")
    .select("*")
    .eq("id", rotationId)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!rotation) throw new Error("Rotation not found");

  if (
    expectedDepartmentId &&
    rotation.department_id !== expectedDepartmentId
  ) {
    throw new Error("Rotation is outside your assigned department");
  }

  if (rotation.is_completed) {
    const { data: location } = await supabase
      .from("store_locations")
      .select("*")
      .eq("id", rotation.location_id)
      .maybeSingle();
    return {
      rotation: rotation as WeeklyRotation,
      location: location as StoreLocation,
    };
  }

  const now = new Date().toISOString();

  const { data: updatedRotation, error: rotError } = await supabase
    .from("weekly_rotations")
    .update({ is_completed: true, completed_at: now })
    .eq("id", rotationId)
    .select("*")
    .single();

  if (rotError) throw new Error(rotError.message);

  const { data: location, error: locError } = await supabase
    .from("store_locations")
    .update({
      status: "COMPLETED",
      last_completed_at: now,
      updated_at: now,
    })
    .eq("id", rotation.location_id)
    .select("*")
    .single();

  if (locError) throw new Error(locError.message);

  return {
    rotation: updatedRotation as WeeklyRotation,
    location: location as StoreLocation,
  };
}

export async function resolveDepartmentIdByCode(
  supabase: SupabaseClient,
  code: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("departments")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
