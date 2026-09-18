/**
 * ENGINE-PROD-003 — Manual extra-bay dispatch (+1).
 *
 * After a complete base weekly plan exists (ENGINE-PROD-002: eligible × 3),
 * a DS may deliberately give one associate one additional owed physical bay.
 *
 * Does NOT change BASE_WEEKLY_BAY_QUOTA.
 * Does NOT redraw / rebalance / redistribute existing ownership.
 * Does NOT invoke Sunday dispatch or the proportional planner.
 *
 * Reuses: selectPhysicalBayCoverage, assignLocationsToCurrentWeek,
 * applySundayAssignmentPlanAdmin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { storeNumberQueryValues } from "@/lib/store";
import { departmentCodeQueryValues } from "@/lib/store-ops/department-codes";
import { associateMatchesSundayDepartment } from "@/lib/store-ops/sunday-audit";
import {
  physicalBayKey,
  selectPhysicalBayCoverage,
  type PhysicalBaySelection,
} from "@/lib/store-ops/physical-bay";
import {
  assignLocationsToCurrentWeek,
  loadOwedLocationPools,
} from "@/lib/store-ops/rotations";
import { applySundayAssignmentPlanAdmin } from "@/lib/store-ops/sunday-dispatch";
import { BASE_WEEKLY_BAY_QUOTA } from "@/lib/store-ops/weekly-rotations";
import { isoWeekLabel, isoWeekToMondayDate } from "@/lib/store-ops/week";
import type { StoreLocation } from "@/lib/store-ops/types";
import type { DepartmentScope } from "@/lib/types";

export { BASE_WEEKLY_BAY_QUOTA };

export type ExtraBayDispatchStatus =
  | "COMPLETE"
  | "ALREADY_COMPLETE"
  | "NO_BASE_PLAN"
  | "INCOMPLETE_BASE_PLAN"
  | "ASSOCIATE_NOT_ELIGIBLE"
  | "ASSOCIATE_NOT_IN_PLAN"
  | "NO_OWED_BAYS"
  | "BAY_ALREADY_OWNED"
  | "PARTIAL"
  | "ERROR";

export type ExtraBayDispatchResult = {
  status: ExtraBayDispatchStatus;
  ok: boolean;
  reason?: string;
  assigned_week: string;
  department_id: string;
  specialist_id: string;
  physical_bay_key?: string;
  location_id?: string;
  rotation_id?: string;
  aisle?: string | number;
  bay?: number | string;
  owner_count_before?: number;
  owner_count_after?: number;
  staged?: boolean;
  owned?: boolean;
};

export type ExtraBayDispatchOptions = {
  department_id: string;
  department_code: string;
  store_id: string;
  store_number: string;
  specialist_id: string;
  specialist_name?: string;
  /** When set, dispatch this surface (idempotent). When omitted, select next owed. */
  location_id?: string;
  weekLabel?: string;
  staging_department?: DepartmentScope;
};

type ActiveRotationRow = {
  id: string;
  location_id: string;
  assigned_week: string;
  is_completed?: boolean | null;
  verification_status?: string | null;
  store_locations?: {
    id?: string;
    aisle?: string | number | null;
    bay?: number | string | null;
    department_id?: string | null;
    type?: string | null;
  } | null;
};

type AssignmentRow = {
  bay_id: string;
  roster_specialist_id?: string | null;
  assigned_specialist_id?: string | null;
  specialist_name?: string | null;
  status?: string | null;
};

function isStandardAisleLocation(loc: StoreLocation): boolean {
  return (loc.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT";
}

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

function rotationPhysicalKey(row: ActiveRotationRow): string | null {
  const loc = row.store_locations;
  if (!loc || loc.aisle == null || loc.bay == null) return null;
  const departmentId = String(loc.department_id ?? "").trim();
  if (!departmentId) return null;
  return physicalBayKey({
    department_id: departmentId,
    aisle: loc.aisle,
    bay: loc.bay,
  });
}

async function loadActiveWeekRotations(
  supabase: SupabaseClient,
  departmentId: string,
  weekLabel: string
): Promise<ActiveRotationRow[]> {
  const primary = await supabase
    .from("weekly_rotations")
    .select(
      "id, location_id, assigned_week, is_completed, verification_status, store_locations ( id, aisle, bay, department_id, type )"
    )
    .eq("department_id", departmentId)
    .eq("assigned_week", weekLabel)
    .is("superseded_at", null);

  if (primary.error && /superseded_at/i.test(primary.error.message)) {
    const fallback = await supabase
      .from("weekly_rotations")
      .select(
        "id, location_id, assigned_week, is_completed, verification_status, store_locations ( id, aisle, bay, department_id, type )"
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
  const { data, error } = await supabase
    .from("sunday_bay_assignments")
    .select(
      "bay_id, roster_specialist_id, assigned_specialist_id, specialist_name, status"
    )
    .in("store_number", storeKeys)
    .in("department", deptKeys)
    .eq("week_starting", weekStarting);

  if (error) throw new Error(error.message);
  const map = new Map<string, AssignmentRow>();
  for (const row of (data ?? []) as AssignmentRow[]) {
    const bayId = String(row.bay_id ?? "").trim();
    if (!bayId) continue;
    map.set(bayId, row);
  }
  return map;
}

function ownerCounts(
  rotations: ActiveRotationRow[],
  assignments: Map<string, AssignmentRow>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rotation of rotations) {
    const row = assignments.get(String(rotation.id));
    if (!isOwnedAssignment(row)) continue;
    const owner = assignmentOwnerId(row!);
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pure: select the next owed physical bay using the same selector as Sunday draw.
 * Excludes physical keys already present in the active week.
 */
export function selectNextExtraPhysicalBay(
  pending: StoreLocation[],
  carried: StoreLocation[],
  excludePhysicalKeys: Iterable<string>
): PhysicalBaySelection | null {
  const exclude = new Set(excludePhysicalKeys);
  const pendingFiltered = pending.filter((loc) => {
    if (!isStandardAisleLocation(loc)) return false;
    const key = physicalBayKey(loc);
    return !exclude.has(key);
  });
  const carriedFiltered = carried.filter((loc) => {
    if (!isStandardAisleLocation(loc)) return false;
    const key = physicalBayKey(loc);
    return !exclude.has(key);
  });
  const selected = selectPhysicalBayCoverage(
    pendingFiltered,
    carriedFiltered,
    1
  );
  return selected[0] ?? null;
}

export function isPendingVerificationRotation(
  rotation: ActiveRotationRow
): boolean {
  const vs = String(rotation.verification_status ?? "")
    .trim()
    .toUpperCase();
  if (vs === "PENDING_VERIFICATION" || vs === "PENDING") {
    // ACTIVE week rows use verification PENDING until reported; only block
    // when the rotation was reported complete awaiting DS review.
    return rotation.is_completed === true || vs === "PENDING_VERIFICATION";
  }
  return false;
}

/**
 * Base plan is ready for +1 when every active rotation is owned and the
 * target associate already holds at least the base quota (participating).
 */
export function assessExtraBayBasePlan(input: {
  rotations: ActiveRotationRow[];
  assignments: Map<string, AssignmentRow>;
  specialistId: string;
}): {
  ready: boolean;
  status?: ExtraBayDispatchStatus;
  reason?: string;
  unowned: ActiveRotationRow[];
  ownerCount: number;
} {
  const { rotations, assignments, specialistId } = input;
  if (rotations.length === 0) {
    return {
      ready: false,
      status: "NO_BASE_PLAN",
      reason:
        "No current weekly plan. Run Sunday dispatch or Assign this week first.",
      unowned: [],
      ownerCount: 0,
    };
  }

  const unowned = rotations.filter(
    (r) => !isOwnedAssignment(assignments.get(String(r.id)))
  );
  if (unowned.length > 0) {
    return {
      ready: false,
      status: "INCOMPLETE_BASE_PLAN",
      reason:
        "Current week has staged bays without owners. Finish Assign this week (or Sunday recovery) before adding another bay.",
      unowned,
      ownerCount: 0,
    };
  }

  const counts = ownerCounts(rotations, assignments);
  const ownerCount = counts.get(specialistId) ?? 0;
  if (ownerCount < BASE_WEEKLY_BAY_QUOTA) {
    return {
      ready: false,
      status: "ASSOCIATE_NOT_IN_PLAN",
      reason: `Associate must already own the base ${BASE_WEEKLY_BAY_QUOTA} physical bays before receiving an extra bay.`,
      unowned: [],
      ownerCount,
    };
  }

  return { ready: true, unowned: [], ownerCount };
}

async function loadSpecialist(
  supabase: SupabaseClient,
  specialistId: string,
  storeNumber: string
): Promise<{
  id: string;
  name: string;
  role: string;
  is_active: boolean;
  home_department?: string | null;
  assigned_department?: string | null;
  floor_title?: string | null;
} | null> {
  const { data, error } = await supabase
    .from("store_specialists")
    .select(
      "id, name, role, is_active, home_department, assigned_department, floor_title, store_number"
    )
    .eq("id", specialistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const rowStore = String(data.store_number ?? "").trim();
  if (rowStore && rowStore !== String(storeNumber).trim()) return null;
  return {
    id: String(data.id),
    name: String(data.name ?? ""),
    role: String(data.role ?? "Associate"),
    is_active: data.is_active !== false,
    home_department: data.home_department as string | null | undefined,
    assigned_department: data.assigned_department as string | null | undefined,
    floor_title: data.floor_title as string | null | undefined,
  };
}

function findRotationForLocation(
  rotations: ActiveRotationRow[],
  locationId: string,
  physicalKey: string | null
): ActiveRotationRow | undefined {
  const byLoc = rotations.find((r) => String(r.location_id) === locationId);
  if (byLoc) return byLoc;
  if (!physicalKey) return undefined;
  return rotations.find((r) => rotationPhysicalKey(r) === physicalKey);
}

/**
 * Suggest the next owed physical bay for a +1 (read-only selection).
 */
export async function suggestExtraPhysicalBay(
  supabase: SupabaseClient,
  options: Omit<ExtraBayDispatchOptions, "specialist_name">
): Promise<{
  ok: boolean;
  status: ExtraBayDispatchStatus;
  reason?: string;
  selection?: {
    location_id: string;
    physical_bay_key: string;
    aisle: string | number;
    bay: number | string;
  };
  assigned_week: string;
  owner_count?: number;
}> {
  const weekLabel = options.weekLabel ?? isoWeekLabel();
  const specialistId = String(options.specialist_id ?? "").trim();
  const base = {
    assigned_week: weekLabel,
    status: "ERROR" as ExtraBayDispatchStatus,
    ok: false,
  };

  try {
    const member = await loadSpecialist(
      supabase,
      specialistId,
      options.store_number
    );
    if (!member || !member.is_active || member.role === "MasterAdmin") {
      return {
        ...base,
        status: "ASSOCIATE_NOT_ELIGIBLE",
        reason: "Associate is inactive, missing, or not eligible for weekly work.",
      };
    }
    const staging =
      options.staging_department ??
      (String(options.department_code || "flooring").toLowerCase() as DepartmentScope);
    if (!associateMatchesSundayDepartment(member as Parameters<typeof associateMatchesSundayDepartment>[0], staging)) {
      return {
        ...base,
        status: "ASSOCIATE_NOT_ELIGIBLE",
        reason: "Associate home department does not match this weekly plan.",
      };
    }

    const rotations = await loadActiveWeekRotations(
      supabase,
      options.department_id,
      weekLabel
    );
    const assignments = await loadWeekAssignments(
      supabase,
      options.store_number,
      options.department_code,
      weekLabel
    );
    const assessment = assessExtraBayBasePlan({
      rotations,
      assignments,
      specialistId,
    });
    if (!assessment.ready) {
      return {
        ...base,
        status: assessment.status ?? "INCOMPLETE_BASE_PLAN",
        reason: assessment.reason,
        owner_count: assessment.ownerCount,
      };
    }

    const exclude = new Set(
      rotations
        .map(rotationPhysicalKey)
        .filter((k): k is string => Boolean(k))
    );
    const pools = await loadOwedLocationPools(supabase, options.department_id);
    const next = selectNextExtraPhysicalBay(
      pools.pending,
      pools.carried,
      exclude
    );
    if (!next) {
      return {
        ...base,
        status: "NO_OWED_BAYS",
        reason: "No additional owed physical bays are available this cycle.",
        owner_count: assessment.ownerCount,
      };
    }

    return {
      ok: true,
      status: "COMPLETE",
      assigned_week: weekLabel,
      owner_count: assessment.ownerCount,
      selection: {
        location_id: next.representative.id,
        physical_bay_key: next.key,
        aisle: next.representative.aisle,
        bay: next.representative.bay,
      },
    };
  } catch (err) {
    return {
      ...base,
      status: "ERROR",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Stage one owed physical bay (if needed) and persist ownership for one associate.
 */
export async function dispatchExtraPhysicalBay(
  supabase: SupabaseClient,
  options: ExtraBayDispatchOptions
): Promise<ExtraBayDispatchResult> {
  const weekLabel = options.weekLabel ?? isoWeekLabel();
  const specialistId = String(options.specialist_id ?? "").trim();
  const base: ExtraBayDispatchResult = {
    status: "ERROR",
    ok: false,
    assigned_week: weekLabel,
    department_id: options.department_id,
    specialist_id: specialistId,
  };

  try {
    const member = await loadSpecialist(
      supabase,
      specialistId,
      options.store_number
    );
    if (!member || !member.is_active || member.role === "MasterAdmin") {
      return {
        ...base,
        status: "ASSOCIATE_NOT_ELIGIBLE",
        reason: "Associate is inactive, missing, or not eligible for weekly work.",
      };
    }
    const staging =
      options.staging_department ??
      (String(options.department_code || "flooring").toLowerCase() as DepartmentScope);
    if (!associateMatchesSundayDepartment(member as Parameters<typeof associateMatchesSundayDepartment>[0], staging)) {
      return {
        ...base,
        status: "ASSOCIATE_NOT_ELIGIBLE",
        reason: "Associate home department does not match this weekly plan.",
      };
    }

    const specialistName =
      String(options.specialist_name ?? "").trim() || member.name || "Associate";

    let rotations = await loadActiveWeekRotations(
      supabase,
      options.department_id,
      weekLabel
    );
    let assignments = await loadWeekAssignments(
      supabase,
      options.store_number,
      options.department_code,
      weekLabel
    );

    const requestedLocationId = String(options.location_id ?? "").trim();

    // Idempotent / partial path when a specific bay is requested.
    if (requestedLocationId) {
      const { data: loc, error: locErr } = await supabase
        .from("store_locations")
        .select("*")
        .eq("id", requestedLocationId)
        .eq("department_id", options.department_id)
        .maybeSingle();
      if (locErr) throw new Error(locErr.message);
      if (!loc) {
        return {
          ...base,
          status: "NO_OWED_BAYS",
          reason: "Requested bay was not found in this department.",
        };
      }
      if (!isStandardAisleLocation(loc as StoreLocation)) {
        return {
          ...base,
          status: "NO_OWED_BAYS",
          reason: "Showroom / stack-out bays are not weekly aisle assignments.",
        };
      }

      const physKey = physicalBayKey(loc as StoreLocation);
      const existing = findRotationForLocation(
        rotations,
        requestedLocationId,
        physKey
      );

      if (existing) {
        if (isPendingVerificationRotation(existing)) {
          return {
            ...base,
            status: "BAY_ALREADY_OWNED",
            reason: "That bay is pending verification and cannot be reassigned here.",
            rotation_id: existing.id,
            physical_bay_key: physKey,
            location_id: String(existing.location_id),
          };
        }
        const owned = assignments.get(String(existing.id));
        if (isOwnedAssignment(owned)) {
          const owner = assignmentOwnerId(owned!);
          if (owner === specialistId) {
            const counts = ownerCounts(rotations, assignments);
            return {
              ...base,
              status: "ALREADY_COMPLETE",
              ok: true,
              reason: "Associate already owns this physical bay this week.",
              rotation_id: existing.id,
              physical_bay_key: physKey,
              location_id: String(existing.location_id),
              aisle: existing.store_locations?.aisle ?? loc.aisle,
              bay: existing.store_locations?.bay ?? loc.bay,
              owner_count_before: counts.get(specialistId),
              owner_count_after: counts.get(specialistId),
              staged: false,
              owned: true,
            };
          }
          return {
            ...base,
            status: "BAY_ALREADY_OWNED",
            reason: "That physical bay is already owned by someone else this week.",
            rotation_id: existing.id,
            physical_bay_key: physKey,
            location_id: String(existing.location_id),
          };
        }

        // Staged but unowned — complete ownership only (partial recovery).
        try {
          await applySundayAssignmentPlanAdmin(
            supabase,
            weekLabel,
            [
              {
                rotationId: existing.id,
                specialist_id: specialistId,
                specialist_name: specialistName,
              },
            ],
            options.store_number,
            options.department_code
          );
        } catch (err) {
          return {
            ...base,
            status: "PARTIAL",
            ok: false,
            reason: `Bay is staged but ownership could not be saved: ${
              err instanceof Error ? err.message : String(err)
            }`,
            rotation_id: existing.id,
            physical_bay_key: physKey,
            location_id: String(existing.location_id),
            staged: true,
            owned: false,
          };
        }

        assignments = await loadWeekAssignments(
          supabase,
          options.store_number,
          options.department_code,
          weekLabel
        );
        const counts = ownerCounts(rotations, assignments);
        return {
          ...base,
          status: "COMPLETE",
          ok: true,
          reason: "Completed ownership for previously staged physical bay.",
          rotation_id: existing.id,
          physical_bay_key: physKey,
          location_id: String(existing.location_id),
          aisle: existing.store_locations?.aisle ?? loc.aisle,
          bay: existing.store_locations?.bay ?? loc.bay,
          owner_count_before: (counts.get(specialistId) ?? 1) - 1,
          owner_count_after: counts.get(specialistId) ?? 1,
          staged: false,
          owned: true,
        };
      }

      // Not yet staged — require base plan, then stage+own this bay.
      const assessment = assessExtraBayBasePlan({
        rotations,
        assignments,
        specialistId,
      });
      if (!assessment.ready) {
        return {
          ...base,
          status: assessment.status ?? "INCOMPLETE_BASE_PLAN",
          reason: assessment.reason,
          owner_count_before: assessment.ownerCount,
        };
      }

      const stageResult = await assignLocationsToCurrentWeek(
        supabase,
        options.department_id,
        [requestedLocationId],
        weekLabel,
        { store_id: options.store_id, store_number: options.store_number }
      );
      const rotation = stageResult.rotations[0];
      if (!rotation?.id) {
        return {
          ...base,
          status: "PARTIAL",
          ok: false,
          reason: "Staging did not return a weekly rotation row.",
          physical_bay_key: physKey,
          location_id: requestedLocationId,
          staged: false,
          owned: false,
        };
      }

      try {
        await applySundayAssignmentPlanAdmin(
          supabase,
          weekLabel,
          [
            {
              rotationId: String(rotation.id),
              specialist_id: specialistId,
              specialist_name: specialistName,
            },
          ],
          options.store_number,
          options.department_code
        );
      } catch (err) {
        return {
          ...base,
          status: "PARTIAL",
          ok: false,
          reason: `Bay staged but ownership could not be saved: ${
            err instanceof Error ? err.message : String(err)
          }. Retry with the same bay to finish ownership.`,
          rotation_id: String(rotation.id),
          physical_bay_key: physKey,
          location_id: requestedLocationId,
          aisle: loc.aisle,
          bay: loc.bay,
          owner_count_before: assessment.ownerCount,
          staged: true,
          owned: false,
        };
      }

      return {
        ...base,
        status: "COMPLETE",
        ok: true,
        reason: "Extra physical bay staged and owned.",
        rotation_id: String(rotation.id),
        physical_bay_key: physKey,
        location_id: requestedLocationId,
        aisle: loc.aisle,
        bay: loc.bay,
        owner_count_before: assessment.ownerCount,
        owner_count_after: assessment.ownerCount + 1,
        staged: true,
        owned: true,
      };
    }

    // No location_id — require complete base plan, then select next owed bay.
    const assessment = assessExtraBayBasePlan({
      rotations,
      assignments,
      specialistId,
    });
    if (!assessment.ready) {
      // Single unowned residue after a prior partial +1: complete for this owner.
      if (
        assessment.status === "INCOMPLETE_BASE_PLAN" &&
        assessment.unowned.length === 1
      ) {
        const residue = assessment.unowned[0];
        const othersOwned = rotations
          .filter((r) => r.id !== residue.id)
          .every((r) => isOwnedAssignment(assignments.get(String(r.id))));
        const priorCounts = ownerCounts(rotations, assignments);
        const priorOwnerCount = priorCounts.get(specialistId) ?? 0;
        if (othersOwned && priorOwnerCount >= BASE_WEEKLY_BAY_QUOTA) {
          try {
            await applySundayAssignmentPlanAdmin(
              supabase,
              weekLabel,
              [
                {
                  rotationId: residue.id,
                  specialist_id: specialistId,
                  specialist_name: specialistName,
                },
              ],
              options.store_number,
              options.department_code
            );
          } catch (err) {
            return {
              ...base,
              status: "PARTIAL",
              ok: false,
              reason: `Staged bay ownership could not be saved: ${
                err instanceof Error ? err.message : String(err)
              }`,
              rotation_id: residue.id,
              location_id: String(residue.location_id),
              physical_bay_key: rotationPhysicalKey(residue) ?? undefined,
              staged: true,
              owned: false,
            };
          }
          return {
            ...base,
            status: "COMPLETE",
            ok: true,
            reason: "Completed ownership for previously staged extra bay.",
            rotation_id: residue.id,
            location_id: String(residue.location_id),
            physical_bay_key: rotationPhysicalKey(residue) ?? undefined,
            aisle: residue.store_locations?.aisle ?? undefined,
            bay: residue.store_locations?.bay ?? undefined,
            owner_count_before: priorOwnerCount,
            owner_count_after: priorOwnerCount + 1,
            staged: false,
            owned: true,
          };
        }
      }

      return {
        ...base,
        status: assessment.status ?? "INCOMPLETE_BASE_PLAN",
        reason: assessment.reason,
        owner_count_before: assessment.ownerCount,
      };
    }

    const exclude = new Set(
      rotations
        .map(rotationPhysicalKey)
        .filter((k): k is string => Boolean(k))
    );
    const pools = await loadOwedLocationPools(supabase, options.department_id);
    const next = selectNextExtraPhysicalBay(
      pools.pending,
      pools.carried,
      exclude
    );
    if (!next) {
      return {
        ...base,
        status: "NO_OWED_BAYS",
        reason: "No additional owed physical bays are available this cycle.",
        owner_count_before: assessment.ownerCount,
      };
    }

    // Recurse with concrete location_id for a single write path.
    return dispatchExtraPhysicalBay(supabase, {
      ...options,
      location_id: next.representative.id,
      specialist_name: specialistName,
      weekLabel,
    });
  } catch (err) {
    return {
      ...base,
      status: "ERROR",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
