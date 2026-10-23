/**
 * DEPTSYNC-MAP-WALK-CUES-001 — aisle-row cues.
 *
 * Assigned this week comes from the persisted Sunday assignment on a rotation
 * in the operational week. Open follow-up comes from follow-up status, not
 * from observation text. Neither cue writes, and neither uses section coverage.
 */

import { locationDedupeAisleKey } from "./locations";

export type MapWalkAssignmentRotation = {
  id: string;
  assigned_week?: string | null;
  department_id?: string | null;
  superseded_at?: string | null;
  store_locations?: {
    department_id?: string | null;
    aisle?: string | null;
    bay?: number | null;
  } | null;
};

export type MapWalkAssignmentRow = {
  specialist_id?: string | null;
};

export type MapWalkFollowUpPlace = {
  department_id?: string | null;
  aisle?: string | null;
  bay?: number | null;
  status?: "open" | "done" | string | null;
};

export function mapWalkCueKey(input: {
  departmentId: string;
  aisle: string;
  bay: number;
}): string {
  return `${String(input.departmentId).trim()}|${locationDedupeAisleKey(input.aisle)}|${Number(input.bay) || 0}`;
}

/**
 * Physical bays with a persisted assignee in the operational week.
 * Null assignments mean the read failed — callers must not treat that as zero.
 * Rotations from any other week are ignored.
 */
export function indexAssignedThisWeekBays(input: {
  operationalWeek: string | null | undefined;
  rotations: readonly MapWalkAssignmentRotation[];
  assignments: Readonly<Record<string, MapWalkAssignmentRow | undefined>> | null;
}): Set<string> | null {
  if (input.assignments == null) return null;
  const week = String(input.operationalWeek ?? "").trim();
  const keys = new Set<string>();
  if (!week) return keys;
  for (const rotation of input.rotations) {
    if (rotation.superseded_at) continue;
    if (String(rotation.assigned_week ?? "").trim() !== week) continue;
    const specialistId = String(
      input.assignments[rotation.id]?.specialist_id ?? ""
    ).trim();
    if (!specialistId) continue;
    const loc = rotation.store_locations;
    const departmentId = String(
      rotation.department_id || loc?.department_id || ""
    ).trim();
    const aisle = String(loc?.aisle ?? "").trim();
    const bay = Number(loc?.bay);
    if (!departmentId || !aisle || !Number.isFinite(bay)) continue;
    keys.add(mapWalkCueKey({ departmentId, aisle, bay }));
  }
  return keys;
}

/**
 * Places with at least one open follow-up.
 * Closed rows and notes without a bay are omitted. Null input means the read failed.
 */
export function indexOpenFollowUpBays(
  places: readonly MapWalkFollowUpPlace[] | null
): Set<string> | null {
  if (places == null) return null;
  const keys = new Set<string>();
  for (const place of places) {
    if (String(place.status ?? "open") !== "open") continue;
    const departmentId = String(place.department_id ?? "").trim();
    const aisle = String(place.aisle ?? "").trim();
    const bay = Number(place.bay);
    if (!departmentId || !aisle || !Number.isFinite(bay)) continue;
    keys.add(mapWalkCueKey({ departmentId, aisle, bay }));
  }
  return keys;
}

export function mapBayWalkCues(input: {
  departmentId: string;
  aisle: string;
  bay: number;
  assignedKeys: ReadonlySet<string> | null;
  followUpKeys: ReadonlySet<string> | null;
}): { assignedThisWeek: boolean; openFollowUp: boolean } {
  const key = mapWalkCueKey(input);
  return {
    assignedThisWeek: input.assignedKeys?.has(key) ?? false,
    openFollowUp: input.followUpKeys?.has(key) ?? false,
  };
}
