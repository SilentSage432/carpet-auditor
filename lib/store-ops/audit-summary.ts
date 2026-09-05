/**
 * Supervisor weekly audit rollup — personal record view.
 * Composes store health (quota / barriers) + Sunday assignments (associate/shift).
 * Layer-1 completion classes from rotation-metrics-v1 (Art VI):
 *   reported = associate/actor submit · verified = DS VERIFIED_COMPLETE only.
 * Does not persist, recommend, or invent who tapped complete.
 */

import {
  computeDepartmentCompletionPct,
} from "./health";
import {
  composeWeeklyRotationMetrics,
  isRotationReportedComplete,
  WEEKLY_ROTATION_METRICS_METHOD,
} from "./rotation-metrics";
import type { SundayAssignmentMap } from "./sunday-audit";
import type { WeeklyRotationWithLocation } from "./types";

export type AssociateAuditRow = {
  specialist_id: string;
  specialist_name: string;
  shift_hours: number | null;
  assigned: number;
  /** Reported complete (includes pending verification + verified). */
  completed: number;
  verified: number;
};

export type WeeklyAuditRollup = {
  method: typeof WEEKLY_ROTATION_METRICS_METHOD;
  assigned_week: string;
  department_name: string | null;
  quota: number;
  assigned: number;
  /** @deprecated Prefer reportedComplete — kept as reported alias for callers. */
  completed: number;
  reportedComplete: number;
  pendingVerification: number;
  verifiedComplete: number;
  open: number;
  remaining: number;
  /** Quota progress uses verified complete (Art VI readiness). */
  completion_pct: number;
  /** Reported pace vs assigned (associate throughput, not readiness). */
  reported_pct: number;
  verifiedTargetDeficit: number;
  associates: AssociateAuditRow[];
  unassigned: { assigned: number; completed: number; verified: number };
  open_barriers: number;
  resolved_barriers: number;
};

/**
 * Attribute completions to the Sunday assignee when present.
 * Unassigned bays stay in the unassigned bucket — we do not guess the tapper.
 */
export function composeWeeklyAuditRollup(input: {
  week: string;
  health: {
    department?: {
      department_name?: string | null;
      weekly_bay_target?: number | null;
    } | null;
    departments?: Array<{
      department_name?: string | null;
      weekly_bay_target?: number | null;
    }>;
    totals?: {
      assigned?: number;
      exceptions?: number;
    };
    barriers?: unknown[];
    assigned_week?: string;
  } | null;
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
      Number(dept?.weekly_bay_target ?? health?.totals?.assigned ?? 0) || 0
    )
  );
  const metrics = composeWeeklyRotationMetrics({
    rotations: input.rotations,
    weeklyTarget: quota || dept?.weekly_bay_target,
  });
  const assigned = metrics.staged;
  const reportedComplete = metrics.reportedComplete;
  const verifiedComplete = metrics.verifiedComplete;
  const remaining = metrics.open;

  const byId = new Map<string, AssociateAuditRow>();
  let unassignedAssigned = 0;
  let unassignedCompleted = 0;
  let unassignedVerified = 0;

  for (const rotation of input.rotations) {
    const assignment = input.assignments[rotation.id];
    const reported = isRotationReportedComplete(rotation);
    const verified =
      String(rotation.verification_status ?? "").toUpperCase() ===
      "VERIFIED_COMPLETE";
    if (!assignment) {
      unassignedAssigned += 1;
      if (reported) unassignedCompleted += 1;
      if (verified) unassignedVerified += 1;
      continue;
    }
    let row = byId.get(assignment.specialist_id);
    if (!row) {
      const hours = input.shiftHours?.[assignment.specialist_id];
      row = {
        specialist_id: assignment.specialist_id,
        specialist_name:
          assignment.specialist_name.split(" · ")[0] ?? assignment.specialist_name,
        shift_hours: hours && hours > 0 ? hours : null,
        assigned: 0,
        completed: 0,
        verified: 0,
      };
      byId.set(assignment.specialist_id, row);
    }
    row.assigned += 1;
    if (reported) row.completed += 1;
    if (verified) row.verified += 1;
  }

  const verifiedLocationIds = new Set(
    input.rotations
      .filter(
        (r) =>
          String(r.verification_status ?? "").toUpperCase() ===
          "VERIFIED_COMPLETE"
      )
      .map((r) => r.location_id || r.store_locations?.id || "")
      .filter(Boolean)
  );
  const exceptionIds = input.exceptionLocationIds ?? [];
  let resolved_barriers = 0;
  let open_barriers = 0;
  if (exceptionIds.length > 0) {
    for (const id of exceptionIds) {
      if (verifiedLocationIds.has(id)) resolved_barriers += 1;
      else open_barriers += 1;
    }
  } else {
    open_barriers = health?.barriers?.length ?? health?.totals?.exceptions ?? 0;
    resolved_barriers = 0;
  }

  const associates = [...byId.values()].sort(
    (a, b) =>
      b.verified - a.verified ||
      b.completed - a.completed ||
      a.specialist_name.localeCompare(b.specialist_name)
  );

  const quotaDenom = quota || assigned;
  return {
    method: WEEKLY_ROTATION_METRICS_METHOD,
    assigned_week: input.week || health?.assigned_week || "",
    department_name: dept?.department_name ?? null,
    quota: quota || assigned,
    assigned,
    completed: reportedComplete,
    reportedComplete,
    pendingVerification: metrics.pendingVerification,
    verifiedComplete,
    open: remaining,
    remaining,
    completion_pct: computeDepartmentCompletionPct(
      verifiedComplete,
      quotaDenom
    ),
    reported_pct: computeDepartmentCompletionPct(reportedComplete, assigned),
    verifiedTargetDeficit: metrics.verifiedTargetDeficit,
    associates,
    unassigned: {
      assigned: unassignedAssigned,
      completed: unassignedCompleted,
      verified: unassignedVerified,
    },
    open_barriers,
    resolved_barriers,
  };
}

export function formatWeeklyAuditRollupText(rollup: WeeklyAuditRollup): string {
  const lines = [
    `DeptSync weekly audit rollup · ${rollup.assigned_week || "this week"}`,
    rollup.department_name
      ? `Department: ${rollup.department_name}`
      : "Department: store",
    `Verified ${rollup.verifiedComplete} of quota ${rollup.quota} (${rollup.completion_pct}%) · staged ${rollup.assigned} · reported ${rollup.reportedComplete} · awaiting review ${rollup.pendingVerification} · open ${rollup.remaining}`,
    `Verified target deficit: ${rollup.verifiedTargetDeficit}`,
    `Barriers: ${rollup.resolved_barriers} resolved / ${rollup.open_barriers} open`,
    "",
    "By associate / shift (reported / verified / assigned):",
  ];
  if (rollup.associates.length === 0) {
    lines.push("  (no Sunday assignments this week)");
  } else {
    for (const row of rollup.associates) {
      const shift = row.shift_hours ? ` · ${row.shift_hours}h` : "";
      lines.push(
        `  ${row.specialist_name}${shift}: ${row.completed} reported / ${row.verified} verified / ${row.assigned} assigned`
      );
    }
  }
  if (rollup.unassigned.assigned > 0) {
    lines.push(
      `  Unassigned: ${rollup.unassigned.completed} reported / ${rollup.unassigned.verified} verified / ${rollup.unassigned.assigned} assigned`
    );
  }
  return lines.join("\n");
}
