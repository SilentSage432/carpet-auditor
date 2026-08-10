/**
 * End-of-week verification + exception logging.
 * Incomplete bays become CARRIED_OVER and are prioritized next week.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExceptionReason,
  RotationException,
  WeeklyRotationWithLocation,
} from "./types";
import { isoWeekLabel } from "./week";

export const EXCEPTION_REASONS: ExceptionReason[] = [
  "Freight/Pallets In Aisle",
  "Short Staffed",
  "High Customer Volume",
  "Other",
];

export type VerifySubmitInput = {
  departmentId: string;
  assignedWeek: string;
  /** Rotation IDs confirmed complete */
  completedRotationIds: string[];
  /** Incomplete reports */
  incomplete: Array<{
    rotationId: string;
    locationId: string;
    reason: ExceptionReason | string;
    cycleNumber: number;
  }>;
  reportedBy?: string | null;
};

export type VerifySubmitResult = {
  assigned_week: string;
  completed_count: number;
  exception_count: number;
  exceptions: RotationException[];
};

export async function verifyWeeklyRotations(
  supabase: SupabaseClient,
  input: VerifySubmitInput
): Promise<VerifySubmitResult> {
  const week = input.assignedWeek || isoWeekLabel();
  const now = new Date().toISOString();
  let completedCount = 0;

  for (const rotationId of input.completedRotationIds) {
    const { data: rotation, error: fetchError } = await supabase
      .from("weekly_rotations")
      .select("*")
      .eq("id", rotationId)
      .eq("department_id", input.departmentId)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!rotation) continue;

    if (!rotation.is_completed) {
      const { error: rotError } = await supabase
        .from("weekly_rotations")
        .update({ is_completed: true, completed_at: now })
        .eq("id", rotationId);
      if (rotError) throw new Error(rotError.message);
    }

    const { error: locError } = await supabase
      .from("store_locations")
      .update({
        status: "COMPLETED",
        last_completed_at: now,
        updated_at: now,
      })
      .eq("id", rotation.location_id);
    if (locError) throw new Error(locError.message);
    completedCount += 1;
  }

  const exceptionRows = input.incomplete.map((item) => ({
    department_id: input.departmentId,
    bay_id: item.locationId,
    reason: item.reason.trim() || "Other",
    cycle_number: item.cycleNumber || 1,
    assigned_week: week,
    reported_by: input.reportedBy ?? null,
  }));

  let exceptions: RotationException[] = [];
  if (exceptionRows.length > 0) {
    const { data, error } = await supabase
      .from("rotation_exceptions")
      .insert(exceptionRows)
      .select("*");
    if (error) throw new Error(error.message);
    exceptions = (data ?? []) as RotationException[];

    for (const item of input.incomplete) {
      const { error: locError } = await supabase
        .from("store_locations")
        .update({
          status: "CARRIED_OVER",
          updated_at: now,
        })
        .eq("id", item.locationId);
      if (locError) throw new Error(locError.message);

      // Leave weekly_rotations.is_completed = false for incomplete reports
    }
  }

  const { error: deptError } = await supabase
    .from("departments")
    .update({
      last_verified_week: week,
      last_verified_at: now,
    })
    .eq("id", input.departmentId);
  if (deptError) throw new Error(deptError.message);

  return {
    assigned_week: week,
    completed_count: completedCount,
    exception_count: exceptions.length,
    exceptions,
  };
}

export type ExceptionWithLocation = RotationException & {
  store_locations: {
    id: string;
    aisle: number;
    bay: number;
  } | null;
  departments: {
    id: string;
    name: string;
    code: string;
  } | null;
};

export async function listRotationExceptions(
  supabase: SupabaseClient,
  opts?: { assignedWeek?: string; departmentId?: string; limit?: number }
): Promise<ExceptionWithLocation[]> {
  let query = supabase
    .from("rotation_exceptions")
    .select("*, store_locations(id, aisle, bay), departments(id, name, code)")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (opts?.assignedWeek) {
    query = query.eq("assigned_week", opts.assignedWeek);
  }
  if (opts?.departmentId) {
    query = query.eq("department_id", opts.departmentId);
  }

  const { data, error } = await query;
  if (error) {
    // Empty week / missing log table → treat as no exceptions yet
    const msg = error.message ?? "";
    if (
      error.code === "PGRST116" ||
      /0 rows|does not exist|could not find/i.test(msg)
    ) {
      return [];
    }
    throw new Error(msg);
  }
  return (data ?? []) as ExceptionWithLocation[];
}

export type DepartmentVerificationSummary = {
  department_id: string;
  department_name: string;
  department_code: string;
  weekly_bay_target: number;
  last_verified_week: string | null;
  last_verified_at: string | null;
  verified_this_week: boolean;
  exception_count: number;
  incomplete_rotations: number;
  total_rotations: number;
};

export async function buildVerificationSummary(
  supabase: SupabaseClient,
  weekLabel: string = isoWeekLabel()
): Promise<DepartmentVerificationSummary[]> {
  try {
    const { data: departments, error: deptError } = await supabase
      .from("departments")
      .select("*")
      .eq("is_active", true)
      .order("name");
    if (deptError) {
      // No departments yet → empty summary (0/0 verified)
      return [];
    }

    const summaries: DepartmentVerificationSummary[] = [];

    for (const dept of departments ?? []) {
      const rotations = await fetchWeekRotationsForDepartment(
        supabase,
        dept.id,
        weekLabel
      );

      let exceptionCount = 0;
      try {
        const { count, error: exError } = await supabase
          .from("rotation_exceptions")
          .select("id", { count: "exact", head: true })
          .eq("department_id", dept.id)
          .eq("assigned_week", weekLabel);
        if (!exError) exceptionCount = count ?? 0;
      } catch {
        exceptionCount = 0;
      }

      const total = rotations.length;
      const incomplete = rotations.filter((r) => !r.is_completed).length;

      summaries.push({
        department_id: dept.id,
        department_name: dept.name,
        department_code: dept.code,
        weekly_bay_target: dept.weekly_bay_target ?? 10,
        last_verified_week: dept.last_verified_week ?? null,
        last_verified_at: dept.last_verified_at ?? null,
        verified_this_week: dept.last_verified_week === weekLabel,
        exception_count: exceptionCount,
        incomplete_rotations: incomplete,
        total_rotations: total,
      });
    }

    return summaries;
  } catch {
    return [];
  }
}

type WeekRotationRow = {
  id: string;
  department_id: string;
  is_completed: boolean;
  completed_at: string | null;
  cycle_number?: number | null;
};

/** Prefer full column set; fall back if optional columns (e.g. cycle_number) are absent. */
async function fetchWeekRotationsForDepartment(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string
): Promise<WeekRotationRow[]> {
  const primary = await supabase
    .from("weekly_rotations")
    .select("id, department_id, cycle_number, is_completed, completed_at")
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel);

  if (!primary.error) {
    return (primary.data ?? []) as WeekRotationRow[];
  }

  const fallback = await supabase
    .from("weekly_rotations")
    .select("id, department_id, is_completed, completed_at")
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel);

  if (fallback.error) {
    return [];
  }
  return (fallback.data ?? []) as WeekRotationRow[];
}

export function rotationLocationId(
  rotation: WeeklyRotationWithLocation
): string | null {
  return rotation.location_id || rotation.store_locations?.id || null;
}
