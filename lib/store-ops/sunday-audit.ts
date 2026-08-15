/**
 * Sunday Flooring Cycle Audit staging + specialist assignment.
 * Composes weekly_rotations (bay engine); assignments persist in sunday_bay_assignments.
 */

import { getSupabase } from "@/lib/supabase";
import { getStoreNumber } from "@/lib/store";
import { subscribePostgresChanges } from "@/lib/store-ops/realtime";
import { createTtlCache } from "@/lib/store-ops/ttl-cache";
import {
  formatLocationLabel,
  type Department,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import { isoWeekLabel, isoWeekToMondayDate } from "@/lib/store-ops/week";
import type { StoreSpecialist } from "@/lib/types";

export const SUNDAY_AUDIT_EVENT = "deptsync:sunday-audit-assignments";
export const SUNDAY_OPEN_EVENT = "deptsync:sunday-audit-open";
export const SUNDAY_OPEN_STORAGE_KEY = "deptsync_open_sunday_audit";
export const SUNDAY_DEPARTMENT = "flooring";

/** Open the Sunday staging drawer in-place — never navigate to a missing route. */
export function requestSundayAuditDrawer() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SUNDAY_OPEN_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(SUNDAY_OPEN_EVENT));
}

export function consumeSundayAuditOpenRequest(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(SUNDAY_OPEN_STORAGE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(SUNDAY_OPEN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

const SUNDAY_ASSIGNMENTS_TTL_MS = 45_000;
const sundayAssignmentsCache = createTtlCache<SundayAssignmentMap>(
  SUNDAY_ASSIGNMENTS_TTL_MS
);

export type SundayBayAssignment = {
  specialist_id: string;
  specialist_name: string;
  assigned_at: string;
  assigned_specialist_id?: string | null;
  status?: string;
  is_carried_over?: boolean;
};

export type SundayAssignmentMap = Record<string, SundayBayAssignment>;

export type SundayStagedBay = {
  rotation: WeeklyRotationWithLocation;
  label: string;
  aisle: string;
  bay: number;
  assignment: SundayBayAssignment | null;
};

type SundayBayAssignmentRow = {
  id: string;
  store_number: string;
  department: string;
  week_starting: string;
  bay_id: string;
  assigned_specialist_id: string | null;
  roster_specialist_id: string | null;
  specialist_name: string | null;
  status: string;
  is_carried_over?: boolean | null;
  created_at: string;
  updated_at?: string | null;
};

function requireClient() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Database not configured");
  }
  return supabase;
}

function emitSundayEvent() {
  sundayAssignmentsCache.invalidate();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SUNDAY_AUDIT_EVENT));
}

function mapRow(row: SundayBayAssignmentRow): SundayBayAssignment | null {
  const rosterId = String(row.roster_specialist_id ?? "").trim();
  const profileId = row.assigned_specialist_id
    ? String(row.assigned_specialist_id)
    : "";
  const specialistId = rosterId || profileId;
  if (!specialistId || row.status === "cleared") return null;
  return {
    specialist_id: specialistId,
    specialist_name: String(row.specialist_name ?? "").trim() || "Specialist",
    assigned_at: String(row.updated_at ?? row.created_at),
    assigned_specialist_id: profileId || null,
    status: row.status,
    is_carried_over:
      row.is_carried_over === true ||
      String(row.status ?? "").toUpperCase() === "CARRIED_OVER",
  };
}

async function resolveProfileIdForRoster(
  rosterSpecialistId: string
): Promise<string | null> {
  const supabase = requireClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      const { data: self } = await supabase
        .from("profiles")
        .select("id, specialist_id")
        .eq("id", user.id)
        .maybeSingle();
      if (
        self?.id &&
        String(self.specialist_id ?? "") === String(rosterSpecialistId)
      ) {
        return String(self.id);
      }
    }

    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("specialist_id", rosterSpecialistId)
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  } catch {
    return null;
  }
}

export async function fetchSundayAssignments(
  week: string,
  storeNumber = getStoreNumber(),
  department = SUNDAY_DEPARTMENT
): Promise<SundayAssignmentMap> {
  const store = String(storeNumber ?? "").trim();
  if (!store || !week) return {};

  return sundayAssignmentsCache.get(
    `${store}:${department}:${week}`,
    async () => {
      const supabase = requireClient();
      const weekStarting = isoWeekToMondayDate(week);
      const { data, error } = await supabase
        .from("sunday_bay_assignments")
        .select("*")
        .eq("store_number", store)
        .eq("department", department)
        .eq("week_starting", weekStarting)
        .neq("status", "cleared");

      if (error) {
        throw new Error(error.message || "Could not load Sunday bay assignments");
      }

      const map: SundayAssignmentMap = {};
      for (const row of (data as SundayBayAssignmentRow[] | null) ?? []) {
        const assignment = mapRow(row);
        if (assignment) map[String(row.bay_id)] = assignment;
      }
      return map;
    }
  );
}

/** @deprecated Prefer fetchSundayAssignments — sync local overlay removed. */
export function getSundayAssignments(
  _week: string,
  _storeNumber = getStoreNumber()
): SundayAssignmentMap {
  return {};
}

export async function setSundayBayAssignment(
  week: string,
  bayId: string,
  assignment: SundayBayAssignment | null,
  storeNumber = getStoreNumber(),
  department = SUNDAY_DEPARTMENT
): Promise<void> {
  const supabase = requireClient();
  const store = String(storeNumber ?? "").trim();
  if (!store || !week || !bayId) return;

  const weekStarting = isoWeekToMondayDate(week);

  if (!assignment) {
    const { error } = await supabase.from("sunday_bay_assignments").upsert(
      {
        store_number: store,
        department,
        week_starting: weekStarting,
        bay_id: bayId,
        assigned_specialist_id: null,
        roster_specialist_id: null,
        specialist_name: "",
        status: "cleared",
        is_carried_over: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_number,department,week_starting,bay_id" }
    );
    if (error) throw new Error(error.message || "Could not clear assignment");
    emitSundayEvent();
    return;
  }

  const profileId =
    assignment.assigned_specialist_id ||
    (await resolveProfileIdForRoster(assignment.specialist_id));

  const status =
    String(assignment.status ?? "assigned").trim() || "assigned";
  const isCarried =
    assignment.is_carried_over === true ||
    status.toUpperCase() === "CARRIED_OVER";

  const payload: Record<string, unknown> = {
    store_number: store,
    department,
    week_starting: weekStarting,
    bay_id: bayId,
    assigned_specialist_id: profileId,
    roster_specialist_id: assignment.specialist_id,
    specialist_name: assignment.specialist_name,
    status,
    is_carried_over: isCarried,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("sunday_bay_assignments")
    .upsert(payload, {
      onConflict: "store_number,department,week_starting,bay_id",
    });

  if (error) {
    const fallback = { ...payload };
    if (status === "CARRIED_OVER") fallback.status = "assigned";
    const retryStatus = await supabase.from("sunday_bay_assignments").upsert(
      fallback,
      { onConflict: "store_number,department,week_starting,bay_id" }
    );
    if (retryStatus.error) {
      delete fallback.is_carried_over;
      const retryCols = await supabase.from("sunday_bay_assignments").upsert(
        fallback,
        { onConflict: "store_number,department,week_starting,bay_id" }
      );
      if (retryCols.error) {
        throw new Error(retryCols.error.message || "Could not save assignment");
      }
    }
  }
  emitSundayEvent();
}

export async function clearSundayBayAssignment(
  week: string,
  bayId: string,
  storeNumber = getStoreNumber(),
  department = SUNDAY_DEPARTMENT
): Promise<void> {
  await setSundayBayAssignment(week, bayId, null, storeNumber, department);
}

/** Flag this week's specialist assignments as carry-over (does not clear them). */
export async function markSundayBaysCarriedOver(
  week: string,
  bayIds: string[],
  storeNumber = getStoreNumber(),
  department = SUNDAY_DEPARTMENT
): Promise<number> {
  const unique = [...new Set(bayIds.map(String).filter(Boolean))];
  if (unique.length === 0) return 0;
  const assignments = await fetchSundayAssignments(week, storeNumber, department);
  const stamp = new Date().toISOString();
  let marked = 0;
  for (const bayId of unique) {
    const existing = assignments[bayId];
    await setSundayBayAssignment(
      week,
      bayId,
      {
        specialist_id: existing?.specialist_id || "carry-over",
        specialist_name: existing?.specialist_name || "Carry-over",
        assigned_at: existing?.assigned_at || stamp,
        assigned_specialist_id: existing?.assigned_specialist_id ?? null,
        status: "CARRIED_OVER",
        is_carried_over: true,
      },
      storeNumber,
      department
    );
    marked += 1;
  }
  return marked;
}

export async function autoAssignSundayBaysToSpecialist(
  week: string,
  bayIds: string[],
  specialist: StoreSpecialist,
  storeNumber = getStoreNumber(),
  department = SUNDAY_DEPARTMENT
): Promise<number> {
  const stamp = new Date().toISOString();
  const profileId = await resolveProfileIdForRoster(String(specialist.id));
  for (const bayId of bayIds) {
    await setSundayBayAssignment(
      week,
      bayId,
      {
        specialist_id: String(specialist.id),
        specialist_name: specialist.name,
        assigned_at: stamp,
        assigned_specialist_id: profileId,
        status: "assigned",
      },
      storeNumber,
      department
    );
  }
  return bayIds.length;
}

/** Persist a balancer plan — assignment owner stays this module. */
export async function applySundayAssignmentPlan(
  week: string,
  items: Array<{
    rotationId: string;
    specialist_id: string;
    specialist_name: string;
    hours?: number;
  }>,
  storeNumber = getStoreNumber(),
  department = SUNDAY_DEPARTMENT
): Promise<number> {
  const stamp = new Date().toISOString();
  const uniqueIds = [...new Set(items.map((row) => row.specialist_id))];
  const profileByRoster = new Map<string, string | null>();
  await Promise.all(
    uniqueIds.map(async (id) => {
      profileByRoster.set(id, await resolveProfileIdForRoster(id));
    })
  );
  await Promise.all(
    items.map((row) =>
      setSundayBayAssignment(
        week,
        row.rotationId,
        {
          specialist_id: row.specialist_id,
          specialist_name: row.specialist_name,
          assigned_at: stamp,
          assigned_specialist_id: profileByRoster.get(row.specialist_id) ?? null,
          status: "assigned",
        },
        storeNumber,
        department
      )
    )
  );
  return items.length;
}

export function subscribeSundayBayAssignments(
  storeNumber: string,
  week: string,
  onChange: () => void,
  department = SUNDAY_DEPARTMENT
): () => void {
  if (!storeNumber || !week) return () => undefined;

  let weekStarting: string;
  try {
    weekStarting = isoWeekToMondayDate(week);
  } catch {
    return () => undefined;
  }

  return subscribePostgresChanges(
    `sunday_bay:${storeNumber}:${department}:${weekStarting}`,
    {
      table: "sunday_bay_assignments",
      filter: `store_number=eq.${storeNumber}`,
    },
    () => {
      sundayAssignmentsCache.invalidate();
      onChange();
    }
  );
}

export function findFlooringDepartment(
  departments: Department[]
): Department | null {
  const active = departments.filter((d) => d.is_active !== false);
  const list = active.length > 0 ? active : departments;
  return (
    list.find((d) => d.code.trim().toLowerCase() === "flooring") ??
    list.find((d) => /flooring|home decor/i.test(d.name)) ??
    null
  );
}

export function filterFlooringRotations(
  rotations: WeeklyRotationWithLocation[],
  flooringDepartmentId: string | null | undefined
): WeeklyRotationWithLocation[] {
  if (!flooringDepartmentId) return [];
  return rotations.filter((r) => r.department_id === flooringDepartmentId);
}

export function openSundayRotations(
  rotations: WeeklyRotationWithLocation[]
): WeeklyRotationWithLocation[] {
  return rotations.filter((r) => !r.is_completed);
}

export function flooringRoster(
  roster: StoreSpecialist[]
): StoreSpecialist[] {
  return roster.filter((m) => {
    if (m.is_active === false) return false;
    if (m.role === "MasterAdmin") return true;
    const dept = m.assigned_department;
    return !dept || dept === "flooring" || dept === "all";
  });
}

/** On-duty Specialists + CSAs for Sunday shift balancer (all departments). */
export function sundayAssignableRoster(
  roster: StoreSpecialist[]
): StoreSpecialist[] {
  return roster.filter((m) => m.is_active !== false);
}

export function buildSundayStagedBays(
  rotations: WeeklyRotationWithLocation[],
  assignments: SundayAssignmentMap
): SundayStagedBay[] {
  return openSundayRotations(rotations)
    .map((rotation) => {
      const loc = rotation.store_locations;
      const label = loc
        ? formatLocationLabel(loc)
        : `Location ${rotation.location_id.slice(0, 8)}`;
      return {
        rotation,
        label,
        aisle: loc ? String(loc.aisle) : "—",
        bay: loc?.bay ?? 0,
        assignment: assignments[rotation.id] ?? null,
      };
    })
    .sort((a, b) => {
      const aisleCmp = String(a.aisle).localeCompare(String(b.aisle), undefined, {
        numeric: true,
      });
      if (aisleCmp !== 0) return aisleCmp;
      return a.bay - b.bay;
    });
}

export function pendingSundayAssignmentCount(bays: SundayStagedBay[]): number {
  return bays.filter((b) => !b.assignment).length;
}

/** True when local clock is Sunday (ISO: getDay() === 0). */
export function isSundayLocal(now = new Date()): boolean {
  return now.getDay() === 0;
}

/**
 * Whether to surface the glowing Sunday staging card.
 * Show when Flooring has open weekly rotations (Sunday cycle staged / in progress).
 */
export function shouldShowSundayStaging(openBayCount: number): boolean {
  return openBayCount > 0;
}

export function isSundayAssignmentForSpecialist(
  assignment: SundayBayAssignment | null | undefined,
  specialist: StoreSpecialist
): boolean {
  if (!assignment) return false;
  const rosterId = String(specialist.id);
  const profileId = String(assignment.assigned_specialist_id ?? "").trim();
  return (
    String(assignment.specialist_id) === rosterId ||
    (profileId.length > 0 && profileId === rosterId)
  );
}

export function partitionRotationsBySundayAssignment(
  rotations: WeeklyRotationWithLocation[],
  assignments: SundayAssignmentMap,
  specialist: StoreSpecialist
): {
  assignedToMe: WeeklyRotationWithLocation[];
  assignedToOthers: WeeklyRotationWithLocation[];
  unassigned: WeeklyRotationWithLocation[];
  hasPersonalQueue: boolean;
} {
  const assignedToMe: WeeklyRotationWithLocation[] = [];
  const assignedToOthers: WeeklyRotationWithLocation[] = [];
  const unassigned: WeeklyRotationWithLocation[] = [];

  for (const rotation of rotations) {
    const assignment = assignments[rotation.id] ?? null;
    if (isSundayAssignmentForSpecialist(assignment, specialist)) {
      assignedToMe.push(rotation);
    } else if (assignment) {
      assignedToOthers.push(rotation);
    } else {
      unassigned.push(rotation);
    }
  }

  return {
    assignedToMe,
    assignedToOthers,
    unassigned,
    hasPersonalQueue: assignedToMe.length > 0,
  };
}

export function sundayStagingHeadline(input: {
  openCount: number;
  pendingAssignmentCount: number;
  week?: string;
}): string {
  const week = input.week || isoWeekLabel();
  if (input.pendingAssignmentCount > 0) {
    return `⚡ Sunday Cycle Audit Staged (${input.pendingAssignmentCount} Bay${
      input.pendingAssignmentCount === 1 ? "" : "s"
    } Pending Assignment)`;
  }
  return `⚡ Sunday Cycle Audit · ${input.openCount} Flooring Bay${
    input.openCount === 1 ? "" : "s"
  } Open · Week ${week}`;
}
