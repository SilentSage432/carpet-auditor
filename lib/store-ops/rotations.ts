/**
 * Store Operations rotation engine — cycle pick + complete.
 * Cool-down: COMPLETED locations stay out of picks until the department cycle resets.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeStoreNumber, storeNumberQueryValues } from "@/lib/store";
import type { Department, StoreLocation, WeeklyRotation } from "./types";
import { listActiveStores } from "./stores";
import { pickSundayCarryOverFirst, pickSundayVelocityPrioritized } from "./rotation";
import {
  isoWeekLabel,
  parseIsoWeekLabel,
  resolveWeeklyBayTarget,
} from "./week";
import {
  isInvalidUuidError,
  isMissingColumnError,
  isMissingRelationError,
  isNotNullViolationError,
  isOnConflictMismatch,
  isStoreDeptWeekUniqueViolation,
  isUniqueViolationError,
  readableError,
} from "./errors";
import { departmentCodesMatch } from "./department-codes";
import { evaluateSundayAutoRun } from "./sunday-schedule";

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
  skipped?: boolean;
  reason?: string;
  replaced?: number;
};

export type GenerateRotationsOptions = {
  weekLabel?: string;
  count?: number | null;
  /** Scheduled runner: do not add or replace when the ISO week already has rows. */
  skipIfExists?: boolean;
  /** Master Admin explicit replace of incomplete rows for this week. */
  forceOverwrite?: boolean;
  /** Active store identity when the caller already resolved it (cron / Force Draw). */
  store_id?: string | null;
  store_number?: string | null;
};

/** Unique key on public.weekly_rotations — one bay per ISO week. */
export const WEEKLY_ROTATIONS_ON_CONFLICT = "location_id,assigned_week" as const;
/** Present on some live schemas; stripped only when PostgREST reports the column missing. */
const OPTIONAL_WEEKLY_ROTATION_COLUMNS = [
  "store_id",
  "store_number",
  "week_number",
  "year",
] as const;

type WeeklyRotationStoreScope = {
  store_id?: string;
  store_number?: string;
};

type StoreScopeHint = {
  store_id?: string | null;
  store_number?: string | null;
};

function asStoreId(value: unknown): string | undefined {
  const id = String(value ?? "").trim();
  return id || undefined;
}

function asStoreNumber(value: unknown): string | undefined {
  const n = normalizeStoreNumber(String(value ?? ""));
  return n || undefined;
}

function locationStoreNumber(loc: StoreLocation): string | undefined {
  return asStoreNumber(loc.store_number);
}

async function resolveWeeklyRotationStoreScope(
  supabase: SupabaseClient,
  hints: StoreScopeHint[]
): Promise<WeeklyRotationStoreScope> {
  let store_id: string | undefined;
  let store_number: string | undefined;
  for (const hint of hints) {
    store_id = store_id ?? asStoreId(hint.store_id);
    store_number = store_number ?? asStoreNumber(hint.store_number);
  }

  if (store_id && !store_number) {
    const { data, error } = await supabase
      .from("stores")
      .select("id, store_number")
      .eq("id", store_id)
      .maybeSingle();
    if (error && isInvalidUuidError(error)) {
      store_number = asStoreNumber(store_id) ?? store_number;
      store_id = undefined;
    } else if (!error && data) {
      store_number = asStoreNumber(data.store_number) ?? store_number;
    }
  }

  if (store_number && !store_id) {
    const values = storeNumberQueryValues(store_number);
    if (values.length > 0) {
      const { data } = await supabase
        .from("stores")
        .select("id, store_number")
        .in("store_number", values)
        .limit(1)
        .maybeSingle();
      if (data?.id) store_id = asStoreId(data.id);
    }
  }

  if (!store_id && !store_number) {
    throw new Error(
      "Department is missing store_id and store_number — cannot stage weekly rotations"
    );
  }

  return {
    ...(store_id ? { store_id } : {}),
    ...(store_number ? { store_number } : {}),
  };
}

function schemaCacheStaleMessage(column: string): string {
  return `Schema missing or out of date: weekly_rotations.${column} exists in Postgres but is not in the PostgREST schema cache. Apply the latest Supabase migrations, then reload the API schema (Dashboard → Settings → API → Reload schema, or NOTIFY pgrst, 'reload schema').`;
}

/**
 * Merge by location_id + assigned_week when the live table has no UNIQUE
 * matching PostgREST ON CONFLICT (CREATE TABLE IF NOT EXISTS never added it).
 */
async function mergeWeeklyRotationsByLocationWeek(
  supabase: SupabaseClient,
  payload: Record<string, unknown>[]
): Promise<WeeklyRotation[]> {
  const results: WeeklyRotation[] = [];
  for (const row of payload) {
    const locationId = String(row.location_id ?? "").trim();
    const week = String(row.assigned_week ?? "").trim();
    if (!locationId || !week) {
      throw new Error("Weekly rotation upsert failed: location_id and assigned_week are required");
    }

    const existing = await supabase
      .from("weekly_rotations")
      .select("id")
      .eq("location_id", locationId)
      .eq("assigned_week", week)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existing.error) {
      throw new Error(
        readableError(existing.error, "Weekly rotation upsert failed")
      );
    }

    const existingId = String(
      (Array.isArray(existing.data) ? existing.data[0] : existing.data)?.id ??
        ""
    ).trim();
    const written = existingId
      ? await supabase
          .from("weekly_rotations")
          .update(row)
          .eq("id", existingId)
          .select("*")
          .single()
      : await supabase.from("weekly_rotations").insert(row).select("*").single();

    if (written.error || !written.data) {
      throw new Error(
        readableError(written.error, "Weekly rotation upsert failed")
      );
    }
    results.push(written.data as WeeklyRotation);
  }
  return results;
}

/**
 * Persist weekly rotation rows. Sends store_id, store_number, week_number, and
 * year when known. week_number / year are parsed from assigned_week (e.g.
 * 2026-W34 → 34 / 2026) so NOT NULL week_number is never sent as null.
 * Strips a column only when PostgREST reports it missing.
 * onConflict matches UNIQUE(location_id, assigned_week).
 */
type UpsertWeeklyRotationsOptions = {
  /** After a staged-week clear, prefer insert to avoid stale ON CONFLICT targets. */
  insertAfterClear?: boolean;
};

async function deleteWeeklyRotationConflicts(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<void> {
  const locationId = String(row.location_id ?? "").trim();
  const week = String(row.assigned_week ?? "").trim();
  if (locationId && week) {
    const { error } = await supabase
      .from("weekly_rotations")
      .delete()
      .eq("location_id", locationId)
      .eq("assigned_week", week);
    if (error) throw new Error(readableError(error, "Weekly rotation clear failed"));
  }

  const storeNumber = asStoreNumber(row.store_number);
  const departmentId = String(row.department_id ?? "").trim();
  const weekNumber = row.week_number;
  if (
    storeNumber &&
    departmentId &&
    weekNumber != null &&
    Number.isFinite(Number(weekNumber))
  ) {
    const { error } = await supabase
      .from("weekly_rotations")
      .delete()
      .eq("store_number", storeNumber)
      .eq("department_id", departmentId)
      .eq("week_number", Number(weekNumber));
    if (error && !isMissingColumnError(error, "week_number")) {
      throw new Error(readableError(error, "Weekly rotation clear failed"));
    }
  }
}

async function upsertWeeklyRotations(
  supabase: SupabaseClient,
  rows: Array<{
    department_id: string;
    location_id: string;
    assigned_week: string;
    is_completed: boolean;
    store_id?: string;
    store_number?: string;
  }>,
  options: UpsertWeeklyRotationsOptions = {}
): Promise<WeeklyRotation[]> {
  let payload: Record<string, unknown>[] = rows.map((row) => {
    const { year, week } = parseIsoWeekLabel(row.assigned_week);
    const next: Record<string, unknown> = {
      department_id: row.department_id,
      location_id: row.location_id,
      assigned_week: row.assigned_week,
      week_number: week,
      year,
      is_completed: row.is_completed,
    };
    if (row.store_id) next.store_id = row.store_id;
    if (row.store_number) next.store_number = row.store_number;
    return next;
  });

  const stripped = new Set<string>();
  const maxAttempts = OPTIONAL_WEEKLY_ROTATION_COLUMNS.length + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const write = options.insertAfterClear
      ? supabase.from("weekly_rotations").insert(payload).select("*")
      : supabase
          .from("weekly_rotations")
          .upsert(payload, { onConflict: WEEKLY_ROTATIONS_ON_CONFLICT })
          .select("*");

    const { data, error } = await write;

    if (!error) {
      return (data ?? []) as WeeklyRotation[];
    }

    lastError = error;

    if (
      isUniqueViolationError(error) &&
      (options.insertAfterClear || isStoreDeptWeekUniqueViolation(error))
    ) {
      for (const row of payload) {
        await deleteWeeklyRotationConflicts(supabase, row);
      }
      const retry = await supabase
        .from("weekly_rotations")
        .insert(payload)
        .select("*");
      if (!retry.error) {
        return (retry.data ?? []) as WeeklyRotation[];
      }
      lastError = retry.error;
      if (isStoreDeptWeekUniqueViolation(retry.error)) {
        throw new Error(
          "Database has a mistaken UNIQUE(store_number, department_id, week_number) on weekly_rotations — apply migration 20260818_drop_weekly_rotations_store_dept_week_uniq.sql, then reload the PostgREST schema."
        );
      }
    }

    const missing = OPTIONAL_WEEKLY_ROTATION_COLUMNS.find(
      (col) =>
        isMissingColumnError(error, col) &&
        payload.some((row) => Object.prototype.hasOwnProperty.call(row, col))
    );
    if (missing) {
      stripped.add(missing);
      payload = payload.map((row) => {
        const next = { ...row };
        delete next[missing];
        return next;
      });
      continue;
    }

    const stale = OPTIONAL_WEEKLY_ROTATION_COLUMNS.find(
      (col) => stripped.has(col) && isNotNullViolationError(error, col)
    );
    if (stale) {
      throw new Error(schemaCacheStaleMessage(stale));
    }

    if (isOnConflictMismatch(error)) {
      return mergeWeeklyRotationsByLocationWeek(supabase, payload);
    }
    break;
  }

  throw new Error(readableError(lastError, "Weekly rotation upsert failed"));
}

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

export async function countWeekRotations(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string
): Promise<number> {
  const { count, error } = await supabase
    .from("weekly_rotations")
    .select("id", { count: "exact", head: true })
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type ResetStagedWeekOptions = {
  store_number?: string | null;
  /** When false (Force Draw), completed bays stay. Admin reset clears all staged rows. */
  includeCompleted?: boolean;
};

export type ResetStagedWeekResult = {
  deleted_rotations: number;
  deleted_assignments: number;
  reset_locations: number;
  rotation_ids: string[];
};

/**
 * Remove staged weekly_rotations for a department + ISO week.
 * Clears sunday_bay_assignments and returns affected bays to PENDING.
 */
export async function resetStagedWeekRotations(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string,
  options: ResetStagedWeekOptions = {}
): Promise<ResetStagedWeekResult> {
  let query = supabase
    .from("weekly_rotations")
    .select("id, location_id")
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel);

  const storeNumber = asStoreNumber(options.store_number);
  if (storeNumber) {
    query = query.eq("store_number", storeNumber);
  }
  if (options.includeCompleted !== true) {
    query = query.eq("is_completed", false);
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  if (!rows?.length) {
    return {
      deleted_rotations: 0,
      deleted_assignments: 0,
      reset_locations: 0,
      rotation_ids: [],
    };
  }

  const rotationIds = rows.map((row) => String(row.id));
  const locationIds = [
    ...new Set(rows.map((row) => String(row.location_id)).filter(Boolean)),
  ];

  let deletedAssignments = 0;
  const { count: assignmentCount, error: countError } = await supabase
    .from("sunday_bay_assignments")
    .select("id", { count: "exact", head: true })
    .in("bay_id", rotationIds);
  if (!countError) {
    deletedAssignments = assignmentCount ?? 0;
  }

  const { error: assignError } = await supabase
    .from("sunday_bay_assignments")
    .delete()
    .in("bay_id", rotationIds);
  if (
    assignError &&
    !isMissingRelationError(assignError) &&
    !isMissingColumnError(assignError, "bay_id")
  ) {
    throw new Error(assignError.message);
  }

  const { error: deleteError } = await supabase
    .from("weekly_rotations")
    .delete()
    .in("id", rotationIds);
  if (deleteError) throw new Error(deleteError.message);

  if (locationIds.length > 0) {
    const now = new Date().toISOString();
    const { error: resetError } = await supabase
      .from("store_locations")
      .update({ status: "PENDING", updated_at: now })
      .in("id", locationIds);
    if (resetError) throw new Error(resetError.message);
  }

  return {
    deleted_rotations: rows.length,
    deleted_assignments: deletedAssignments,
    reset_locations: locationIds.length,
    rotation_ids: rotationIds,
  };
}

/**
 * Drop incomplete rows for this ISO week so Master Admin can restage.
 * Completed bays stay. Matching sunday_bay_assignments are cleared.
 */
export async function replaceIncompleteWeekRotations(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string,
  storeNumber?: string | null
): Promise<number> {
  const result = await resetStagedWeekRotations(
    supabase,
    departmentId,
    weekLabel,
    { store_number: storeNumber, includeCompleted: false }
  );
  return result.deleted_rotations;
}

export async function generateWeeklyRotations(
  supabase: SupabaseClient,
  departmentId: string,
  count?: number | null,
  weekLabel: string = isoWeekLabel(),
  options: Omit<GenerateRotationsOptions, "weekLabel" | "count"> = {}
): Promise<GenerateRotationsResult> {
  const existingCount = await countWeekRotations(
    supabase,
    departmentId,
    weekLabel
  );

  if (options.skipIfExists && existingCount > 0) {
    return {
      assigned_week: weekLabel,
      cycle_number: 0,
      cycle_reset: false,
      rotations: [],
      locations: [],
      weekly_bay_target: 0,
      skipped: true,
      reason: `Already staged for ${weekLabel} — scheduled runner will not overwrite`,
    };
  }

  let replaced = 0;
  let clearedForInsert = false;
  if (options.forceOverwrite && existingCount > 0) {
    replaced = await replaceIncompleteWeekRotations(
      supabase,
      departmentId,
      weekLabel,
      options.store_number
    );
    clearedForInsert = replaced > 0;
  } else if (!options.forceOverwrite && existingCount > 0) {
    return {
      assigned_week: weekLabel,
      cycle_number: 0,
      cycle_reset: false,
      rotations: [],
      locations: [],
      weekly_bay_target: 0,
      skipped: true,
      reason: `Already staged for ${weekLabel} — Master Admin Force Draw is required to replace`,
    };
  }

  await reclaimStaleAssignments(supabase, departmentId, weekLabel);

  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("*")
    .eq("id", departmentId)
    .maybeSingle();

  if (departmentError) throw new Error(departmentError.message);
  if (!department) {
    throw new Error("Department not found");
  }

  const storeScope = await resolveWeeklyRotationStoreScope(supabase, [
    { store_id: options.store_id, store_number: options.store_number },
    {
      store_id: department.store_id,
      store_number: department.store_number,
    },
  ]);

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

  const carried = await loadCarryOverPriorityPool(supabase, departmentId);

  const generated = await finishGenerate(
    supabase,
    departmentId,
    storeScope,
    weekLabel,
    drawCount,
    dbTarget,
    cycleNumber,
    reset,
    pending,
    carried,
    { insertAfterClear: clearedForInsert || options.forceOverwrite === true }
  );

  return replaced > 0 ? { ...generated, replaced } : generated;
}

async function loadCarryOverPriorityPool(
  supabase: SupabaseClient,
  departmentId: string
): Promise<StoreLocation[]> {
  const base = () =>
    supabase
      .from("store_locations")
      .select("*")
      .eq("department_id", departmentId)
      .eq("is_active", true);

  const withType = await base()
    .or("status.eq.CARRIED_OVER,carried_over.eq.true,priority_override.eq.true")
    .neq("location_type", "SHOWROOM_STACKOUT");

  if (!withType.error) {
    return (withType.data ?? []) as StoreLocation[];
  }

  if (isMissingColumnError(withType.error, "carried_over")) {
    const pins = await base()
      .or("status.eq.CARRIED_OVER,priority_override.eq.true")
      .neq("location_type", "SHOWROOM_STACKOUT");
    if (!pins.error) return (pins.data ?? []) as StoreLocation[];
    if (/location_type/i.test(pins.error.message)) {
      const legacy = await base().eq("status", "CARRIED_OVER");
      if (legacy.error) throw new Error(legacy.error.message);
      return (legacy.data ?? []) as StoreLocation[];
    }
  }

  if (/location_type/i.test(withType.error.message)) {
    const legacy = await base().eq("status", "CARRIED_OVER");
    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []) as StoreLocation[];
  }

  throw new Error(withType.error.message);
}

async function clearCarryOverFlags(
  supabase: SupabaseClient,
  locationIds: string[],
  extra: Record<string, unknown> = {}
): Promise<void> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("store_locations")
    .update({ carried_over: false, updated_at: now, ...extra })
    .in("id", ids);
  if (error && !isMissingColumnError(error, "carried_over")) {
    throw new Error(error.message);
  }
  if (error && isMissingColumnError(error, "carried_over") && Object.keys(extra).length > 0) {
    const retry = await supabase
      .from("store_locations")
      .update({ updated_at: now, ...extra })
      .in("id", ids);
    if (retry.error) throw new Error(retry.error.message);
  }
}

async function finishGenerate(
  supabase: SupabaseClient,
  departmentId: string,
  storeScope: WeeklyRotationStoreScope,
  weekLabel: string,
  drawCount: number,
  dbTarget: number,
  cycleNumber: number,
  reset: boolean,
  pending: StoreLocation[],
  carried: StoreLocation[],
  upsertOptions: UpsertWeeklyRotationsOptions = {}
): Promise<GenerateRotationsResult> {
  const pool: StoreLocation[] = [];

  const carriedPick = pickSundayCarryOverFirst(
    carried.filter(isStandardAisleLocation),
    drawCount
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
  await clearCarryOverFlags(supabase, ids);

  const rows = selected.map((loc) => ({
    ...storeScope,
    store_id: loc.store_id || storeScope.store_id,
    store_number: locationStoreNumber(loc) || storeScope.store_number,
    department_id: departmentId,
    location_id: loc.id,
    assigned_week: weekLabel,
    is_completed: false,
  }));

  const rotations = await upsertWeeklyRotations(supabase, rows, upsertOptions);

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
  weekLabel: string = isoWeekLabel(),
  storeHint?: StoreScopeHint
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
    .select("*")
    .eq("id", departmentId)
    .maybeSingle();

  if (departmentError) throw new Error(departmentError.message);
  if (!department) {
    throw new Error("Department not found");
  }
  if (department.is_active === false) {
    throw new Error("Department is paused — activate it before assigning bays");
  }

  const storeScope = await resolveWeeklyRotationStoreScope(supabase, [
    storeHint ?? {},
    {
      store_id: department.store_id,
      store_number: department.store_number,
    },
  ]);

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
  await clearCarryOverFlags(supabase, ids);

  const rows = locations.map((loc) => ({
    ...storeScope,
    store_id: loc.store_id || storeScope.store_id,
    store_number: locationStoreNumber(loc) || storeScope.store_number,
    department_id: departmentId,
    location_id: loc.id,
    assigned_week: weekLabel,
    is_completed: false,
  }));

  const rotations = await upsertWeeklyRotations(supabase, rows);

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
 * Sunday cron: for every active store whose schedule window is open, queue
 * weekly targets per active department. Never overwrites an already-staged week.
 */
export async function runWeeklyRotationForAllDepartments(
  supabase: SupabaseClient,
  weekLabel?: string,
  now: Date = new Date()
): Promise<DepartmentCronResult[]> {
  const stores = await listActiveStores(supabase);
  const results: DepartmentCronResult[] = [];

  for (const store of stores) {
    const decision = evaluateSundayAutoRun(store, now);
    const targetWeek = weekLabel ?? decision.weekLabel;

    if (!decision.run) {
      results.push({
        department_id: store.id,
        department_code: "_schedule",
        department_name: store.name || `Store ${store.store_number}`,
        weekly_bay_target: 0,
        ok: true,
        skipped: true,
        reason: decision.reason,
        assigned_week: targetWeek,
        store_id: store.id,
        store_number: store.store_number,
      });
      continue;
    }

    const { data: departments, error } = await supabase
      .from("departments")
      .select("*")
      .eq("store_id", store.id)
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(error.message);

    for (const dept of (departments ?? []) as Department[]) {
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
            assigned_week: targetWeek,
          });
          continue;
        }

        const generated = await generateWeeklyRotations(
          supabase,
          dept.id,
          null,
          targetWeek,
          {
            skipIfExists: true,
            store_id: store.id,
            store_number: store.store_number,
          }
        );

        results.push({
          ...base,
          ok: true,
          skipped: generated.skipped,
          reason: generated.reason,
          weekly_bay_target: generated.weekly_bay_target || target,
          created: generated.skipped ? 0 : generated.rotations.length,
          cycle_number: generated.cycle_number,
          cycle_reset: generated.cycle_reset,
          assigned_week: generated.assigned_week,
        });
      } catch (err) {
        results.push({
          ...base,
          ok: false,
          reason: err instanceof Error ? err.message : "Unknown error",
          assigned_week: targetWeek,
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

  let { data: location, error: locError } = await supabase
    .from("store_locations")
    .update({
      status: "COMPLETED",
      last_completed_at: now,
      carried_over: false,
      updated_at: now,
    })
    .eq("id", rotation.location_id)
    .select("*")
    .single();

  if (locError && isMissingColumnError(locError, "carried_over")) {
    const retry = await supabase
      .from("store_locations")
      .update({
        status: "COMPLETED",
        last_completed_at: now,
        updated_at: now,
      })
      .eq("id", rotation.location_id)
      .select("*")
      .single();
    location = retry.data;
    locError = retry.error;
  }

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
  if (data?.id) return data.id;

  let list = supabase.from("departments").select("id, code");
  if (storeId) list = list.eq("store_id", storeId);
  const { data: rows, error: listError } = await list;
  if (listError) throw new Error(listError.message);
  const match = (rows ?? []).find((row) =>
    departmentCodesMatch(String(row.code ?? ""), code)
  );
  return match?.id ? String(match.id) : null;
}
