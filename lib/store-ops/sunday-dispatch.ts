/**
 * ENGINE-PROD-002 + ROTATION-AUTO-002 — Sunday weekly orchestration.
 *
 * Stage: section-balanced when approved capacity + Operational Sections exist
 * (via generateWeeklyRotations). Assign: stewardship / strict section ownership
 * — same composer as Sunday UI. Flat cross-section assign retired.
 *
 * AUTO-003: WEEKLY_ROTATION_AUTO_PUBLISH product latch remains false. Cron never
 * reads publish flags from the HTTP body. Tests may pass publishAssignments.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { storeNumberQueryValues } from "@/lib/store";
import { normalizeAisle } from "@/lib/store-ops/aisle";
import {
  clearSupervisorLocksForPublishedBays,
  collectProtectedRotationIds,
  composeAuthoritativeAssignmentProposal,
  composeWeekPublicationVisibility,
  filterProposalAwayFromProtected,
  loadAuthoritativeStageContext,
  resolveWeeklyRotationAutoPublishEnabled,
  summarizePublicationResult,
  WEEKLY_ROTATION_AUTO_PUBLISH,
} from "@/lib/store-ops/authoritative-week-cycle";
import { departmentCodeQueryValues } from "@/lib/store-ops/department-codes";
import {
  composeWeekLaborAvailability,
  weekLaborToPlannerMembers,
  type WeekLaborMemberInput,
} from "@/lib/store-ops/labor-availability";
import { physicalBayKey } from "@/lib/store-ops/physical-bay";
import {
  generateWeeklyRotations,
  type GenerateRotationsResult,
} from "@/lib/store-ops/rotations";
import { evaluateSundayAutoRun } from "@/lib/store-ops/sunday-schedule";
import { listActiveStores } from "@/lib/store-ops/stores";
import {
  isoWeekCalendarRange,
  isoWeekToMondayDate,
  resolveAutomaticWeeklyBayTarget,
  resolveWeeklyBayTarget,
} from "@/lib/store-ops/week";
import {
  BASE_WEEKLY_BAY_QUOTA,
  type ShiftRosterMember,
} from "@/lib/store-ops/weekly-rotations";
import type { Department } from "@/lib/store-ops/types";
import { assertApprovedCapacityReady } from "@/lib/store-ops/approved-week-capacity";
import {
  filterPlanItemsToCapacity,
  loadStoreWeekCapacity,
  resolveDepartmentStageDrawCount,
  writeSundayAssignmentsWithCapacity,
  type StoreWeekCapacitySnapshot,
} from "@/lib/store-ops/shared-week-capacity";

export { BASE_WEEKLY_BAY_QUOTA, WEEKLY_ROTATION_AUTO_PUBLISH };

export type SundayDispatchStatus =
  | "COMPLETE"
  | "ALREADY_COMPLETE"
  | "INCOMPLETE_SCHEDULE"
  | "INSUFFICIENT_BAYS"
  | "NO_ELIGIBLE_WORKFORCE"
  | "NO_MAPPED_LOCATIONS"
  | "PARTIAL"
  | "STAGED_AWAITING_ASSIGN"
  | "ERROR"
  | "SKIPPED_SCHEDULE";

export type SundayDispatchLoad = {
  specialist_id: string;
  specialist_name: string;
  assigned: number;
  quota: number;
};

export type SundayDispatchResult = {
  department_id: string;
  department_code: string;
  department_name: string;
  store_id?: string;
  store_number?: string;
  assigned_week: string;
  status: SundayDispatchStatus;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  eligible_count: number;
  target_bays: number;
  staged_count: number;
  owned_count: number;
  owners: number;
  created_rotations?: number;
  created_assignments?: number;
  weekly_bay_target?: number;
  cycle_number?: number;
  cycle_reset?: boolean;
  loads?: SundayDispatchLoad[];
  /** AUTO-003 honest post-stage/publish composition (no Zebra claims). */
  publication_summary?: string;
};

type ActiveRotationRow = {
  id: string;
  location_id: string;
  assigned_week: string;
  is_completed?: boolean | null;
  store_locations?: {
    id?: string;
    aisle?: string | number | null;
    bay?: number | string | null;
    department_id?: string;
    type?: string | null;
  } | null;
};

type AssignmentRow = {
  bay_id: string;
  roster_specialist_id?: string | null;
  assigned_specialist_id?: string | null;
  specialist_name?: string | null;
  status?: string | null;
  supervisor_locked?: boolean | null;
  zebra_entered_at?: string | null;
};

function isOwnedAssignment(row: AssignmentRow | null | undefined): boolean {
  if (!row) return false;
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "cleared") return false;
  const roster = String(row.roster_specialist_id ?? "").trim();
  const profile = String(row.assigned_specialist_id ?? "").trim();
  return Boolean(roster || profile);
}

function assignmentOwnerId(row: AssignmentRow): string {
  return (
    String(row.roster_specialist_id ?? "").trim() ||
    String(row.assigned_specialist_id ?? "").trim()
  );
}

async function loadActiveWeekRotations(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string
): Promise<ActiveRotationRow[]> {
  const primary = await supabase
    .from("weekly_rotations")
    .select(
      "id, location_id, assigned_week, is_completed, store_locations ( id, aisle, bay, department_id, type )"
    )
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel)
    .is("superseded_at", null);

  if (primary.error && /superseded_at/i.test(primary.error.message)) {
    const fallback = await supabase
      .from("weekly_rotations")
      .select(
        "id, location_id, assigned_week, is_completed, store_locations ( id, aisle, bay, department_id, type )"
      )
      .eq("department_id", departmentId)
      .eq("assigned_week", weekLabel);
    if (fallback.error) throw new Error(fallback.error.message);
    return (fallback.data ?? []) as ActiveRotationRow[];
  }

  if (primary.error) throw new Error(primary.error.message);
  return (primary.data ?? []) as ActiveRotationRow[];
}

async function loadWeekAssignments(
  supabase: SupabaseClient,
  storeNumber: string,
  departmentCode: string,
  weekLabel: string
): Promise<Map<string, AssignmentRow>> {
  const weekStarting = isoWeekToMondayDate(weekLabel);
  const storeKeys = storeNumberQueryValues(storeNumber);
  const deptKeys = departmentCodeQueryValues(departmentCode);
  const primary = await supabase
    .from("sunday_bay_assignments")
    .select(
      "bay_id, roster_specialist_id, assigned_specialist_id, specialist_name, status, supervisor_locked, zebra_entered_at"
    )
    .in("store_number", storeKeys)
    .in("department", deptKeys)
    .eq("week_starting", weekStarting);

  let rows = (primary.data ?? []) as AssignmentRow[];
  if (primary.error) {
    if (/supervisor_locked/i.test(primary.error.message)) {
      const fallback = await supabase
        .from("sunday_bay_assignments")
        .select(
          "bay_id, roster_specialist_id, assigned_specialist_id, specialist_name, status, zebra_entered_at"
        )
        .in("store_number", storeKeys)
        .in("department", deptKeys)
        .eq("week_starting", weekStarting);
      if (fallback.error) throw new Error(fallback.error.message);
      rows = (fallback.data ?? []) as AssignmentRow[];
    } else {
      throw new Error(primary.error.message);
    }
  }
  const map = new Map<string, AssignmentRow>();
  for (const row of rows) {
    const bayId = String(row.bay_id ?? "").trim();
    if (!bayId) continue;
    map.set(bayId, row);
  }
  return map;
}

async function resolveProfileId(
  supabase: SupabaseClient,
  rosterSpecialistId: string
): Promise<string | null> {
  const id = String(rosterSpecialistId ?? "").trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("specialist_id", id)
    .maybeSingle();
  if (error) return null;
  return data?.id ? String(data.id) : null;
}

export type ApplySundayAssignmentAdminOptions = {
  /** When omitted, capacity is loaded from store-week evidence. */
  shared_target?: number;
  quota_per_person?: number;
  allow_over_base?: boolean;
  allow_over_shared?: boolean;
  /** Active / participating department codes for eligibility union. */
  participating_department_codes?: readonly string[];
};

/**
 * Service-role writer — CAPACITY-GUARD-002 atomic RPC boundary.
 * Never falls back to unguarded upsert when the RPC is missing.
 */
export async function applySundayAssignmentPlanAdmin(
  supabase: SupabaseClient,
  week: string,
  items: Array<{
    rotationId: string;
    specialist_id: string;
    specialist_name: string;
  }>,
  storeNumber: string,
  departmentCode: string,
  options: ApplySundayAssignmentAdminOptions = {}
): Promise<number> {
  const store = String(storeNumber ?? "").trim();
  const department =
    String(departmentCode ?? "").trim().toLowerCase() || "flooring";
  if (!store || !week || items.length === 0) return 0;

  const uniqueIds = [...new Set(items.map((row) => row.specialist_id))];
  const profileByRoster = new Map<string, string | null>();
  await Promise.all(
    uniqueIds.map(async (id) => {
      profileByRoster.set(id, await resolveProfileId(supabase, id));
    })
  );

  const codes =
    options.participating_department_codes &&
    options.participating_department_codes.length > 0
      ? options.participating_department_codes
      : [department];
  const capacity = await loadStoreWeekCapacity(supabase, {
    store_number: store,
    week_label: week,
    department_codes: codes,
    quota_per_person: options.quota_per_person,
  });
  assertApprovedCapacityReady(capacity);
  const sharedTarget =
    options.shared_target != null
      ? Math.min(options.shared_target, capacity.shared_target)
      : capacity.shared_target;

  const writeItems = items
    .map((row) => {
      const bayId = String(row.rotationId ?? "").trim();
      const specialistId = String(row.specialist_id ?? "").trim();
      if (!bayId || !specialistId) return null;
      return {
        department,
        bay_id: bayId,
        roster_specialist_id: specialistId,
        specialist_name: String(row.specialist_name ?? ""),
        assigned_specialist_id: profileByRoster.get(specialistId) ?? null,
        status: "assigned",
        is_carried_over: false,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const result = await writeSundayAssignmentsWithCapacity(supabase, {
    store_number: store,
    week_label: week,
    shared_target: sharedTarget,
    quota_per_person: options.quota_per_person ?? BASE_WEEKLY_BAY_QUOTA,
    items: writeItems,
    allow_over_base: options.allow_over_base === true,
    allow_over_shared: options.allow_over_shared === true,
  });
  if (!result.ok) {
    throw new Error(result.error || "Capacity-gated assignment write failed");
  }
  return result.written;
}

async function loadWorkforce(
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

async function loadShiftDays(
  supabase: SupabaseClient,
  storeNumber: string,
  startDate: string,
  endDate: string
): Promise<
  Array<{
    specialist_id: string;
    work_date: string;
    start_time: string | null;
    end_time: string | null;
    is_scheduled_today: boolean | null;
    is_call_out: boolean | null;
    status: string | null;
  }>
> {
  const keys = storeNumberQueryValues(storeNumber);
  const { data, error } = await supabase
    .from("associate_shift_days")
    .select(
      "specialist_id, work_date, start_time, end_time, is_scheduled_today, is_call_out, status"
    )
    .in("store_number", keys)
    .gte("work_date", startDate)
    .lte("work_date", endDate);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    specialist_id: string;
    work_date: string;
    start_time: string | null;
    end_time: string | null;
    is_scheduled_today: boolean | null;
    is_call_out: boolean | null;
    status: string | null;
  }>;
}

function summarizeLoads(
  rotations: ActiveRotationRow[],
  assignments: Map<string, AssignmentRow>,
  members: ShiftRosterMember[],
  quotaPerPerson = BASE_WEEKLY_BAY_QUOTA
): SundayDispatchLoad[] {
  const counts = new Map<string, { name: string; assigned: number }>();
  for (const member of members) {
    counts.set(member.specialist_id, {
      name: member.specialist_name,
      assigned: 0,
    });
  }
  for (const rotation of rotations) {
    const row = assignments.get(String(rotation.id));
    if (!isOwnedAssignment(row)) continue;
    const owner = assignmentOwnerId(row!);
    if (!owner) continue;
    const prev = counts.get(owner) ?? {
      name: String(row!.specialist_name ?? owner),
      assigned: 0,
    };
    prev.assigned += 1;
    if (row!.specialist_name) prev.name = String(row!.specialist_name);
    counts.set(owner, prev);
  }
  return [...counts.entries()]
    .map(([specialist_id, value]) => ({
      specialist_id,
      specialist_name: value.name,
      assigned: value.assigned,
      quota: quotaPerPerson,
    }))
    .sort((a, b) => a.specialist_id.localeCompare(b.specialist_id));
}

function physicalKeysDistinct(rotations: ActiveRotationRow[]): number {
  const keys = new Set<string>();
  for (const row of rotations) {
    const loc = row.store_locations;
    if (!loc?.department_id) {
      keys.add(String(row.location_id));
      continue;
    }
    keys.add(
      physicalBayKey({
        department_id: String(loc.department_id),
        aisle: loc.aisle ?? "",
        bay: loc.bay ?? 0,
      })
    );
  }
  return keys.size;
}

function planIsComplete(
  rotations: ActiveRotationRow[],
  assignments: Map<string, AssignmentRow>,
  eligibleCount: number,
  targetBays: number
): { complete: boolean; insufficient: boolean } {
  if (rotations.length === 0) {
    return { complete: false, insufficient: false };
  }
  if (rotations.length !== physicalKeysDistinct(rotations)) {
    return { complete: false, insufficient: false };
  }
  const perOwner = new Map<string, number>();
  for (const rotation of rotations) {
    const row = assignments.get(String(rotation.id));
    if (!isOwnedAssignment(row)) {
      return { complete: false, insufficient: false };
    }
    const owner = assignmentOwnerId(row!);
    perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
  }

  if (rotations.length < targetBays) {
    // Truthful short owed set — complete when every staged bay is owned.
    return { complete: true, insufficient: true };
  }

  if (rotations.length !== targetBays) {
    return { complete: false, insufficient: false };
  }

  if (perOwner.size !== eligibleCount) {
    return { complete: false, insufficient: false };
  }
  for (const count of perOwner.values()) {
    if (count !== BASE_WEEKLY_BAY_QUOTA) {
      return { complete: false, insufficient: false };
    }
  }
  return { complete: true, insufficient: false };
}

export type DispatchWeeklyPlanOptions = {
  weekLabel: string;
  store_id: string;
  store_number: string;
  /** When true, Force Draw style restage — destructive; not used by cron. */
  forceOverwrite?: boolean;
  /**
   * CAPACITY-GUARD-002 — shared store-week capacity. When omitted, loaded from
   * participating department codes (defaults to this department only).
   */
  storeWeekCapacity?: StoreWeekCapacitySnapshot;
  participating_department_codes?: readonly string[];
  /**
   * Test/harness override only — never from cron HTTP body or client headers.
   * Production activation uses resolveWeeklyRotationAutoPublishEnabled().
   */
  publishAssignments?: boolean;
};

/**
 * Idempotent Stage+Assign for one department / ISO week.
 *
 * Insufficient-labor decision (ENGINE-PROD-002): no product-authoritative
 * minimum-hours threshold exists (CAP-001 rejected capacity models; no Planning
 * Allowance). Eligible = known_available_hours > 0 → strict base quota 3.
 */
export async function dispatchWeeklyPlanForDepartment(
  supabase: SupabaseClient,
  department: Department,
  options: DispatchWeeklyPlanOptions
): Promise<SundayDispatchResult> {
  const weekLabel = options.weekLabel;
  const storeNumber = String(options.store_number ?? "").trim();
  const departmentCode = String(department.code ?? "").trim().toLowerCase();
  const base: SundayDispatchResult = {
    department_id: department.id,
    department_code: department.code,
    department_name: department.name,
    store_id: options.store_id,
    store_number: storeNumber,
    assigned_week: weekLabel,
    status: "ERROR",
    ok: false,
    eligible_count: 0,
    target_bays: 0,
    staged_count: 0,
    owned_count: 0,
    owners: 0,
    weekly_bay_target: resolveWeeklyBayTarget(department.weekly_bay_target),
  };

  try {
    const { count: locCount, error: locCountError } = await supabase
      .from("store_locations")
      .select("id", { count: "exact", head: true })
      .eq("department_id", department.id)
      .eq("is_active", true);
    if (locCountError) throw new Error(locCountError.message);
    if (!locCount) {
      return {
        ...base,
        status: "NO_MAPPED_LOCATIONS",
        ok: true,
        skipped: true,
        reason: "No mapped store locations",
      };
    }

    const range = isoWeekCalendarRange(weekLabel);
    let workforce: WeekLaborMemberInput[] = [];
    let shiftDays: Awaited<ReturnType<typeof loadShiftDays>> = [];
    let scheduleAvailable = true;
    let workforceAvailable = true;
    try {
      workforce = await loadWorkforce(supabase, storeNumber);
    } catch (err) {
      workforceAvailable = false;
      return {
        ...base,
        status: "INCOMPLETE_SCHEDULE",
        ok: false,
        reason:
          err instanceof Error
            ? `Workforce evidence unavailable: ${err.message}`
            : "Workforce evidence unavailable",
      };
    }
    try {
      shiftDays = await loadShiftDays(
        supabase,
        storeNumber,
        range.startDate,
        range.endDate
      );
    } catch (err) {
      scheduleAvailable = false;
      return {
        ...base,
        status: "INCOMPLETE_SCHEDULE",
        ok: false,
        reason:
          err instanceof Error
            ? `Schedule evidence unavailable: ${err.message}`
            : "Schedule evidence unavailable",
      };
    }

    const labor = composeWeekLaborAvailability({
      department: departmentCode,
      week_label: weekLabel,
      dates: range.dates,
      workforce,
      persisted_shift_days: shiftDays.map((row) => ({
        specialist_id: String(row.specialist_id),
        work_date: String(row.work_date),
        start_time: row.start_time,
        end_time: row.end_time,
        is_scheduled_today: row.is_scheduled_today !== false,
        is_call_out: row.is_call_out === true,
        status: row.status,
      })),
      workforce_evidence_available: workforceAvailable,
      schedule_evidence_available: scheduleAvailable,
      as_of: new Date().toISOString(),
    });

    if (labor.processing_status === "UNAVAILABLE") {
      return {
        ...base,
        status: "INCOMPLETE_SCHEDULE",
        ok: false,
        reason: "Weekly schedule evidence unavailable — refusing invented labor",
      };
    }

    const plannerMembers = weekLaborToPlannerMembers(labor.allocatable);
    const eligibleCount = plannerMembers.length;

    const participatingCodes =
      options.participating_department_codes &&
      options.participating_department_codes.length > 0
        ? options.participating_department_codes
        : [departmentCode];

    let storeCapacity =
      options.storeWeekCapacity ??
      (await loadStoreWeekCapacity(supabase, {
        store_number: storeNumber,
        week_label: weekLabel,
        department_codes: participatingCodes,
      }));

    // Department eligibility still drives who can own this dept's bays;
    // shared remaining caps how many new bays this store-week may stage.
    const targetBays = resolveDepartmentStageDrawCount({
      departmentEligibleCount: eligibleCount,
      capacity: storeCapacity,
    });

    base.eligible_count = eligibleCount;
    base.target_bays = targetBays;

    if (eligibleCount === 0) {
      return {
        ...base,
        status: "NO_ELIGIBLE_WORKFORCE",
        ok: false,
        reason:
          "No eligible associates with known ON_DUTY weekly hours (Master excluded; home department only)",
      };
    }

    let rotations = await loadActiveWeekRotations(
      supabase,
      department.id,
      weekLabel
    );
    let assignments = await loadWeekAssignments(
      supabase,
      storeNumber,
      departmentCode,
      weekLabel
    );

    const refreshState = async () => {
      rotations = await loadActiveWeekRotations(
        supabase,
        department.id,
        weekLabel
      );
      assignments = await loadWeekAssignments(
        supabase,
        storeNumber,
        departmentCode,
        weekLabel
      );
      storeCapacity = await loadStoreWeekCapacity(supabase, {
        store_number: storeNumber,
        week_label: weekLabel,
        department_codes: participatingCodes,
      });
    };

    const earlyComplete = planIsComplete(
      rotations,
      assignments,
      eligibleCount,
      // Completeness vs the department's natural eligible×3 when shared pool allows it.
      resolveAutomaticWeeklyBayTarget(eligibleCount, BASE_WEEKLY_BAY_QUOTA)
    );
    if (!options.forceOverwrite && earlyComplete.complete) {
      const loads = summarizeLoads(rotations, assignments, plannerMembers);
      return {
        ...base,
        status: earlyComplete.insufficient
          ? "INSUFFICIENT_BAYS"
          : "ALREADY_COMPLETE",
        ok: true,
        skipped: true,
        reason: earlyComplete.insufficient
          ? `Already complete short plan for ${weekLabel}: ${rotations.length}/${resolveAutomaticWeeklyBayTarget(eligibleCount, BASE_WEEKLY_BAY_QUOTA)} owed physical bays`
          : `Already complete weekly plan for ${weekLabel}`,
        staged_count: rotations.length,
        owned_count: rotations.length,
        owners: loads.filter((l) => l.assigned > 0).length,
        loads,
      };
    }

    if (
      !options.forceOverwrite &&
      rotations.length === 0 &&
      storeCapacity.remaining_shared <= 0
    ) {
      return {
        ...base,
        status: storeCapacity.over_capacity ? "PARTIAL" : "ALREADY_COMPLETE",
        ok: !storeCapacity.over_capacity,
        skipped: true,
        reason: storeCapacity.over_capacity
          ? `Store-week already over shared capacity (${storeCapacity.owned_total}/${storeCapacity.shared_target}) — refusing additive staging`
          : `Shared store-week capacity already filled (${storeCapacity.owned_total}/${storeCapacity.shared_target})`,
        staged_count: 0,
        owned_count: storeCapacity.owned_total,
        owners: Object.keys(storeCapacity.owned_by_specialist).length,
      };
    }

    let createdRotations = 0;
    let generated: GenerateRotationsResult | null = null;

    if (rotations.length === 0 || options.forceOverwrite) {
      const drawCount = targetBays;
      if (drawCount <= 0) {
        return {
          ...base,
          status: "ALREADY_COMPLETE",
          ok: true,
          skipped: true,
          reason: `No shared capacity remaining for ${weekLabel}`,
          staged_count: rotations.length,
          owned_count: storeCapacity.owned_total,
          owners: Object.keys(storeCapacity.owned_by_specialist).length,
        };
      }
      generated = await generateWeeklyRotations(
        supabase,
        department.id,
        drawCount,
        weekLabel,
        {
          skipIfExists: !options.forceOverwrite,
          forceOverwrite: options.forceOverwrite === true,
          store_id: options.store_id,
          store_number: storeNumber,
        }
      );
      if (generated.skipped && rotations.length === 0) {
        // Race: another writer staged between count and generate — reload.
        await refreshState();
      } else if (!generated.skipped) {
        createdRotations = generated.rotations.length;
        await refreshState();
      }
    }

    if (rotations.length === 0) {
      return {
        ...base,
        status: "ERROR",
        ok: false,
        reason:
          generated?.reason ||
          "No physical bays staged — map owed locations or finish ASSIGNED work",
        cycle_number: generated?.cycle_number,
        cycle_reset: generated?.cycle_reset,
      };
    }

    // Preserve valid ownership; only assign unowned staged bays.
    const ownedCounts = new Map<string, number>();
    const unowned: ActiveRotationRow[] = [];
    for (const rotation of rotations) {
      const row = assignments.get(String(rotation.id));
      if (isOwnedAssignment(row)) {
        const owner = assignmentOwnerId(row!);
        ownedCounts.set(owner, (ownedCounts.get(owner) ?? 0) + 1);
      } else {
        unowned.push(rotation);
      }
    }

    const naturalTarget = resolveAutomaticWeeklyBayTarget(
      eligibleCount,
      BASE_WEEKLY_BAY_QUOTA
    );

    if (unowned.length === 0) {
      const loads = summarizeLoads(rotations, assignments, plannerMembers);
      const complete = planIsComplete(
        rotations,
        assignments,
        eligibleCount,
        naturalTarget
      );
      if (complete.complete) {
        return {
          ...base,
          status: complete.insufficient
            ? "INSUFFICIENT_BAYS"
            : "ALREADY_COMPLETE",
          ok: true,
          skipped: true,
          reason: `Already complete weekly plan for ${weekLabel}`,
          staged_count: rotations.length,
          owned_count: rotations.length,
          owners: loads.filter((l) => l.assigned > 0).length,
          created_rotations: createdRotations,
          loads,
          cycle_number: generated?.cycle_number,
          cycle_reset: generated?.cycle_reset,
        };
      }
      return {
        ...base,
        status: "PARTIAL",
        ok: false,
        reason:
          "Staged bays are owned but the plan does not match the normal three-bay base quota; refusing destructive rewrite",
        staged_count: rotations.length,
        owned_count: rotations.length,
        owners: loads.filter((l) => l.assigned > 0).length,
        created_rotations: createdRotations,
        loads,
      };
    }

    const publishAssignments = resolveWeeklyRotationAutoPublishEnabled({
      override: options.publishAssignments === true,
    });

    const protectedIds = collectProtectedRotationIds(assignments);
    const fillableUnowned = unowned.filter(
      (r) => !protectedIds.has(String(r.id))
    );

    // AUTO-003: product latch OFF → stage only; preserve owners + supervisor locks.
    if (!publishAssignments) {
      const loads = summarizeLoads(rotations, assignments, plannerMembers);
      const ownedCount = rotations.length - unowned.length;
      const stageNote =
        generated?.stage_mode === "section_balanced"
          ? generated.reason || "section-balanced stage"
          : "stage complete";
      const visibility = composeWeekPublicationVisibility({
        week_label: weekLabel,
        staged: rotations.map((r) => ({
          id: String(r.id),
          aisle: normalizeAisle(r.store_locations?.aisle ?? ""),
          bay: Number(r.store_locations?.bay) || 0,
          is_completed: r.is_completed === true,
        })),
        assignmentsByBayId: assignments,
        approved_capacity_total: storeCapacity.shared_target,
        shortfall_notes: generated?.stage_shortfalls ?? [],
      });
      const publicationSummary = summarizePublicationResult({
        visibility,
        created_assignments: 0,
        auto_publish_enabled: false,
      });
      return {
        ...base,
        status: "STAGED_AWAITING_ASSIGN",
        ok: true,
        reason: `${stageNote}. WEEKLY_ROTATION_AUTO_PUBLISH latch is OFF — confirm Assign this week (stewardship) to persist owners. ${publicationSummary}. Protected ${protectedIds.size}; fillable unowned ${fillableUnowned.length}.`,
        publication_summary: publicationSummary,
        staged_count: rotations.length,
        owned_count: ownedCount,
        owners: ownedCounts.size,
        created_rotations: createdRotations,
        created_assignments: 0,
        loads,
        cycle_number: generated?.cycle_number,
        cycle_reset: generated?.cycle_reset,
      };
    }

    // Authoritative assign path (same composer as Sunday UI Assign this week).
    const stageCtx = await loadAuthoritativeStageContext(supabase, {
      store_id: options.store_id,
      store_number: storeNumber,
      week_label: weekLabel,
      department_id: department.id,
      department_codes: participatingCodes,
    });
    if (!stageCtx) {
      return {
        ...base,
        status: "PARTIAL",
        ok: false,
        reason:
          "Cannot publish assignments — approved capacity and Operational Section ownership evidence required",
        staged_count: rotations.length,
        owned_count: rotations.length - unowned.length,
        owners: ownedCounts.size,
        created_rotations: createdRotations,
        loads: summarizeLoads(rotations, assignments, plannerMembers),
      };
    }

    if (fillableUnowned.length === 0) {
      const loads = summarizeLoads(rotations, assignments, plannerMembers);
      const ownedCount = rotations.filter((r) =>
        isOwnedAssignment(assignments.get(String(r.id)))
      ).length;
      return {
        ...base,
        status: ownedCount === rotations.length ? "ALREADY_COMPLETE" : "PARTIAL",
        ok: ownedCount === rotations.length,
        skipped: ownedCount === rotations.length,
        reason:
          ownedCount === rotations.length
            ? `Already complete weekly plan for ${weekLabel} (supervisor locks preserved)`
            : `No fillable unowned bays remain (${protectedIds.size} protected by ownership/supervisor lock)`,
        staged_count: rotations.length,
        owned_count: ownedCount,
        owners: loads.filter((l) => l.assigned > 0).length,
        created_rotations: createdRotations,
        created_assignments: 0,
        loads,
        cycle_number: generated?.cycle_number,
        cycle_reset: generated?.cycle_reset,
      };
    }

    const stagedForAssign = rotations.map((r) => {
      const loc = r.store_locations;
      return {
        id: String(r.id),
        department_id: String(loc?.department_id ?? department.id),
        aisle: normalizeAisle(loc?.aisle ?? ""),
        bay: Number(loc?.bay) || 0,
      };
    });

    const proposal = composeAuthoritativeAssignmentProposal({
      store_number: storeNumber,
      week_label: weekLabel,
      staged: stagedForAssign,
      ownedRotationIds: protectedIds,
      members: plannerMembers,
      baySectionByKey: stageCtx.baySectionByKey,
      capacity: storeCapacity,
    });

    const safeItems = filterProposalAwayFromProtected(
      proposal.items,
      protectedIds
    );

    if (!proposal.actionable || safeItems.length === 0) {
      return {
        ...base,
        status: "PARTIAL",
        ok: false,
        reason:
          proposal.block_reason ||
          "Stewardship proposal could not allocate owners for unowned staged bays (section capacity / eligibility)",
        staged_count: rotations.length,
        owned_count: rotations.length - unowned.length,
        owners: ownedCounts.size,
        created_rotations: createdRotations,
        loads: summarizeLoads(rotations, assignments, plannerMembers),
      };
    }

    const filtered = filterPlanItemsToCapacity(safeItems, storeCapacity);
    const filteredItems = filtered.accepted;

    let createdAssignments = 0;
    if (filteredItems.length > 0) {
      createdAssignments = await applySundayAssignmentPlanAdmin(
        supabase,
        weekLabel,
        filteredItems,
        storeNumber,
        departmentCode,
        {
          shared_target: storeCapacity.shared_target,
          quota_per_person: BASE_WEEKLY_BAY_QUOTA,
          participating_department_codes: participatingCodes,
        }
      );
      try {
        await clearSupervisorLocksForPublishedBays(supabase, {
          store_number: storeNumber,
          week_starting: isoWeekToMondayDate(weekLabel),
          bay_ids: filteredItems.map((i) => String(i.rotationId)),
        });
      } catch {
        // Column may be absent pre-migrate — publish still succeeded.
      }
    }

    await refreshState();
    const loads = summarizeLoads(rotations, assignments, plannerMembers);
    const ownedCount = rotations.filter((r) =>
      isOwnedAssignment(assignments.get(String(r.id)))
    ).length;
    const unownedLeft = rotations.length - ownedCount;
    const distinctOwners = loads.filter((l) => l.assigned > 0).length;
    const visibility = composeWeekPublicationVisibility({
      week_label: weekLabel,
      staged: rotations.map((r) => ({
        id: String(r.id),
        aisle: normalizeAisle(r.store_locations?.aisle ?? ""),
        bay: Number(r.store_locations?.bay) || 0,
        is_completed: r.is_completed === true,
      })),
      assignmentsByBayId: assignments,
      approved_capacity_total: storeCapacity.shared_target,
      shortfall_notes: generated?.stage_shortfalls ?? [],
    });
    const summary = summarizePublicationResult({
      visibility,
      created_assignments: createdAssignments,
      auto_publish_enabled: true,
    });

    if (unownedLeft > 0) {
      return {
        ...base,
        status: "PARTIAL",
        ok: false,
        reason: `Partial ownership: ${ownedCount}/${rotations.length} staged physical bays owned (strict section ownership; no cross-section fill). ${summary}`,
        publication_summary: summary,
        staged_count: rotations.length,
        owned_count: ownedCount,
        owners: distinctOwners,
        created_rotations: createdRotations,
        created_assignments: createdAssignments,
        loads,
        cycle_number: generated?.cycle_number,
        cycle_reset: generated?.cycle_reset,
      };
    }

    // Completeness uses the shared-capped draw target for this department pass.
    const insufficient = rotations.length < targetBays;
    const atQuota = loads.filter(
      (l) => l.assigned === BASE_WEEKLY_BAY_QUOTA
    ).length;
    const perfect =
      !insufficient &&
      distinctOwners === eligibleCount &&
      atQuota === eligibleCount;

    if (insufficient) {
      return {
        ...base,
        status: "INSUFFICIENT_BAYS",
        ok: true,
        reason: `Only ${rotations.length} owed physical bays available for ${eligibleCount} eligible associates (target ${targetBays}; shared ${storeCapacity.shared_target}). ${summary}`,
        publication_summary: summary,
        staged_count: rotations.length,
        owned_count: ownedCount,
        owners: distinctOwners,
        created_rotations: createdRotations,
        created_assignments: createdAssignments,
        loads,
        cycle_number: generated?.cycle_number,
        cycle_reset: generated?.cycle_reset,
      };
    }

    if (!perfect) {
      // Shared pool may intentionally leave this department below natural ×3.
      if (
        ownedCount === rotations.length &&
        storeCapacity.owned_total >= storeCapacity.shared_target
      ) {
        return {
          ...base,
          status: "COMPLETE",
          ok: true,
          reason: `Shared store-week capacity filled (${storeCapacity.owned_total}/${storeCapacity.shared_target}). ${summary}`,
          publication_summary: summary,
          staged_count: rotations.length,
          owned_count: ownedCount,
          owners: distinctOwners,
          created_rotations: createdRotations,
          created_assignments: createdAssignments,
          loads,
          cycle_number: generated?.cycle_number,
          cycle_reset: generated?.cycle_reset,
        };
      }
      return {
        ...base,
        status: "PARTIAL",
        ok: false,
        reason: `Ownership persisted but loads do not match the normal three-bay base quota. ${summary}`,
        publication_summary: summary,
        staged_count: rotations.length,
        owned_count: ownedCount,
        owners: distinctOwners,
        created_rotations: createdRotations,
        created_assignments: createdAssignments,
        loads,
        cycle_number: generated?.cycle_number,
        cycle_reset: generated?.cycle_reset,
      };
    }

    return {
      ...base,
      status: "COMPLETE",
      ok: true,
      reason: `Complete weekly plan: ${eligibleCount} × ${BASE_WEEKLY_BAY_QUOTA} physical bays (shared target ${storeCapacity.shared_target}). ${summary}`,
      publication_summary: summary,
      staged_count: rotations.length,
      owned_count: ownedCount,
      owners: distinctOwners,
      created_rotations: createdRotations,
      created_assignments: createdAssignments,
      loads,
      cycle_number: generated?.cycle_number,
      cycle_reset: generated?.cycle_reset,
    };
  } catch (err) {
    return {
      ...base,
      status: "ERROR",
      ok: false,
      reason: err instanceof Error ? err.message : "Unknown dispatch error",
    };
  }
}

/**
 * Sunday cron entry: Stage+Assign for every active store/department whose
 * Sunday gate is open. Never force-overwrites a complete plan.
 */
export async function runSundayDispatchForAllDepartments(
  supabase: SupabaseClient,
  weekLabel?: string,
  now: Date = new Date()
): Promise<SundayDispatchResult[]> {
  const stores = await listActiveStores(supabase);
  const results: SundayDispatchResult[] = [];

  for (const store of stores) {
    const decision = evaluateSundayAutoRun(store, now);
    const targetWeek = weekLabel ?? decision.weekLabel;

    if (!decision.run) {
      results.push({
        department_id: store.id,
        department_code: "_schedule",
        department_name: store.name || `Store ${store.store_number}`,
        store_id: store.id,
        store_number: store.store_number,
        assigned_week: targetWeek,
        status: "SKIPPED_SCHEDULE",
        ok: true,
        skipped: true,
        reason: decision.reason,
        eligible_count: 0,
        target_bays: 0,
        staged_count: 0,
        owned_count: 0,
        owners: 0,
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

    const activeDepartments = (departments ?? []) as Department[];
    const participatingCodes = activeDepartments.map((d) =>
      String(d.code ?? "")
        .trim()
        .toLowerCase()
    );

    // Shared capacity across all active departments for this store-week.
    // Does not activate inactive departments — only those already is_active.
    let storeWeekCapacity = await loadStoreWeekCapacity(supabase, {
      store_number: store.store_number,
      week_label: targetWeek,
      department_codes: participatingCodes,
    });

    for (const dept of activeDepartments) {
      const result = await dispatchWeeklyPlanForDepartment(supabase, dept, {
        weekLabel: targetWeek,
        store_id: store.id,
        store_number: store.store_number,
        storeWeekCapacity,
        participating_department_codes: participatingCodes,
      });
      if (decision.reason && result.status === "COMPLETE") {
        result.reason = `${result.reason ?? "Complete"}; ${decision.reason}`;
      }
      results.push(result);

      // Refresh shared remaining before the next department pass.
      storeWeekCapacity = await loadStoreWeekCapacity(supabase, {
        store_number: store.store_number,
        week_label: targetWeek,
        department_codes: participatingCodes,
      });
    }
  }

  return results;
}
