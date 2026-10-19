/**
 * DEPTSYNC-SECTION-OWNERSHIP-004 — pure composition for supervisor workflow status.
 *
 * Displays only statuses supported by existing authoritative inputs.
 * Does not invent readiness, simulate publications, or duplicate the publisher.
 */

import { WEEKLY_ROTATION_AUTO_PUBLISH } from "./authoritative-week-cycle";

export type StandingCapacityStatusInput = {
  schema_ready: boolean;
  policy: {
    is_active: boolean;
    policy_version: number;
    items: ReadonlyArray<{ approved_capacity: number }>;
  } | null;
};

export type RotationVisibilityStatus = {
  automatic_publication_configured: boolean;
  standing_capacity_established: boolean;
  standing_capacity_sum: number | null;
  standing_policy_version: number | null;
  upcoming_operational_week: string;
  assignment_state: "published" | "pending" | "unknown";
  summary_lines: string[];
};

export function composeStandingCapacityStatus(
  input: StandingCapacityStatusInput
): {
  established: boolean;
  sum: number | null;
  policy_version: number | null;
} {
  if (!input.schema_ready || !input.policy || !input.policy.is_active) {
    return { established: false, sum: null, policy_version: null };
  }
  const sum = input.policy.items.reduce(
    (n, item) => n + Math.max(0, Math.floor(Number(item.approved_capacity) || 0)),
    0
  );
  return {
    established: input.policy.items.length > 0 && sum > 0,
    sum,
    policy_version: input.policy.policy_version,
  };
}

export function composeRotationVisibilityStatus(input: {
  upcoming_operational_week: string;
  standing: StandingCapacityStatusInput;
  /** Authoritative published assignment count for the upcoming week, when known. */
  published_assignment_count?: number | null;
}): RotationVisibilityStatus {
  const standing = composeStandingCapacityStatus(input.standing);
  const automatic = WEEKLY_ROTATION_AUTO_PUBLISH === true;
  const publishedCount = input.published_assignment_count;
  let assignment_state: RotationVisibilityStatus["assignment_state"] = "unknown";
  if (typeof publishedCount === "number") {
    assignment_state = publishedCount > 0 ? "published" : "pending";
  }

  const summary_lines: string[] = [];
  summary_lines.push(
    automatic
      ? "Automatic weekly rotation is configured on."
      : "Automatic weekly rotation is configured off."
  );
  if (standing.established && standing.sum != null) {
    summary_lines.push(
      `Standing capacity established (v${standing.policy_version ?? "—"} · ${standing.sum} bays).`
    );
  } else {
    summary_lines.push("Standing capacity not established yet.");
  }
  summary_lines.push(`Upcoming operational week: ${input.upcoming_operational_week}.`);
  if (assignment_state === "published") {
    summary_lines.push("Assignments are already published for that week.");
  } else if (assignment_state === "pending") {
    summary_lines.push("Assignments not yet published for that week.");
  }

  return {
    automatic_publication_configured: automatic,
    standing_capacity_established: standing.established,
    standing_capacity_sum: standing.sum,
    standing_policy_version: standing.policy_version,
    upcoming_operational_week: input.upcoming_operational_week,
    assignment_state,
    summary_lines,
  };
}

/** Coverage capacity copy for supervisors — capacity does not multiply. */
export const COVERAGE_CAPACITY_EXPLAINER =
  "Coverage changes which sections an associate can receive bays from. It does not increase their weekly assignment capacity.";

export const PERMANENT_OWNER_LABEL = "Permanent owner";
export const TEMPORARY_COVERAGE_LABEL = "Temporary weekly coverage";
