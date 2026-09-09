/**
 * Barrier / exception logging + the derived department-week verification summary.
 * Incomplete bays become CARRIED_OVER and are prioritized next week.
 *
 * Authority boundary (Art. VI.2):
 * This module MUST NOT create bay-level verification. It records barriers and
 * composes a read-only summary. `VERIFIED_COMPLETE` and
 * `store_locations.status = COMPLETED` are owned exclusively by
 * `rotation-review.ts` (`verifyPendingRotation` / `verifyAllPendingRotations`),
 * reachable only behind an explicit supervisor/admin `review_action`.
 *
 * Department-week verification is DERIVED from the week's active
 * `weekly_rotations` and is never persisted onto `departments` — those columns
 * do not exist in production and must not be added (RUNTIME-COMPAT-001).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExceptionReason,
  RotationException,
  WeeklyRotationWithLocation,
} from "./types";
import { isRotationVerifiedComplete } from "./rotation-metrics";
import { isoWeekLabel } from "./week";

export const EXCEPTION_REASONS: ExceptionReason[] = [
  "Blocked Bay",
  "Unpalletized Top-Stock",
  "Missing SIMS Tags",
  "Freight/Pallets In Aisle",
  "Short Staffed",
  "High Customer Volume",
  "Other",
];

/** One-tap floor barriers — first-class reasons for Zebra / verify chips. */
export const QUICK_BARRIER_REASONS: ExceptionReason[] = [
  "Blocked Bay",
  "Unpalletized Top-Stock",
  "Missing SIMS Tags",
];

export type ReportBarrierInput = {
  departmentId: string;
  assignedWeek: string;
  incomplete: Array<{
    rotationId: string;
    locationId: string;
    reason: ExceptionReason | string;
    cycleNumber: number;
  }>;
  reportedBy?: string | null;
  /** Mid-week floor reports default to carrying the bay over. */
  markCarriedOver?: boolean;
};

export type ReportBarrierResult = {
  assigned_week: string;
  exception_count: number;
  exceptions: RotationException[];
};

/**
 * Mid-week barrier log. Records why a bay could not be finished; it never
 * completes, verifies, or closes anything.
 */
export async function reportRotationBarriers(
  supabase: SupabaseClient,
  input: ReportBarrierInput
): Promise<ReportBarrierResult> {
  const week = input.assignedWeek || isoWeekLabel();
  const barriers = await insertRotationBarriers(supabase, {
    ...input,
    assignedWeek: week,
    markCarriedOver: input.markCarriedOver !== false,
  });
  return {
    assigned_week: week,
    exception_count: barriers.exceptions.length,
    exceptions: barriers.exceptions,
  };
}

/**
 * Persist barriers in production's normalized shape.
 *
 * The barrier points at the rotation it interrupted and the physical location
 * it happened to; week and cycle are reachable through `rotation_id` and are
 * deliberately NOT copied onto the row.
 *
 * Ordering is evidence-first: the exception rows are written before the
 * location's scheduling flags. If the second write fails the caller sees the
 * error while the historical barrier survives, which is the safer of the two
 * partial states — re-reporting converges the location without losing evidence.
 */
async function insertRotationBarriers(
  supabase: SupabaseClient,
  input: ReportBarrierInput
): Promise<{ exceptions: RotationException[] }> {
  const now = new Date().toISOString();
  const reportable = input.incomplete.filter((item) => item.locationId);
  const exceptionRows = reportable.map((item) => ({
    rotation_id: item.rotationId || null,
    department_id: input.departmentId,
    location_id: item.locationId,
    reason: item.reason.trim() || "Other",
    logged_by: input.reportedBy ?? null,
  }));

  if (exceptionRows.length === 0) {
    return { exceptions: [] };
  }

  const { data, error } = await supabase
    .from("rotation_exceptions")
    .insert(exceptionRows)
    .select("*");
  if (error) throw new Error(error.message);
  const exceptions = (data ?? []) as RotationException[];

  if (input.markCarriedOver !== false) {
    // One statement, so the partial-failure window is a single write rather
    // than one per bay. `carried_over` is the next-draw prepend flag and
    // `last_carried_over_at` is the badge window — both already in production.
    const { error: locError } = await supabase
      .from("store_locations")
      .update({
        status: "CARRIED_OVER",
        carried_over: true,
        last_carried_over_at: now,
        updated_at: now,
      })
      .in(
        "id",
        reportable.map((item) => item.locationId)
      );
    if (locError) throw new Error(locError.message);
  }

  return { exceptions };
}

export type ExceptionWithLocation = RotationException & {
  /** Derived week — barriers carry no week of their own. */
  weekly_rotations: { assigned_week: string | null } | null;
  store_locations: {
    id: string;
    aisle: string;
    bay: number;
    type?: string | null;
  } | null;
  departments: {
    id: string;
    name: string;
    code: string;
  } | null;
};

/**
 * Barrier history for the Exception Log.
 *
 * Both callers scope by week, and `rotation_exceptions` carries no week of its
 * own, so the week is resolved relationally through
 * `rotation_id → weekly_rotations.assigned_week`. The inner join is applied
 * only when a week is requested, so an unscoped read still returns barriers
 * whose rotation has since been removed.
 *
 * A query error is no longer swallowed. Reading a column that does not exist
 * used to surface as "no barriers this week", which is indistinguishable from a
 * clean week and is exactly how a broken writer stayed invisible.
 */
export async function listRotationExceptions(
  supabase: SupabaseClient,
  opts?: { assignedWeek?: string; departmentId?: string; limit?: number }
): Promise<ExceptionWithLocation[]> {
  const weekJoin = opts?.assignedWeek
    ? "weekly_rotations!inner(assigned_week)"
    : "weekly_rotations(assigned_week)";

  let query = supabase
    .from("rotation_exceptions")
    .select(
      `*, ${weekJoin}, store_locations(id, aisle, bay, type), departments(id, name, code)`
    )
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (opts?.assignedWeek) {
    query = query.eq("weekly_rotations.assigned_week", opts.assignedWeek);
  }
  if (opts?.departmentId) {
    query = query.eq("department_id", opts.departmentId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ExceptionWithLocation[];
}

export type DepartmentVerificationSummary = {
  department_id: string;
  department_name: string;
  department_code: string;
  weekly_bay_target: number;
  /** Derived, not stored: this week's label once every active bay is verified. */
  last_verified_week: string | null;
  /** Derived: newest `weekly_rotations.verified_at` in the week. */
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

      // Barriers hang off the rotation, not the week, so the week's rotations
      // are the join key. No rotations means no barriers, and no query.
      const rotationIds = rotations.map((r) => r.id).filter(Boolean);
      let exceptionCount = 0;
      if (rotationIds.length > 0) {
        const { count, error: exError } = await supabase
          .from("rotation_exceptions")
          .select("id", { count: "exact", head: true })
          .eq("department_id", dept.id)
          .in("rotation_id", rotationIds);
        if (exError) throw new Error(exError.message);
        exceptionCount = count ?? 0;
      }

      const total = rotations.length;
      const incomplete = rotations.filter((r) => !r.is_completed).length;

      // Department-week verification is derived, never stamped. The week counts
      // as verified only when every active rotation carries a real DS
      // verification — `is_completed` alone is a report, not a verification.
      const verified = rotations.filter(isRotationVerifiedComplete);
      const verifiedThisWeek = total > 0 && verified.length === total;
      const lastVerifiedAt = verified.reduce<string | null>((latest, row) => {
        const at = row.verified_at;
        if (!at) return latest;
        return latest && latest >= at ? latest : at;
      }, null);

      summaries.push({
        department_id: dept.id,
        department_name: dept.name,
        department_code: dept.code,
        weekly_bay_target: dept.weekly_bay_target ?? 10,
        last_verified_week: verifiedThisWeek ? weekLabel : null,
        last_verified_at: lastVerifiedAt,
        verified_this_week: verifiedThisWeek,
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
  verification_status?: string | null;
  verified_at?: string | null;
  cycle_number?: number | null;
};

/** Review columns are required for the derived summary; cycle_number is not. */
const WEEK_ROTATION_REVIEW_COLUMNS =
  "id, department_id, is_completed, completed_at, verification_status, verified_at";

/** Prefer full column set; fall back if optional columns (e.g. cycle_number) are absent. */
async function fetchWeekRotationsForDepartment(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string
): Promise<WeekRotationRow[]> {
  const primary = await supabase
    .from("weekly_rotations")
    .select(`${WEEK_ROTATION_REVIEW_COLUMNS}, cycle_number`)
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel)
    .is("superseded_at", null);

  if (!primary.error) {
    return (primary.data ?? []) as WeekRotationRow[];
  }

  const fallback = await supabase
    .from("weekly_rotations")
    .select(WEEK_ROTATION_REVIEW_COLUMNS)
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel)
    .is("superseded_at", null);

  if (!fallback.error) {
    return (fallback.data ?? []) as WeekRotationRow[];
  }

  // Pre-migration: no superseded_at column
  if (/superseded_at/i.test(primary.error.message + (fallback.error?.message ?? ""))) {
    const legacy = await supabase
      .from("weekly_rotations")
      .select(WEEK_ROTATION_REVIEW_COLUMNS)
      .eq("department_id", departmentId)
      .eq("assigned_week", weekLabel);
    if (!legacy.error) {
      return (legacy.data ?? []) as WeekRotationRow[];
    }
  }

  return [];
}

export function rotationLocationId(
  rotation: WeeklyRotationWithLocation
): string | null {
  return rotation.location_id || rotation.store_locations?.id || null;
}
