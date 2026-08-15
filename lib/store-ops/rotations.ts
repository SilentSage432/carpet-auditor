/**
 * Store Operations rotation engine — cycle pick + complete.
 * Cool-down: COMPLETED locations stay out of picks until the department cycle resets.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Department, StoreLocation, WeeklyRotation } from "./types";
import { listActiveStores } from "./stores";
import { pickSundayVelocityPrioritized } from "./rotation";
import {
  isoWeekLabel,
  pickWeightedByPriorityAndAge,
  resolveWeeklyBayTarget,
} from "./week";

function isStandardAisleLocation(loc: StoreLocation): boolean {
  return (loc.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT";
}

export type GenerateRotationsResult = {
  assigned_week: string;
  cycle_number: number;
  cycle_reset: boolean;
  rotations: WeeklyRotation[];
  locations: StoreLocation[];
  weekly_bay_target: number;
};

export { resolveWeeklyBayTarget };

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
    .eq("cycle_number", cycleNumber)
    .neq("location_type", "SHOWROOM_STACKOUT");

  if (error) {
    // Pre-migration fallback: location_type column may not exist yet
    if (/location_type/i.test(error.message)) {
      const fallback = await supabase
        .from("store_locations")
        .select("*")
        .eq("department_id", departmentId)
        .eq("is_active", true)
        .eq("status", "PENDING")
        .eq("cycle_number", cycleNumber);
      if (fallback.error) throw new Error(fallback.error.message);
      return {
        locations: (fallback.data ?? []) as StoreLocation[],
        cycleNumber,
      };
    }
    throw new Error(error.message);
  }
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
    .select("id, status, location_type")
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (activeError) throw new Error(activeError.message);
  const aisleActive = (active ?? []).filter(
    (row) => (row.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT"
  );
  if (aisleActive.length === 0) {
    return { reset: false, cycleNumber, pending: [] };
  }

  const allCompleted = aisleActive.every((row) => row.status === "COMPLETED");
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
    .eq("is_active", true)
    .neq("location_type", "SHOWROOM_STACKOUT");

  if (resetError) {
    // Pre-migration: no location_type — reset all active
    if (/location_type/i.test(resetError.message)) {
      const legacy = await supabase
        .from("store_locations")
        .update({
          status: "PENDING",
          cycle_number: nextCycle,
          updated_at: new Date().toISOString(),
        })
        .eq("department_id", departmentId)
        .eq("is_active", true);
      if (legacy.error) throw new Error(legacy.error.message);
    } else {
      throw new Error(resetError.message);
    }
  }

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
  count?: number | null,
  weekLabel: string = isoWeekLabel()
): Promise<GenerateRotationsResult> {
  await reclaimStaleAssignments(supabase, departmentId, weekLabel);

  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("id, store_id, weekly_bay_target")
    .eq("id", departmentId)
    .maybeSingle();

  if (departmentError) throw new Error(departmentError.message);
  if (!department?.store_id) {
    throw new Error("Department is missing store_id");
  }

  const dbTarget = resolveWeeklyBayTarget(department.weekly_bay_target);
  const override =
    count != null && Number.isFinite(Number(count)) && Number(count) >= 1
      ? Math.floor(Number(count))
      : null;
  const drawCount = override ?? dbTarget;

  const { reset, cycleNumber, pending } = await resetDepartmentCycleIfNeeded(
    supabase,
    departmentId
  );

  // Prioritize CARRIED_OVER (missed last week) ahead of fresh PENDING
  const { data: carriedRows, error: carriedError } = await supabase
    .from("store_locations")
    .select("*")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .eq("status", "CARRIED_OVER")
    .neq("location_type", "SHOWROOM_STACKOUT");

  if (carriedError) {
    if (/location_type/i.test(carriedError.message)) {
      const legacy = await supabase
        .from("store_locations")
        .select("*")
        .eq("department_id", departmentId)
        .eq("is_active", true)
        .eq("status", "CARRIED_OVER");
      if (legacy.error) throw new Error(legacy.error.message);
      // fall through with legacy data via reassignment below
      const carried = (legacy.data ?? []) as StoreLocation[];
      return finishGenerate(
        supabase,
        departmentId,
        department,
        weekLabel,
        drawCount,
        dbTarget,
        cycleNumber,
        reset,
        pending,
        carried
      );
    }
    throw new Error(carriedError.message);
  }

  return finishGenerate(
    supabase,
    departmentId,
    department,
    weekLabel,
    drawCount,
    dbTarget,
    cycleNumber,
    reset,
    pending,
    (carriedRows ?? []) as StoreLocation[]
  );
}

async function finishGenerate(
  supabase: SupabaseClient,
  departmentId: string,
  department: { id: string; store_id: string; weekly_bay_target?: unknown },
  weekLabel: string,
  drawCount: number,
  dbTarget: number,
  cycleNumber: number,
  reset: boolean,
  pending: StoreLocation[],
  carried: StoreLocation[]
): Promise<GenerateRotationsResult> {
  const pool: StoreLocation[] = [];

  // CARRIED_OVER still first — then adaptive weights among them
  const carriedPick = pickWeightedByPriorityAndAge(
    carried.filter(isStandardAisleLocation),
    Math.min(drawCount, carried.length)
  );
  pool.push(...carriedPick);

  const remaining = drawCount - pool.length;
  if (remaining > 0) {
    const pendingAvailable = pending.filter(isStandardAisleLocation);
    pool.push(
      ...pickSundayVelocityPrioritized(
        pendingAvailable,
        remaining,
        pool.map((s) => s.id)
      )
    );
  }

  if (pool.length === 0) {
    throw new Error(
      "No PENDING or CARRIED_OVER locations available for this department. Map bays in Store Map first, or finish ASSIGNED work."
    );
  }

  const selected = pool;
  const ids = selected.map((loc) => loc.id);
  const now = new Date().toISOString();

  const { error: assignError } = await supabase
    .from("store_locations")
    .update({ status: "ASSIGNED", updated_at: now })
    .in("id", ids);

  if (assignError) throw new Error(assignError.message);

  const rows = selected.map((loc) => ({
    store_id: loc.store_id || department.store_id,
    department_id: departmentId,
    location_id: loc.id,
    assigned_week: weekLabel,
    is_completed: false,
  }));

  const { data: rotations, error: insertError } = await supabase
    .from("weekly_rotations")
    .upsert(rows, { onConflict: "location_id,assigned_week" })
    .select("*");

  if (insertError) {
    throw new Error(
      `Weekly rotation upsert failed: ${insertError.message}`
    );
  }

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
    weekly_bay_target: dbTarget,
  };
}

/**
 * Manually add specific bays to this week's rotation.
 * Increments manual_priority_count so future adaptive draws favor them.
 */
export async function assignLocationsToCurrentWeek(
  supabase: SupabaseClient,
  departmentId: string,
  locationIds: string[],
  weekLabel: string = isoWeekLabel()
): Promise<{
  assigned_week: string;
  rotations: WeeklyRotation[];
  locations: StoreLocation[];
}> {
  const ids = [...new Set(locationIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new Error("location_ids are required");
  }

  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("id, store_id, is_active")
    .eq("id", departmentId)
    .maybeSingle();

  if (departmentError) throw new Error(departmentError.message);
  if (!department?.store_id) {
    throw new Error("Department is missing store_id");
  }
  if (department.is_active === false) {
    throw new Error("Department is paused — activate it before assigning bays");
  }

  const { data: locs, error: locError } = await supabase
    .from("store_locations")
    .select("*")
    .eq("department_id", departmentId)
    .in("id", ids);

  if (locError) throw new Error(locError.message);
  const locations = (locs ?? []) as StoreLocation[];
  if (locations.length !== ids.length) {
    throw new Error("One or more locations were not found in this department");
  }

  const showroom = locations.filter(
    (l) => (l.location_type ?? "STANDARD") === "SHOWROOM_STACKOUT"
  );
  if (showroom.length > 0) {
    throw new Error(
      "Showroom / stack-out bays use Quick Touch — not weekly aisle assignment"
    );
  }

  const now = new Date().toISOString();

  for (const loc of locations) {
    const nextCount = Math.max(0, Number(loc.manual_priority_count) || 0) + 1;
    const { error: bumpError } = await supabase
      .from("store_locations")
      .update({
        status: "ASSIGNED",
        manual_priority_count: nextCount,
        updated_at: now,
      })
      .eq("id", loc.id);
    if (bumpError) throw new Error(bumpError.message);
  }

  const rows = locations.map((loc) => ({
    store_id: loc.store_id || department.store_id,
    department_id: departmentId,
    location_id: loc.id,
    assigned_week: weekLabel,
    is_completed: false,
  }));

  const { data: rotations, error: insertError } = await supabase
    .from("weekly_rotations")
    .upsert(rows, { onConflict: "location_id,assigned_week" })
    .select("*");

  if (insertError) {
    throw new Error(`Weekly rotation upsert failed: ${insertError.message}`);
  }

  const { data: refreshed, error: refreshError } = await supabase
    .from("store_locations")
    .select("*")
    .in("id", ids);

  if (refreshError) throw new Error(refreshError.message);

  return {
    assigned_week: weekLabel,
    rotations: (rotations ?? []) as WeeklyRotation[],
    locations: (refreshed ?? []) as StoreLocation[],
  };
}

/**
 * Record a showroom / stack-out quick touch (independent of weekly aisle draw).
 */
export async function completeShowroomTouch(
  supabase: SupabaseClient,
  locationId: string,
  expectedDepartmentId?: string | null
): Promise<StoreLocation> {
  const { data: existing, error: fetchError } = await supabase
    .from("store_locations")
    .select("*")
    .eq("id", locationId)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!existing) throw new Error("Location not found");
  if (
    expectedDepartmentId &&
    existing.department_id !== expectedDepartmentId
  ) {
    throw new Error("Location is outside your assigned department");
  }
  if ((existing.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT") {
    throw new Error("Location is not a showroom / stack-out bay");
  }

  const now = new Date().toISOString();
  const { data: location, error: locError } = await supabase
    .from("store_locations")
    .update({
      last_completed_at: now,
      updated_at: now,
      // Keep PENDING so the rapid cycle stays independent of aisle status
      status: "PENDING",
    })
    .eq("id", locationId)
    .select("*")
    .single();

  if (locError) throw new Error(locError.message);
  return location as StoreLocation;
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
  store_id?: string;
  store_number?: string;
};

/**
 * Sunday cron: for every active store, queue weekly targets per active department.
 */
export async function runWeeklyRotationForAllDepartments(
  supabase: SupabaseClient,
  weekLabel: string = isoWeekLabel()
): Promise<DepartmentCronResult[]> {
  const stores = await listActiveStores(supabase);
  const results: DepartmentCronResult[] = [];

  for (const store of stores) {
    const { data: departments, error } = await supabase
      .from("departments")
      .select("*")
      .eq("store_id", store.id)
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(error.message);

    for (const dept of (departments ?? []) as Department[]) {
      // Always re-read target from this department row (null/0 → 10)
      const target = resolveWeeklyBayTarget(dept.weekly_bay_target);
      const base: DepartmentCronResult = {
        department_id: dept.id,
        department_code: dept.code,
        department_name: dept.name,
        weekly_bay_target: target,
        ok: false,
        store_id: store.id,
        store_number: store.store_number,
      };

      try {
        const { count, error: locCountError } = await supabase
          .from("store_locations")
          .select("id", { count: "exact", head: true })
          .eq("department_id", dept.id)
          .eq("store_id", store.id)
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

        // Draw count comes from departments.weekly_bay_target inside generate
        const generated = await generateWeeklyRotations(
          supabase,
          dept.id,
          null,
          weekLabel
        );

        results.push({
          ...base,
          ok: true,
          weekly_bay_target: generated.weekly_bay_target,
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
  code: string,
  storeId?: string | null
): Promise<string | null> {
  let query = supabase.from("departments").select("id").eq("code", code);
  if (storeId) {
    query = query.eq("store_id", storeId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
