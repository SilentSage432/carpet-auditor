/**
 * Supervisor weekly audit rollup — personal record view.
 * Composes store health (quota / barriers) + Sunday assignments (associate/shift).
 * Does not persist, recommend, or invent who tapped complete.
 */

import type { StoreHealthSnapshot } from "./health";
import type { SundayAssignmentMap } from "./sunday-audit";
import type { WeeklyRotationWithLocation } from "./types";

export type AssociateAuditRow = {
  specialist_id: string;
  specialist_name: string;
  shift_hours: number | null;
  assigned: number;
  completed: number;
};

export type WeeklyAuditRollup = {
  assigned_week: string;
  department_name: string | null;
  quota: number;
  assigned: number;
  completed: number;
  remaining: number;
  completion_pct: number;
  associates: AssociateAuditRow[];
  unassigned: { assigned: number; completed: number };
  open_barriers: number;
  resolved_barriers: number;
};

function completionPct(completed: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.round((completed / denom) * 100);
}

/**
 * Attribute completions to the Sunday assignee when present.
 * Unassigned bays stay in the unassigned bucket — we do not guess the tapper.
 */
export function composeWeeklyAuditRollup(input: {
  week: string;
  health: Pick<
    StoreHealthSnapshot,
    "department" | "departments" | "totals" | "barriers" | "assigned_week"
  > | null;
  rotations: WeeklyRotationWithLocation[];
  assignments: SundayAssignmentMap;
  shiftHours?: Record<string, number>;
  exceptionLocationIds?: string[];
}): WeeklyAuditRollup {
  const health = input.health;
  const dept = health?.department ?? health?.departments?.[0] ?? null;
  const quota = Math.max(
    0,
    Math.floor(
      Number(dept?.weekly_bay_target ?? health?.totals.assigned ?? 0) || 0
    )
  );
  const assigned = input.rotations.length;
  const completed = input.rotations.filter((r) => r.is_completed).length;
  const remaining = Math.max(0, assigned - completed);

  const byId = new Map<string, AssociateAuditRow>();
  let unassignedAssigned = 0;
  let unassignedCompleted = 0;

  for (const rotation of input.rotations) {
    const assignment = input.assignments[rotation.id];
    if (!assignment) {
      unassignedAssigned += 1;
      if (rotation.is_completed) unassignedCompleted += 1;
      continue;
    }
    let row = byId.get(assignment.specialist_id);
    if (!row) {
      const hours = input.shiftHours?.[assignment.specialist_id];
      row = {
        specialist_id: assignment.specialist_id,
        specialist_name: assignment.specialist_name.split(" · ")[0] ?? assignment.specialist_name,
        shift_hours: hours && hours > 0 ? hours : null,
        assigned: 0,
        completed: 0,
      };
      byId.set(assignment.specialist_id, row);
    }
    row.assigned += 1;
    if (rotation.is_completed) row.completed += 1;
  }

  const completedLocationIds = new Set(
    input.rotations
      .filter((r) => r.is_completed)
      .map((r) => r.location_id || r.store_locations?.id || "")
      .filter(Boolean)
  );
  const exceptionIds = input.exceptionLocationIds ?? [];
  let resolved_barriers = 0;
  let open_barriers = 0;
  if (exceptionIds.length > 0) {
    for (const id of exceptionIds) {
      if (completedLocationIds.has(id)) resolved_barriers += 1;
      else open_barriers += 1;
    }
  } else {
    open_barriers = health?.barriers.length ?? health?.totals.exceptions ?? 0;
    resolved_barriers = 0;
  }

  const associates = [...byId.values()].sort(
    (a, b) => b.completed - a.completed || a.specialist_name.localeCompare(b.specialist_name)
  );

  return {
    assigned_week: input.week || health?.assigned_week || "",
    department_name: dept?.department_name ?? null,
    quota: quota || assigned,
    assigned,
    completed,
    remaining,
    completion_pct: completionPct(completed, quota || assigned),
    associates,
    unassigned: { assigned: unassignedAssigned, completed: unassignedCompleted },
    open_barriers,
    resolved_barriers,
  };
}

export function formatWeeklyAuditRollupText(rollup: WeeklyAuditRollup): string {
  const lines = [
    `DeptSync weekly audit rollup · ${rollup.assigned_week || "this week"}`,
    rollup.department_name ? `Department: ${rollup.department_name}` : "Department: store",
    `Completed ${rollup.completed} of quota ${rollup.quota} (${rollup.completion_pct}%) · assigned ${rollup.assigned} · remaining ${rollup.remaining}`,
    `Barriers: ${rollup.resolved_barriers} resolved / ${rollup.open_barriers} open`,
    "",
    "By associate / shift:",
  ];
  if (rollup.associates.length === 0) {
    lines.push("  (no Sunday assignments this week)");
  } else {
    for (const row of rollup.associates) {
      const shift = row.shift_hours ? ` · ${row.shift_hours}h` : "";
      lines.push(
        `  ${row.specialist_name}${shift}: ${row.completed}/${row.assigned} complete`
      );
    }
  }
  if (rollup.unassigned.assigned > 0) {
    lines.push(
      `  Unassigned: ${rollup.unassigned.completed}/${rollup.unassigned.assigned} complete`
    );
  }
  return lines.join("\n");
}
