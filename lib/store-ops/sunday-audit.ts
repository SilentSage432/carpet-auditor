/**
 * Sunday Flooring Cycle Audit staging + specialist assignment overlay.
 * Composes weekly_rotations (bay engine) — does not recompute rotation generation.
 * Person assignments persist locally per store/week until a server column exists.
 */

import { getStoreNumber } from "@/lib/store";
import {
  formatLocationLabel,
  type Department,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import { isoWeekLabel } from "@/lib/store-ops/week";
import type { StoreSpecialist } from "@/lib/types";

const ASSIGNMENT_KEY = "deptsync_sunday_audit_assignments";
export const SUNDAY_AUDIT_EVENT = "deptsync:sunday-audit-assignments";

export type SundayBayAssignment = {
  specialist_id: string;
  specialist_name: string;
  assigned_at: string;
};

export type SundayAssignmentMap = Record<string, SundayBayAssignment>;

export type SundayStagedBay = {
  rotation: WeeklyRotationWithLocation;
  label: string;
  aisle: string;
  bay: number;
  assignment: SundayBayAssignment | null;
};

function storageKey(storeNumber: string, week: string): string {
  return `${storeNumber || "store"}:${week}`;
}

function readAll(): Record<string, SundayAssignmentMap> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ASSIGNMENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, SundayAssignmentMap>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, SundayAssignmentMap>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ASSIGNMENT_KEY, JSON.stringify(map));
  window.dispatchEvent(new CustomEvent(SUNDAY_AUDIT_EVENT));
}

export function getSundayAssignments(
  week: string,
  storeNumber = getStoreNumber()
): SundayAssignmentMap {
  return readAll()[storageKey(storeNumber, week)] ?? {};
}

export function setSundayBayAssignment(
  week: string,
  rotationId: string,
  assignment: SundayBayAssignment | null,
  storeNumber = getStoreNumber()
): void {
  const all = readAll();
  const key = storageKey(storeNumber, week);
  const bucket = { ...(all[key] ?? {}) };
  if (!assignment) delete bucket[rotationId];
  else bucket[rotationId] = assignment;
  all[key] = bucket;
  writeAll(all);
}

export function clearSundayBayAssignment(
  week: string,
  rotationId: string,
  storeNumber = getStoreNumber()
): void {
  setSundayBayAssignment(week, rotationId, null, storeNumber);
}

export function autoAssignSundayBaysToSpecialist(
  week: string,
  rotationIds: string[],
  specialist: StoreSpecialist,
  storeNumber = getStoreNumber()
): number {
  const all = readAll();
  const key = storageKey(storeNumber, week);
  const bucket = { ...(all[key] ?? {}) };
  const stamp = new Date().toISOString();
  for (const id of rotationIds) {
    bucket[id] = {
      specialist_id: String(specialist.id),
      specialist_name: specialist.name,
      assigned_at: stamp,
    };
  }
  all[key] = bucket;
  writeAll(all);
  return rotationIds.length;
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
