/**
 * DEPTSYNC-SECTION-ROTATION-005 — operator-approved weekly bay capacity.
 *
 * Owns: schedule fingerprints, approval validation, approved-capacity composition
 * for store-week shared targets, and the approval RPC boundary.
 *
 * Does not: invent day/hour→bay formulas, mutate Operational Sections,
 * activate Sunday auto-stage, or bypass the capacity assignment RPC.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storeNumberQueryValues } from "@/lib/store";
import {
  composeWeekLaborAvailability,
  type WeekLaborMemberInput,
} from "@/lib/store-ops/labor-availability";
import {
  BASE_WEEKLY_BAY_QUOTA,
  type CapacityAssignmentRow,
  type StoreWeekCapacitySnapshot,
  composeStoreWeekCapacity,
  loadProfileRosterLinks,
  loadStoreWeekAssignments,
} from "@/lib/store-ops/shared-week-capacity";
import {
  isoWeekCalendarRange,
  isoWeekToMondayDate,
} from "@/lib/store-ops/week";

export { BASE_WEEKLY_BAY_QUOTA };

/** Hard product ceiling — approved capacity never exceeds this. */
export const MAX_APPROVED_WEEKLY_BAY_CAPACITY = 3 as const;

/** Sunday section-aware auto-stage remains hard-off (ROTATION-002). */
export const SECTION_AWARE_ROTATION_AUTO_STAGE_STILL_OFF = false as const;

export const UPSERT_WEEK_CAPACITY_APPROVALS_RPC =
  "upsert_store_week_capacity_approvals" as const;

export type ApprovedCapacityValue = 0 | 1 | 2 | 3;

export type ShiftDayFingerprintInput = {
  work_date: string;
  start_time?: string | null;
  end_time?: string | null;
  is_scheduled_today?: boolean | null;
  is_call_out?: boolean | null;
  status?: string | null;
};

export type CapacityApprovalRow = {
  store_number: string;
  week_label: string;
  week_starting: string;
  specialist_id: string;
  approved_capacity: number;
  schedule_fingerprint: string;
  approved_by_specialist_id: string;
  approved_at: string;
};

export type CapacityApprovalDraft = {
  specialist_id: string;
  specialist_name: string;
  scheduled_department_days: number;
  known_available_hours: number;
  eligible: boolean;
  suggested_capacity: ApprovedCapacityValue;
  proposed_capacity: ApprovedCapacityValue;
  approved_capacity: number | null;
  approval_status: "missing" | "approved" | "stale" | "ineligible";
  schedule_fingerprint: string;
  owned_count: number;
  approved_at?: string | null;
  approved_by_specialist_id?: string | null;
};

export type WeekCapacityReviewBoard = {
  store_number: string;
  week_label: string;
  week_starting: string;
  shared_target_approved: number;
  shared_target_proposed: number;
  approvals_complete: boolean;
  associates: CapacityApprovalDraft[];
};

function normalizeClock(raw: string | null | undefined): string {
  return String(raw ?? "").trim();
}

/**
 * Deterministic per-associate week fingerprint.
 * Must stay aligned with SQL associate_week_schedule_fingerprint aggregation.
 */
export function buildAssociateWeekScheduleFingerprint(
  rows: ReadonlyArray<ShiftDayFingerprintInput>,
  specialistId = ""
): string {
  const parts = [...rows]
    .map((row) => ({
      work_date: String(row.work_date ?? "").trim(),
      status: String(row.status ?? "").trim(),
      // Match SQL: CASE WHEN is_scheduled_today THEN '1' ELSE '0' END (null → '0')
      scheduled: row.is_scheduled_today === true ? "1" : "0",
      call_out: row.is_call_out === true ? "1" : "0",
      start: normalizeClock(row.start_time),
      end: normalizeClock(row.end_time),
    }))
    .filter((row) => row.work_date)
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
    .map(
      (row) =>
        `${row.work_date}|${row.status}|${row.scheduled}|${row.call_out}|${row.start}|${row.end}`
    );
  if (parts.length === 0) {
    return simpleMd5(`empty:${String(specialistId).trim()}`);
  }
  return simpleMd5(parts.join(";"));
}

/** Hex MD5 matching Postgres md5(text). */
export function simpleMd5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

export function isApprovedCapacityValue(
  value: unknown
): value is ApprovedCapacityValue {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  return value >= 0 && value <= MAX_APPROVED_WEEKLY_BAY_CAPACITY;
}

export function parseApprovedCapacity(
  value: unknown
): ApprovedCapacityValue | null {
  if (!isApprovedCapacityValue(value)) return null;
  return value;
}

export type ValidateApprovalItemInput = {
  specialist_id: string;
  approved_capacity: unknown;
  eligible: boolean;
  owned_count: number;
  schedule_fingerprint: string;
  live_fingerprint: string;
};

export type ValidateApprovalItemResult =
  | { ok: true; capacity: ApprovedCapacityValue }
  | { ok: false; code: string; error: string };

export function validateCapacityApprovalItem(
  input: ValidateApprovalItemInput
): ValidateApprovalItemResult {
  const sid = String(input.specialist_id ?? "").trim();
  if (!sid) {
    return { ok: false, code: "CAPACITY_APPROVAL_INPUT", error: "specialist_id required" };
  }
  const capacity = parseApprovedCapacity(input.approved_capacity);
  if (capacity == null) {
    return {
      ok: false,
      code: "CAPACITY_APPROVAL_RANGE",
      error: "Capacity must be an integer 0–3",
    };
  }
  if (capacity > 0 && !input.eligible) {
    return {
      ok: false,
      code: "CAPACITY_APPROVAL_INELIGIBLE",
      error: "Ineligible associates cannot receive a positive weekly capacity",
    };
  }
  const owned = Math.max(0, Math.floor(input.owned_count));
  if (capacity < owned) {
    return {
      ok: false,
      code: "CAPACITY_APPROVAL_BELOW_OWNED",
      error: `Cannot approve ${capacity}: associate already has ${owned} committed assignment${owned === 1 ? "" : "s"}`,
    };
  }
  if (
    !input.schedule_fingerprint ||
    input.schedule_fingerprint !== input.live_fingerprint
  ) {
    return {
      ok: false,
      code: "CAPACITY_APPROVAL_STALE",
      error: "Schedule changed — refresh evidence and re-approve",
    };
  }
  return { ok: true, capacity };
}

/**
 * Compose store-week capacity from explicit approved per-person caps.
 * Missing approval → remaining 0 for that associate (fail closed for assign).
 * Shared target = sum of approved capacities (not eligible×3).
 */
export function composeApprovedStoreWeekCapacity(input: {
  store_number: string;
  week_label: string;
  /** specialist_id → approved 0–3 (only valid/non-stale approvals). */
  approved_by_specialist: Readonly<Record<string, number>>;
  eligible_specialist_ids: readonly string[];
  assignments: ReadonlyArray<CapacityAssignmentRow>;
  /** Minimal workforce stubs so composeStoreWeekCapacity retains eligible ids. */
  workforce?: ReadonlyArray<WeekLaborMemberInput>;
  profile_to_roster?: ReadonlyMap<string, string> | Record<string, string>;
  department_codes?: readonly string[];
  as_of?: string;
}): StoreWeekCapacitySnapshot & {
  approvals_complete: boolean;
  approved_by_specialist: Record<string, number>;
} {
  const eligible = [
    ...new Set(
      input.eligible_specialist_ids.map((id) => String(id).trim()).filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));

  const week = String(input.week_label).trim();
  const range = isoWeekCalendarRange(week);
  // Synthetic ON_DUTY evidence so composeStoreWeekCapacity keeps the eligible set
  // while approved_by_specialist drives shared/per-person ceilings.
  const syntheticShifts = eligible.map((id) => ({
    specialist_id: id,
    work_date: range.startDate,
    start_time: "08:00",
    end_time: "16:00",
    is_scheduled_today: true,
    is_call_out: false,
    status: "ON_DUTY",
  }));
  const workforce =
    input.workforce && input.workforce.length > 0
      ? input.workforce
      : eligible.map((id) => ({
          id,
          name: id,
          role: "Associate",
          is_active: true,
          home_department: "flooring",
          assigned_department: "flooring",
        }));

  const snap = composeStoreWeekCapacity({
    store_number: input.store_number,
    week_label: week,
    department_codes: input.department_codes ?? ["flooring"],
    workforce,
    persisted_shift_days: syntheticShifts,
    assignments: input.assignments,
    profile_to_roster: input.profile_to_roster,
    quota_per_person: BASE_WEEKLY_BAY_QUOTA,
    approved_by_specialist: input.approved_by_specialist,
    as_of: input.as_of,
  });

  return {
    ...snap,
    approvals_complete: snap.approvals_complete === true,
    approved_by_specialist: snap.approved_by_specialist ?? {},
  };
}

export function buildWeekCapacityReviewBoard(input: {
  store_number: string;
  week_label: string;
  workforce: ReadonlyArray<WeekLaborMemberInput>;
  persisted_shift_days: ReadonlyArray<ShiftDayFingerprintInput & { specialist_id: string }>;
  approvals: ReadonlyArray<
    Pick<
      CapacityApprovalRow,
      | "specialist_id"
      | "approved_capacity"
      | "schedule_fingerprint"
      | "approved_at"
      | "approved_by_specialist_id"
    >
  >;
  owned_by_specialist: Readonly<Record<string, number>>;
  /** Draft proposed capacities keyed by specialist (UI state). */
  proposed_by_specialist?: Readonly<Record<string, number>>;
  department?: string;
  as_of?: string;
}): WeekCapacityReviewBoard {
  const week_label = String(input.week_label).trim();
  const week_starting = isoWeekToMondayDate(week_label);
  const range = isoWeekCalendarRange(week_label);
  const department = String(input.department ?? "flooring").trim() || "flooring";
  const as_of = input.as_of ?? new Date().toISOString();

  const labor = composeWeekLaborAvailability({
    department,
    week_label,
    dates: range.dates,
    workforce: input.workforce,
    persisted_shift_days: input.persisted_shift_days.map((row) => ({
      specialist_id: String(row.specialist_id),
      work_date: String(row.work_date),
      start_time: row.start_time ?? null,
      end_time: row.end_time ?? null,
      is_scheduled_today: row.is_scheduled_today !== false,
      is_call_out: row.is_call_out === true,
      status: row.status,
    })),
    workforce_evidence_available: true,
    schedule_evidence_available: true,
    as_of,
  });

  const approvalById = new Map(
    input.approvals.map((row) => [String(row.specialist_id).trim(), row])
  );

  const members = [...labor.members].sort((a, b) =>
    a.specialist_name.localeCompare(b.specialist_name)
  );

  const associates: CapacityApprovalDraft[] = members.map((member) => {
    const sid = member.specialist_id;
    const shifts = input.persisted_shift_days.filter(
      (row) => String(row.specialist_id) === sid
    );
    const fingerprint = buildAssociateWeekScheduleFingerprint(shifts, sid);
    // AUTO-005A: active home-department associates are assignment-eligible
    // regardless of shift rows. Shifts remain for fingerprint / display only.
    const eligible = true;
    const suggested: ApprovedCapacityValue = BASE_WEEKLY_BAY_QUOTA;
    const owned = Math.max(0, Math.floor(input.owned_by_specialist[sid] ?? 0));
    const approval = approvalById.get(sid);
    let approval_status: CapacityApprovalDraft["approval_status"] = "missing";
    let approved_capacity: number | null = null;
    if (approval) {
      approved_capacity = approval.approved_capacity;
      approval_status =
        approval.schedule_fingerprint === fingerprint ? "approved" : "stale";
    }

    const proposedRaw = input.proposed_by_specialist?.[sid];
    const proposed_capacity: ApprovedCapacityValue = isApprovedCapacityValue(
      proposedRaw
    )
      ? proposedRaw
      : suggested;

    return {
      specialist_id: sid,
      specialist_name: member.specialist_name,
      scheduled_department_days: member.scheduled_day_count,
      known_available_hours: member.known_available_hours,
      eligible,
      suggested_capacity: suggested,
      proposed_capacity,
      approved_capacity,
      approval_status,
      schedule_fingerprint: fingerprint,
      owned_count: owned,
      approved_at: approval?.approved_at ?? null,
      approved_by_specialist_id: approval?.approved_by_specialist_id ?? null,
    };
  });

  const validApproved = associates.filter(
    (row) =>
      row.eligible &&
      row.approval_status === "approved" &&
      isApprovedCapacityValue(row.approved_capacity)
  );
  const eligible = associates.filter((row) => row.eligible);
  const shared_target_approved = validApproved.reduce(
    (sum, row) => sum + (row.approved_capacity as number),
    0
  );
  const shared_target_proposed = eligible.reduce(
    (sum, row) => sum + row.proposed_capacity,
    0
  );
  const approvals_complete =
    eligible.length > 0 &&
    eligible.every((row) => row.approval_status === "approved");

  return {
    store_number: String(input.store_number).trim(),
    week_label,
    week_starting,
    shared_target_approved,
    shared_target_proposed,
    approvals_complete,
    associates,
  };
}

export async function loadWeekCapacityApprovals(
  supabase: SupabaseClient,
  storeNumber: string,
  weekLabel: string
): Promise<CapacityApprovalRow[]> {
  const storeKeys = storeNumberQueryValues(storeNumber);
  const { data, error } = await supabase
    .from("store_week_capacity_approvals")
    .select(
      "store_number, week_label, week_starting, specialist_id, approved_capacity, schedule_fingerprint, approved_by_specialist_id, approved_at"
    )
    .in("store_number", storeKeys)
    .eq("week_label", weekLabel);
  if (error) {
    const msg = String(error.message ?? "");
    if (/store_week_capacity_approvals|PGRST|does not exist|42P01/i.test(msg)) {
      const err = new Error(
        "Weekly capacity approval schema is not migrated — refusing capacity operations"
      );
      (err as Error & { code?: string }).code = "CAPACITY_APPROVAL_SCHEMA_MISSING";
      throw err;
    }
    throw new Error(error.message);
  }
  return (data ?? []) as CapacityApprovalRow[];
}

export async function writeWeekCapacityApprovals(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    approved_by_specialist_id: string;
    items: ReadonlyArray<{
      specialist_id: string;
      approved_capacity: number;
      schedule_fingerprint: string;
    }>;
  }
): Promise<{ ok: boolean; written: number; error?: string; code?: string }> {
  const store = String(input.store_number ?? "").trim();
  const week = String(input.week_label ?? "").trim();
  const by = String(input.approved_by_specialist_id ?? "").trim();
  if (!store || !week || !by) {
    return {
      ok: false,
      written: 0,
      code: "CAPACITY_APPROVAL_INPUT",
      error: "store_number, week_label, and approved_by are required",
    };
  }
  let week_starting: string;
  try {
    week_starting = isoWeekToMondayDate(week);
  } catch (err) {
    return {
      ok: false,
      written: 0,
      code: "CAPACITY_APPROVAL_INPUT",
      error: err instanceof Error ? err.message : "Invalid week",
    };
  }

  const { data, error } = await supabase.rpc(UPSERT_WEEK_CAPACITY_APPROVALS_RPC, {
    p_store_number: store,
    p_week_label: week,
    p_week_starting: week_starting,
    p_approved_by_specialist_id: by,
    p_items: input.items.map((item) => ({
      specialist_id: String(item.specialist_id).trim(),
      approved_capacity: Math.floor(item.approved_capacity),
      schedule_fingerprint: String(item.schedule_fingerprint).trim(),
    })),
  });

  if (error) {
    const msg = String(error.message ?? "");
    let code = "CAPACITY_APPROVAL_WRITE_FAILED";
    if (/CAPACITY_APPROVAL_STALE/i.test(msg)) code = "CAPACITY_APPROVAL_STALE";
    else if (/CAPACITY_APPROVAL_BELOW_OWNED/i.test(msg))
      code = "CAPACITY_APPROVAL_BELOW_OWNED";
    else if (/CAPACITY_APPROVAL_RANGE/i.test(msg)) code = "CAPACITY_APPROVAL_RANGE";
    else if (/CAPACITY_STORE_FORBIDDEN/i.test(msg)) code = "CAPACITY_STORE_FORBIDDEN";
    else if (/could not find the function|PGRST202|does not exist/i.test(msg))
      code = "CAPACITY_APPROVAL_SCHEMA_MISSING";
    return { ok: false, written: 0, code, error: msg };
  }

  return {
    ok: true,
    written: Number((data as { written?: number } | null)?.written ?? 0),
  };
}

/**
 * Load labor + approvals and compose authoritative approved capacity snapshot.
 * Fail-closed when schema missing or approvals incomplete for eligible set.
 */
export async function loadApprovedStoreWeekCapacity(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    department_codes: readonly string[];
  }
): Promise<
  StoreWeekCapacitySnapshot & {
    approvals_complete: boolean;
    approved_by_specialist: Record<string, number>;
  }
> {
  const store = String(input.store_number).trim();
  const week = String(input.week_label).trim();
  const range = isoWeekCalendarRange(week);
  const storeKeys = storeNumberQueryValues(store);

  const [workforceRes, shiftsRes, assignments, approvals] = await Promise.all([
    supabase
      .from("store_specialists")
      .select("id, name, role, is_active, home_department, assigned_department")
      .in("store_number", storeKeys)
      .eq("is_active", true),
    supabase
      .from("associate_shift_days")
      .select(
        "specialist_id, work_date, start_time, end_time, is_scheduled_today, is_call_out, status"
      )
      .in("store_number", storeKeys)
      .gte("work_date", range.startDate)
      .lte("work_date", range.endDate),
    loadStoreWeekAssignments(supabase, store, week),
    loadWeekCapacityApprovals(supabase, store, week),
  ]);

  if (workforceRes.error) throw new Error(workforceRes.error.message);
  if (shiftsRes.error) throw new Error(shiftsRes.error.message);

  const workforce = (workforceRes.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    role: String(row.role ?? "Associate"),
    is_active: row.is_active !== false,
    home_department: row.home_department as string | null | undefined,
    assigned_department: row.assigned_department as string | null | undefined,
  }));

  const shifts = (shiftsRes.data ?? []).map((row) => ({
    specialist_id: String(row.specialist_id),
    work_date: String(row.work_date),
    start_time: row.start_time as string | null,
    end_time: row.end_time as string | null,
    is_scheduled_today: row.is_scheduled_today as boolean | null | undefined,
    is_call_out: row.is_call_out as boolean | null | undefined,
    status: row.status as string | null | undefined,
  }));

  // AUTO-005A: weekly assignment eligibility = active home-department associates
  // (labor.members). Shift-hour allocatable set must not gate capacity or assign.
  const eligible = new Set<string>();
  for (const department of input.department_codes) {
    const labor = composeWeekLaborAvailability({
      department: String(department).trim().toLowerCase(),
      week_label: week,
      dates: range.dates,
      workforce,
      persisted_shift_days: shifts.map((row) => ({
        ...row,
        is_scheduled_today: row.is_scheduled_today !== false,
        is_call_out: row.is_call_out === true,
      })),
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of: new Date().toISOString(),
    });
    for (const member of labor.members) {
      eligible.add(String(member.specialist_id).trim());
    }
  }

  const approved_by_specialist: Record<string, number> = {};
  for (const row of approvals) {
    const sid = String(row.specialist_id).trim();
    if (!eligible.has(sid)) continue;
    const live = buildAssociateWeekScheduleFingerprint(
      shifts.filter((s) => s.specialist_id === sid),
      sid
    );
    if (row.schedule_fingerprint !== live) continue;
    if (!isApprovedCapacityValue(row.approved_capacity)) continue;
    approved_by_specialist[sid] = row.approved_capacity;
  }

  const profileIds = assignments
    .map((row) => String(row.assigned_specialist_id ?? "").trim())
    .filter(Boolean);
  const profile_to_roster = await loadProfileRosterLinks(supabase, profileIds);

  return composeApprovedStoreWeekCapacity({
    store_number: store,
    week_label: week,
    approved_by_specialist,
    eligible_specialist_ids: [...eligible],
    assignments,
    profile_to_roster,
  });
}

/** Assert approvals are complete before additive assignment planning. */
export function assertApprovalsReadyForAssignment(capacity: {
  approvals_complete?: boolean;
  approved_by_specialist?: Record<string, number>;
  eligible_count: number;
  shared_target: number;
}): { ok: true } | { ok: false; error: string } {
  // Legacy eligible×3 snapshots omit approval fields — skip (pre-migration).
  if (
    capacity.approvals_complete === undefined &&
    capacity.approved_by_specialist === undefined
  ) {
    return { ok: true };
  }
  if (capacity.approvals_complete !== true) {
    return {
      ok: false,
      error:
        "Weekly bay capacity is not fully approved for eligible associates. Review days/hours and approve capacities before assigning.",
    };
  }
  if (capacity.eligible_count > 0 && capacity.shared_target <= 0) {
    return {
      ok: false,
      error: "Approved shared weekly capacity is 0 — nothing to assign.",
    };
  }
  return { ok: true };
}

/** Throw when ROTATION-005 approvals are required but incomplete. */
export function assertApprovedCapacityReady(capacity: {
  approvals_complete?: boolean;
  approved_by_specialist?: Record<string, number>;
  eligible_count: number;
  shared_target: number;
}): void {
  const check = assertApprovalsReadyForAssignment(capacity);
  if (!check.ok) throw new Error(check.error);
}
