/**
 * Call-out bay redistribution — composes sunday-audit + location status.
 * Does not generate rotations or own the shift board.
 */

import { fetchThisWeekRotations, patchStoreLocation } from "@/lib/store-ops/client";
import {
  applySundayAssignmentPlan,
  clearSundayBayAssignment,
  fetchSundayAssignments,
  isSundayAssignmentForSpecialist,
  markSundayBaysCarriedOver,
} from "@/lib/store-ops/sunday-audit";
import {
  planProportionalBayAssignments,
  type RotationBayRef,
  type ShiftRosterMember,
} from "@/lib/store-ops/weekly-rotations";
import type { AssociateShiftDay } from "@/lib/store-ops/shift-status";
import type { StoreSpecialist } from "@/lib/types";
import type { DepartmentScope } from "@/lib/types";

export type CallOutRedistributeMode = "pool" | "auto" | "carry";

export type CallOutRedistributeResult = {
  moved: number;
  mode: CallOutRedistributeMode;
};

function hubDepartment(member: StoreSpecialist): DepartmentScope {
  const dept = member.assigned_department;
  if (dept && dept !== "all") return dept;
  return "flooring";
}

async function stampCarryOverLocations(
  actor: StoreSpecialist,
  locationIds: string[]
): Promise<void> {
  const now = new Date().toISOString();
  const unique = [...new Set(locationIds.filter(Boolean))];
  for (const locId of unique) {
    await patchStoreLocation(actor, locId, {
      status: "CARRIED_OVER",
      priority_override: true,
      carried_over: true,
      last_carried_over_at: now,
    });
  }
}

/**
 * Rebalance an absent associate's open checklist bays among today's board.
 */
export async function redistributeCallOutBays(input: {
  actor: StoreSpecialist;
  absent: StoreSpecialist;
  peers: StoreSpecialist[];
  days: AssociateShiftDay[];
  mode: CallOutRedistributeMode;
}): Promise<CallOutRedistributeResult> {
  const department = hubDepartment(input.absent);
  const weekData = await fetchThisWeekRotations(input.actor);
  const week = weekData.assigned_week;
  const rotations = (weekData.rotations ?? []).filter((row) => !row.is_completed);
  if (!week || rotations.length === 0) {
    return { moved: 0, mode: input.mode };
  }

  const assignments = await fetchSundayAssignments(week, undefined, department);
  const mine = rotations.filter((row) =>
    isSundayAssignmentForSpecialist(assignments[row.id], input.absent)
  );

  if (mine.length === 0) {
    return { moved: 0, mode: input.mode };
  }

  if (input.mode === "pool") {
    for (const row of mine) {
      await clearSundayBayAssignment(week, row.id, undefined, department);
    }
    return { moved: mine.length, mode: "pool" };
  }

  if (input.mode === "carry") {
    await markSundayBaysCarriedOver(
      week,
      mine.map((row) => row.id),
      undefined,
      department
    );
    await stampCarryOverLocations(
      input.actor,
      mine.map((row) => row.location_id || row.store_locations?.id || "")
    );
    return { moved: mine.length, mode: "carry" };
  }

  const dayById = new Map(input.days.map((d) => [d.specialist_id, d]));
  const onDuty = input.peers.filter((peer) => {
    if (peer.id === input.absent.id) return false;
    if (peer.is_active === false) return false;
    if (peer.role === "MasterAdmin") return false;
    const home = peer.assigned_department;
    if (home && home !== "all" && home !== department) return false;
    const day = dayById.get(String(peer.id));
    return day ? day.status === "ON_DUTY" : true;
  });

  if (onDuty.length === 0) {
    return redistributeCallOutBays({ ...input, mode: "carry" });
  }

  const bays: RotationBayRef[] = mine.map((row) => ({
    rotationId: row.id,
    aisle: String(row.store_locations?.aisle ?? ""),
    bay: Number(row.store_locations?.bay ?? 0),
    type: row.store_locations?.type,
    riskScore: 0,
  }));

  const members: ShiftRosterMember[] = onDuty.map((peer) => {
    const day = dayById.get(String(peer.id));
    return {
      specialist_id: String(peer.id),
      specialist_name: peer.name,
      active: true,
      hours: 8,
      start: day?.start_time ?? undefined,
      end: day?.end_time ?? undefined,
    };
  });

  const plan = planProportionalBayAssignments(bays, members);
  if (plan.items.length === 0) {
    return redistributeCallOutBays({ ...input, mode: "carry" });
  }
  await applySundayAssignmentPlan(week, plan.items, undefined, department);
  return { moved: plan.items.length, mode: "auto" };
}
