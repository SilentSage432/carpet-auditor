/**
 * DEPTSYNC-CAPACITY-GUARD-002 + SECTION-ROTATION-005 — store-week capacity.
 *
 * Owns: shared eligibility union, remaining per-person / shared slots,
 * and the atomic DB writer boundary.
 *
 * ROTATION-005: when approvals exist, shared target = sum(approved caps)
 * and per-person ceilings come from operator-approved weekly capacities.
 *
 * Does not: invent eligibility, archive associates, change section semantics,
 * or activate second-department auto-stage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { storeNumberQueryValues } from "@/lib/store";
import {
  composeWeekLaborAvailability,
  weekLaborToPlannerMembers,
  type WeekLaborMemberInput,
} from "@/lib/store-ops/labor-availability";
import {
  isoWeekCalendarRange,
  isoWeekToMondayDate,
  resolveAutomaticWeeklyBayTarget,
} from "@/lib/store-ops/week";
import { BASE_WEEKLY_BAY_QUOTA } from "@/lib/store-ops/weekly-rotations";

export { BASE_WEEKLY_BAY_QUOTA };

/** RPC name — fail-closed when missing (no weaker unguarded substitute). */
export const UPSERT_SUNDAY_ASSIGNMENTS_WITH_CAPACITY_RPC =
  "upsert_sunday_bay_assignments_with_capacity" as const;

export type CapacityAssignmentRow = {
  bay_id: string;
  department?: string | null;
  roster_specialist_id?: string | null;
  assigned_specialist_id?: string | null;
  specialist_name?: string | null;
  status?: string | null;
};

export type CapacityWriteItem = {
  department: string;
  bay_id: string;
  roster_specialist_id: string;
  specialist_name: string;
  assigned_specialist_id?: string | null;
  status?: string;
  is_carried_over?: boolean;
};

export type StoreWeekCapacitySnapshot = {
  store_number: string;
  week_label: string;
  week_starting: string;
  quota_per_person: number;
  /** Distinct roster ids with schedule-backed eligibility in any participating dept. */
  eligible_specialist_ids: string[];
  eligible_count: number;
  /**
   * Shared weekly target.
   * Legacy: eligible_count × quota.
   * ROTATION-005: sum of operator-approved per-person capacities when present.
   */
  shared_target: number;
  /** Non-cleared owned assignments across all departments for the store-week. */
  owned_total: number;
  /** roster_specialist_id → owned count (identity = roster id only). */
  owned_by_specialist: Record<string, number>;
  remaining_shared: number;
  remaining_by_specialist: Record<string, number>;
  /** True when owned_total already exceeds shared_target (historic over-capacity). */
  over_capacity: boolean;
  /** ROTATION-005: specialist → approved 0–3 when using approved capacity model. */
  approved_by_specialist?: Record<string, number>;
  /** ROTATION-005: every eligible associate has a non-stale approval. */
  approvals_complete?: boolean;
};

export type ComposeStoreWeekCapacityInput = {
  store_number: string;
  week_label: string;
  /** Department codes participating in Sunday / capacity pool (usually active depts). */
  department_codes: readonly string[];
  workforce: ReadonlyArray<WeekLaborMemberInput>;
  persisted_shift_days: ReadonlyArray<{
    specialist_id: string;
    work_date: string;
    start_time: string | null;
    end_time: string | null;
    is_scheduled_today?: boolean | null;
    is_call_out?: boolean | null;
    status?: string | null;
  }>;
  /** Existing sunday_bay_assignments for the store-week (all departments). */
  assignments: ReadonlyArray<CapacityAssignmentRow>;
  /**
   * Optional profile_id → roster_specialist_id for rows that only have
   * assigned_specialist_id. Never inferred from names.
   */
  profile_to_roster?: ReadonlyMap<string, string> | Record<string, string>;
  quota_per_person?: number;
  /**
   * ROTATION-005: when provided, shared_target = sum(approved) and per-person
   * remaining uses approved caps (missing id → 0 remaining / fail-closed).
   */
  approved_by_specialist?: Readonly<Record<string, number>>;
  as_of?: string;
};

function isOwnedCapacityRow(row: CapacityAssignmentRow | null | undefined): boolean {
  if (!row) return false;
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "cleared") return false;
  const roster = String(row.roster_specialist_id ?? "").trim();
  return Boolean(roster);
}

export function resolveCapacityOwnerId(
  row: CapacityAssignmentRow,
  profileToRoster?: ReadonlyMap<string, string> | Record<string, string> | null
): string | null {
  const roster = String(row.roster_specialist_id ?? "").trim();
  if (roster) return roster;
  const profile = String(row.assigned_specialist_id ?? "").trim();
  if (!profile || !profileToRoster) return null;
  if (profileToRoster instanceof Map) {
    const linked = profileToRoster.get(profile);
    return linked ? String(linked).trim() || null : null;
  }
  const linked = (profileToRoster as Record<string, string>)[profile];
  return linked ? String(linked).trim() || null : null;
}

/**
 * Pure store-week capacity composition.
 * MasterAdmin is already excluded by labor eligibility.
 * Missing schedules do not archive anyone — they simply omit from eligible set.
 */
export function composeStoreWeekCapacity(
  input: ComposeStoreWeekCapacityInput
): StoreWeekCapacitySnapshot {
  const store_number = String(input.store_number ?? "").trim();
  const week_label = String(input.week_label ?? "").trim();
  const quota = Math.max(
    0,
    Math.floor(input.quota_per_person ?? BASE_WEEKLY_BAY_QUOTA)
  );
  const week_starting = isoWeekToMondayDate(week_label);
  const range = isoWeekCalendarRange(week_label);
  const as_of = input.as_of ?? new Date().toISOString();

  const eligible = new Set<string>();
  const deptCodes = [
    ...new Set(
      (input.department_codes ?? [])
        .map((c) => String(c ?? "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  for (const department of deptCodes) {
    const labor = composeWeekLaborAvailability({
      department,
      week_label,
      dates: range.dates,
      workforce: input.workforce,
      persisted_shift_days: input.persisted_shift_days.map((row) => ({
        specialist_id: String(row.specialist_id),
        work_date: String(row.work_date),
        start_time: row.start_time,
        end_time: row.end_time,
        is_scheduled_today: row.is_scheduled_today !== false,
        is_call_out: row.is_call_out === true,
        status: row.status,
      })),
      workforce_evidence_available: true,
      schedule_evidence_available: true,
      as_of,
    });
    if (labor.processing_status === "UNAVAILABLE") continue;
    for (const member of weekLaborToPlannerMembers(labor.allocatable)) {
      const id = String(member.specialist_id ?? "").trim();
      if (id) eligible.add(id);
    }
  }

  const eligible_specialist_ids = [...eligible].sort((a, b) =>
    a.localeCompare(b)
  );
  const eligible_count = eligible_specialist_ids.length;

  const owned_by_specialist: Record<string, number> = {};
  let owned_total = 0;
  for (const row of input.assignments ?? []) {
    if (!isOwnedCapacityRow(row)) {
      // Rows with only profile linkage still count when mapped.
      const status = String(row.status ?? "").trim().toLowerCase();
      if (status === "cleared") continue;
      const owner = resolveCapacityOwnerId(row, input.profile_to_roster);
      if (!owner) continue;
      owned_total += 1;
      owned_by_specialist[owner] = (owned_by_specialist[owner] ?? 0) + 1;
      continue;
    }
    const owner = resolveCapacityOwnerId(row, input.profile_to_roster);
    if (!owner) continue;
    owned_total += 1;
    owned_by_specialist[owner] = (owned_by_specialist[owner] ?? 0) + 1;
  }

  const approvedInput = input.approved_by_specialist;
  const usingApprovals = approvedInput != null;
  const approved_by_specialist: Record<string, number> | undefined = usingApprovals
    ? {}
    : undefined;
  let shared_target: number;
  let approvals_complete: boolean | undefined;

  if (usingApprovals && approved_by_specialist) {
    shared_target = 0;
    approvals_complete = eligible_count > 0;
    for (const id of eligible_specialist_ids) {
      const raw = Number(approvedInput[id]);
      const cap =
        Number.isInteger(raw) && raw >= 0 && raw <= quota ? raw : null;
      if (cap == null) {
        approvals_complete = false;
        approved_by_specialist[id] = 0;
        continue;
      }
      approved_by_specialist[id] = cap;
      shared_target += cap;
    }
    if (eligible_count === 0) {
      approvals_complete = false;
      shared_target = 0;
    }
  } else {
    shared_target = resolveAutomaticWeeklyBayTarget(eligible_count, quota);
  }

  const remaining_by_specialist: Record<string, number> = {};
  for (const id of eligible_specialist_ids) {
    const personQuota = usingApprovals
      ? (approved_by_specialist?.[id] ?? 0)
      : quota;
    remaining_by_specialist[id] = Math.max(
      0,
      personQuota - (owned_by_specialist[id] ?? 0)
    );
  }

  const remaining_shared = Math.max(0, shared_target - owned_total);

  return {
    store_number,
    week_label,
    week_starting,
    quota_per_person: quota,
    eligible_specialist_ids,
    eligible_count,
    shared_target,
    owned_total,
    owned_by_specialist,
    remaining_shared,
    remaining_by_specialist,
    over_capacity: owned_total > shared_target,
    ...(usingApprovals
      ? { approved_by_specialist, approvals_complete }
      : {}),
  };
}

/** Cap automatic staging volume for one department against shared remaining. */
export function resolveDepartmentStageDrawCount(input: {
  departmentEligibleCount: number;
  capacity: StoreWeekCapacitySnapshot;
  quota_per_person?: number;
}): number {
  const quota = Math.max(
    0,
    Math.floor(input.quota_per_person ?? input.capacity.quota_per_person)
  );
  const deptTarget = resolveAutomaticWeeklyBayTarget(
    input.departmentEligibleCount,
    quota
  );
  const personRemainingSum = Object.values(
    input.capacity.remaining_by_specialist
  ).reduce((sum, n) => sum + n, 0);
  return Math.max(
    0,
    Math.min(deptTarget, input.capacity.remaining_shared, personRemainingSum)
  );
}

export function remainingCapMapForEligible(
  capacity: StoreWeekCapacitySnapshot
): Map<string, number> {
  return new Map(
    capacity.eligible_specialist_ids.map((id) => [
      id,
      capacity.remaining_by_specialist[id] ?? 0,
    ])
  );
}

/**
 * Filter a proposed assignment plan to what shared capacity still allows.
 * Reassignment of an already-owned bay (same bay_id already in owned set for
 * another owner) is left for the DB writer — callers should pass only net-new
 * ownership intents for automatic fill.
 */
export function filterPlanItemsToCapacity<
  T extends { specialist_id: string; rotationId: string },
>(
  items: readonly T[],
  capacity: StoreWeekCapacitySnapshot,
  options?: { allow_over_base?: boolean; allow_over_shared?: boolean }
): { accepted: T[]; rejected: T[]; reason?: string } {
  const allowOverBase = options?.allow_over_base === true;
  const allowOverShared = options?.allow_over_shared === true;
  const personCounts = { ...capacity.owned_by_specialist };
  let total = capacity.owned_total;
  const accepted: T[] = [];
  const rejected: T[] = [];

  for (const item of items) {
    const sid = String(item.specialist_id ?? "").trim();
    if (!sid) {
      rejected.push(item);
      continue;
    }
    const personOwned = personCounts[sid] ?? 0;
    const personQuota =
      capacity.approved_by_specialist &&
      Object.prototype.hasOwnProperty.call(capacity.approved_by_specialist, sid)
        ? Math.max(0, Math.floor(capacity.approved_by_specialist[sid] ?? 0))
        : capacity.quota_per_person;
    if (!allowOverBase && personOwned >= personQuota) {
      rejected.push(item);
      continue;
    }
    if (!allowOverShared && total >= capacity.shared_target) {
      rejected.push(item);
      continue;
    }
    accepted.push(item);
    personCounts[sid] = personOwned + 1;
    total += 1;
  }

  let reason: string | undefined;
  if (rejected.length > 0) {
    reason = capacity.over_capacity
      ? "Store-week is already over shared capacity — refusing additive assignments"
      : "Plan exceeds shared store-week capacity or per-person base quota";
  }
  return { accepted, rejected, reason };
}

export type CapacityWriteResult = {
  ok: boolean;
  written: number;
  error?: string;
  code?:
    | "CAPACITY_PERSON_EXCEEDED"
    | "CAPACITY_SHARED_EXCEEDED"
    | "CAPACITY_RPC_MISSING"
    | "CAPACITY_STORE_FORBIDDEN"
    | "CAPACITY_INPUT"
    | "CAPACITY_WRITE_FAILED"
    | "CAPACITY_APPROVAL_MISSING"
    | "CAPACITY_APPROVAL_STALE"
    | "CAPACITY_APPROVAL_ZERO"
    | "CAPACITY_APPROVAL_SCHEMA_MISSING"
    | "SECTION_OWNERSHIP_MISSING"
    | "SECTION_OWNERSHIP_MISMATCH"
    | "SECTION_OWNERSHIP_AMBIGUOUS";
  raw?: unknown;
};

function classifyCapacityError(message: string): CapacityWriteResult["code"] {
  const m = String(message ?? "");
  if (/SECTION_OWNERSHIP_AMBIGUOUS/i.test(m)) return "SECTION_OWNERSHIP_AMBIGUOUS";
  if (/SECTION_OWNERSHIP_MISMATCH/i.test(m)) return "SECTION_OWNERSHIP_MISMATCH";
  if (/SECTION_OWNERSHIP_MISSING/i.test(m)) return "SECTION_OWNERSHIP_MISSING";
  if (/CAPACITY_PERSON_EXCEEDED/i.test(m)) return "CAPACITY_PERSON_EXCEEDED";
  if (/CAPACITY_SHARED_EXCEEDED/i.test(m)) return "CAPACITY_SHARED_EXCEEDED";
  if (/CAPACITY_STORE_FORBIDDEN/i.test(m)) return "CAPACITY_STORE_FORBIDDEN";
  if (/CAPACITY_APPROVAL_MISSING/i.test(m)) return "CAPACITY_APPROVAL_MISSING";
  if (/CAPACITY_APPROVAL_STALE/i.test(m)) return "CAPACITY_APPROVAL_STALE";
  if (/CAPACITY_APPROVAL_ZERO/i.test(m)) return "CAPACITY_APPROVAL_ZERO";
  if (/CAPACITY_APPROVAL_SCHEMA_MISSING|store_week_capacity_approvals/i.test(m))
    return "CAPACITY_APPROVAL_SCHEMA_MISSING";
  if (/CAPACITY_INPUT/i.test(m)) return "CAPACITY_INPUT";
  if (
    /could not find the function|PGRST202|404|does not exist|upsert_sunday_bay_assignments_with_capacity/i.test(
      m
    )
  ) {
    return "CAPACITY_RPC_MISSING";
  }
  return "CAPACITY_WRITE_FAILED";
}

/**
 * Authoritative capacity-gated writer. Fail-closed when the RPC is unavailable —
 * never falls back to unguarded upsert (CAPACITY-GUARD-002 concurrency law).
 */
export async function writeSundayAssignmentsWithCapacity(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    shared_target: number;
    quota_per_person?: number;
    items: CapacityWriteItem[];
    allow_over_base?: boolean;
    allow_over_shared?: boolean;
  }
): Promise<CapacityWriteResult> {
  const store = String(input.store_number ?? "").trim();
  const week = String(input.week_label ?? "").trim();
  if (!store || !week) {
    return {
      ok: false,
      written: 0,
      code: "CAPACITY_INPUT",
      error: "store_number and week_label are required",
    };
  }
  if (!input.items?.length) {
    return { ok: true, written: 0 };
  }

  let week_starting: string;
  try {
    week_starting = isoWeekToMondayDate(week);
  } catch (err) {
    return {
      ok: false,
      written: 0,
      code: "CAPACITY_INPUT",
      error: err instanceof Error ? err.message : "Invalid week label",
    };
  }

  const payload = {
    p_store_number: store,
    p_week_starting: week_starting,
    p_shared_target: Math.max(0, Math.floor(input.shared_target)),
    p_quota_per_person: Math.max(
      0,
      Math.floor(input.quota_per_person ?? BASE_WEEKLY_BAY_QUOTA)
    ),
    p_items: input.items.map((item) => ({
      department: String(item.department ?? "")
        .trim()
        .toLowerCase(),
      bay_id: String(item.bay_id ?? "").trim(),
      roster_specialist_id: String(item.roster_specialist_id ?? "").trim(),
      assigned_specialist_id: item.assigned_specialist_id ?? null,
      specialist_name: String(item.specialist_name ?? ""),
      status: String(item.status ?? "assigned").trim() || "assigned",
      is_carried_over: item.is_carried_over === true,
    })),
    p_allow_over_base: input.allow_over_base === true,
    p_allow_over_shared: input.allow_over_shared === true,
  };

  const { data, error } = await supabase.rpc(
    UPSERT_SUNDAY_ASSIGNMENTS_WITH_CAPACITY_RPC,
    payload
  );

  if (error) {
    const code = classifyCapacityError(error.message);
    return {
      ok: false,
      written: 0,
      code,
      error:
        code === "CAPACITY_RPC_MISSING"
          ? "Store-week capacity RPC is not migrated — refusing unguarded assignment write"
          : error.message,
      raw: error,
    };
  }

  const written = Number(
    (data as { written?: number } | null)?.written ?? input.items.length
  );
  return { ok: true, written, raw: data };
}

/** Load store-week assignment rows across all departments (capacity truth). */
export async function loadStoreWeekAssignments(
  supabase: SupabaseClient,
  storeNumber: string,
  weekLabel: string
): Promise<CapacityAssignmentRow[]> {
  const weekStarting = isoWeekToMondayDate(weekLabel);
  const storeKeys = storeNumberQueryValues(storeNumber);
  const { data, error } = await supabase
    .from("sunday_bay_assignments")
    .select(
      "bay_id, department, roster_specialist_id, assigned_specialist_id, specialist_name, status"
    )
    .in("store_number", storeKeys)
    .eq("week_starting", weekStarting);
  if (error) throw new Error(error.message);
  return (data ?? []) as CapacityAssignmentRow[];
}

/** Verified profile→roster links only (profiles.specialist_id). */
export async function loadProfileRosterLinks(
  supabase: SupabaseClient,
  profileIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, specialist_id")
    .in("id", ids);
  if (error) return map;
  for (const row of data ?? []) {
    const pid = String((row as { id?: string }).id ?? "").trim();
    const sid = String((row as { specialist_id?: string }).specialist_id ?? "").trim();
    if (pid && sid) map.set(pid, sid);
  }
  return map;
}

async function loadActiveWorkforce(
  supabase: SupabaseClient,
  storeNumber: string
): Promise<WeekLaborMemberInput[]> {
  const keys = storeNumberQueryValues(storeNumber);
  const { data, error } = await supabase
    .from("store_specialists")
    .select(
      "id, name, role, is_active, home_department, assigned_department"
    )
    .in("store_number", keys)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    role: String(row.role ?? "Associate"),
    is_active: row.is_active !== false,
    home_department: row.home_department as string | null | undefined,
    assigned_department: row.assigned_department as string | null | undefined,
  }));
}

async function loadWeekShiftDays(
  supabase: SupabaseClient,
  storeNumber: string,
  weekLabel: string
) {
  const range = isoWeekCalendarRange(weekLabel);
  const keys = storeNumberQueryValues(storeNumber);
  const { data, error } = await supabase
    .from("associate_shift_days")
    .select(
      "specialist_id, work_date, start_time, end_time, is_scheduled_today, is_call_out, status"
    )
    .in("store_number", keys)
    .gte("work_date", range.startDate)
    .lte("work_date", range.endDate);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Load evidence + compose authoritative store-week capacity.
 * `department_codes` should be the Sunday-participating / active department codes.
 *
 * ROTATION-005: loads operator approvals when the schema is present and applies
 * approved per-person caps. Missing schema fails closed (migration required
 * before writers that depend on approved capacity).
 */
export async function loadStoreWeekCapacity(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    department_codes: readonly string[];
    quota_per_person?: number;
  }
): Promise<StoreWeekCapacitySnapshot> {
  const store = String(input.store_number ?? "").trim();
  const week = String(input.week_label ?? "").trim();

  try {
    const { loadApprovedStoreWeekCapacity } = await import(
      "@/lib/store-ops/approved-week-capacity"
    );
    return await loadApprovedStoreWeekCapacity(supabase, {
      store_number: store,
      week_label: week,
      department_codes: input.department_codes,
    });
  } catch (err) {
    const code = String((err as { code?: string })?.code ?? "");
    const message = err instanceof Error ? err.message : String(err);
    // Schema not migrated yet → legacy eligible×3 (pre-ROTATION-005 release).
    // Once migrated, approvals are required (fail closed via RPC + approvals_complete).
    if (
      code === "CAPACITY_APPROVAL_SCHEMA_MISSING" ||
      /store_week_capacity_approvals|not migrated/i.test(message)
    ) {
      return loadLegacyStoreWeekCapacity(supabase, input);
    }
    throw err;
  }
}

/** Pre-approval uniform eligible×3 composer (compat until migration applied). */
async function loadLegacyStoreWeekCapacity(
  supabase: SupabaseClient,
  input: {
    store_number: string;
    week_label: string;
    department_codes: readonly string[];
    quota_per_person?: number;
  }
): Promise<StoreWeekCapacitySnapshot> {
  const store = String(input.store_number ?? "").trim();
  const week = String(input.week_label ?? "").trim();
  const [workforce, shifts, assignments] = await Promise.all([
    loadActiveWorkforce(supabase, store),
    loadWeekShiftDays(supabase, store, week),
    loadStoreWeekAssignments(supabase, store, week),
  ]);

  const profileIds = assignments
    .map((row) => String(row.assigned_specialist_id ?? "").trim())
    .filter(Boolean);
  const profile_to_roster = await loadProfileRosterLinks(supabase, profileIds);

  return composeStoreWeekCapacity({
    store_number: store,
    week_label: week,
    department_codes: input.department_codes,
    workforce,
    persisted_shift_days: shifts.map((row) => ({
      specialist_id: String(row.specialist_id),
      work_date: String(row.work_date),
      start_time: row.start_time as string | null,
      end_time: row.end_time as string | null,
      is_scheduled_today: row.is_scheduled_today as boolean | null | undefined,
      is_call_out: row.is_call_out as boolean | null | undefined,
      status: row.status as string | null | undefined,
    })),
    assignments,
    profile_to_roster,
    quota_per_person: input.quota_per_person,
  });
}
