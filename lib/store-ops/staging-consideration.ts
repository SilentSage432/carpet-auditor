/**
 * REC-001 Department Staging Consideration — pure advisory foundation.
 *
 * Method: department-staging-consideration-v1
 *
 * Answers: while this department remains below its configured weekly staging
 * target, which unstaged actionable locations with elevated Current Attention
 * (MEDIUM|HIGH) qualify for the DS to consider?
 *
 * Does NOT: truncate the qualifying pool to staging_deficit, invent ranking /
 * score / ordinal / selected winners, convert deficit into capacity, consume
 * LAB-001, rescore SI raw evidence, mutate rotations / assignments /
 * verification / targets, or replace ordinary rotation fairness.
 *
 * Constitutional posture: COMPLIES Arts II, III, V–IX, XI, XV, XIX–XXII
 * (advisory Layer-4 consideration without mutation or invented precedence;
 * no amendment). EXTENDS Art IX Layer 4 thinly — no ranked recommendations.
 *
 * Clock: pure composition uses only input.as_of (no Date.now).
 */

import type {
  AttentionActionability,
  AttentionPressure,
  AttentionReasonCode,
} from "./location-attention-pressure";

/** Stable method id for REC-001 staging consideration. */
export const DEPARTMENT_STAGING_CONSIDERATION_METHOD =
  "department-staging-consideration-v1" as const;

export const DEPARTMENT_STAGING_CONSIDERATION_VERSION = 1 as const;

/**
 * AVAILABLE — required evidence present and staging_deficit > 0
 *   (candidates may be empty).
 * NO_ADDITIONAL_STAGING_NEEDED — required planning/staged evidence present and
 *   staging_deficit = 0 (candidates always []). Not “no operational attention.”
 * UNAVAILABLE — a required evidence family was not established, planning
 *   metrics failed defensive consistency checks, or (when deficit > 0)
 *   Current Attention evidence contains a material location-id conflict.
 *   Conflicting SI ≠ empty successful candidate pool.
 */
export type StagingConsiderationStatus =
  | "AVAILABLE"
  | "NO_ADDITIONAL_STAGING_NEEDED"
  | "UNAVAILABLE";

/**
 * Narrow planning facts — prefer values already produced by
 * weekly-rotation-metrics-v1 (`target`, `staged`, `stagingDeficit`).
 *
 * staging_deficit = additional staging positions needed to reach the configured
 * weekly staging target. Not capacity, finishability, or a truncation bound.
 */
export type StagingConsiderationPlanningInput = {
  target: number;
  staged: number;
  staging_deficit: number;
};

/**
 * Normalized Current Attention signal for one location.
 *
 * Eligibility ownership (no second cycle engine in REC):
 * - Prefer SI assessments already eligibility-scoped by SI-001 GATE /
 *   `isEligibleRotationLocation` (callers supply those assessments), AND/OR
 * - Explicit `eligible` on this normalized input.
 * REC does NOT equate pressure NONE with ineligibility — NONE simply fails the
 * MEDIUM|HIGH candidate predicate. Explicit `eligible: false` excludes even
 * elevated actionable signals.
 */
export type StagingConsiderationAttentionInput = {
  location_id: string;
  pressure: AttentionPressure;
  actionability: AttentionActionability;
  /** SI method string (e.g. location-attention-pressure-v1). */
  method: string;
  method_version: number;
  /**
   * Optional SI reason codes — provenance only; never rescored as points.
   * Material identity includes the normalized reason-code set (no synthetic union).
   */
  reason_codes?: ReadonlyArray<AttentionReasonCode>;
  /**
   * When false, location is excluded.
   * When omitted/true, do not invent ineligibility; rely on SI-scoped input
   * plus the MEDIUM|HIGH + ACTIONABLE predicate.
   */
  eligible?: boolean;
};

export type DepartmentStagingConsiderationInput = {
  department_id: string;
  /** ISO week label for planning scope (same family as weekly rotations). */
  iso_week: string;
  as_of: string;
  planning: StagingConsiderationPlanningInput;
  attention_signals: ReadonlyArray<StagingConsiderationAttentionInput>;
  /** Authoritative current-week staged location ids (active plan rows). */
  staged_location_ids: ReadonlyArray<string>;
  /**
   * true → attention_signals is the positively resolved set (possibly empty).
   * false → do not treat emptiness as “no elevated attention.”
   */
  attention_evidence_available: boolean;
  /**
   * true → planning metrics are positively resolved.
   * false → do not invent zero deficit / NO_ADDITIONAL_STAGING_NEEDED.
   */
  planning_evidence_available: boolean;
  /**
   * true → staged_location_ids is the positively resolved staged set.
   * false → do not treat emptiness as “nothing staged.”
   */
  staged_state_evidence_available: boolean;
};

export type StagingConsiderationPlanning = {
  target: number;
  staged: number;
  staging_deficit: number;
};

export type StagingConsiderationCandidate = {
  location_id: string;
  pressure: AttentionPressure;
  actionability: AttentionActionability;
  source_signal_method: string;
  source_signal_version: number;
  reason_codes: AttentionReasonCode[];
};

export type DepartmentStagingConsiderationAssessment = {
  department_id: string;
  iso_week: string;
  as_of: string;
  planning: StagingConsiderationPlanning | null;
  candidates: StagingConsiderationCandidate[];
  status: StagingConsiderationStatus;
  method: typeof DEPARTMENT_STAGING_CONSIDERATION_METHOD;
  method_version: typeof DEPARTMENT_STAGING_CONSIDERATION_VERSION;
};

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && Math.floor(n) === n;
}

/**
 * Defensive consistency with Layer-1: staging_deficit must equal
 * max(0, target − staged). REC does not silently recalculate a replacement.
 */
export function isConsistentStagingPlanning(
  planning: StagingConsiderationPlanningInput
): boolean {
  if (
    !isNonNegInt(planning.target) ||
    !isNonNegInt(planning.staged) ||
    !isNonNegInt(planning.staging_deficit)
  ) {
    return false;
  }
  return planning.staging_deficit === Math.max(0, planning.target - planning.staged);
}

function emptyUnavailable(
  input: Pick<
    DepartmentStagingConsiderationInput,
    "department_id" | "iso_week" | "as_of"
  >
): DepartmentStagingConsiderationAssessment {
  return {
    department_id: input.department_id,
    iso_week: input.iso_week,
    as_of: input.as_of,
    planning: null,
    candidates: [],
    status: "UNAVAILABLE",
    method: DEPARTMENT_STAGING_CONSIDERATION_METHOD,
    method_version: DEPARTMENT_STAGING_CONSIDERATION_VERSION,
  };
}

function qualifiesForStagingConsideration(
  signal: StagingConsiderationAttentionInput,
  stagedIds: ReadonlySet<string>
): boolean {
  if (signal.eligible === false) return false;
  if (stagedIds.has(signal.location_id)) return false;
  if (signal.pressure !== "MEDIUM" && signal.pressure !== "HIGH") return false;
  if (signal.actionability !== "ACTIONABLE") return false;
  return true;
}

/** Deterministic reason-code set for identity / serialization (order ignored). */
function normalizeReasonCodes(
  codes: ReadonlyArray<AttentionReasonCode> | undefined
): AttentionReasonCode[] {
  return [...(codes ?? [])].sort();
}

function reasonSetsEqual(
  a: ReadonlyArray<AttentionReasonCode> | undefined,
  b: ReadonlyArray<AttentionReasonCode> | undefined
): boolean {
  const na = normalizeReasonCodes(a);
  const nb = normalizeReasonCodes(b);
  if (na.length !== nb.length) return false;
  return na.every((code, i) => code === nb[i]);
}

/**
 * Material identity for duplicate collapse — fields that affect REC truth.
 * Different normalized reason-code sets are material conflicts (no synthetic union).
 */
function isMateriallyIdenticalAttention(
  a: StagingConsiderationAttentionInput,
  b: StagingConsiderationAttentionInput
): boolean {
  return (
    a.location_id === b.location_id &&
    a.pressure === b.pressure &&
    a.actionability === b.actionability &&
    a.method === b.method &&
    a.method_version === b.method_version &&
    (a.eligible ?? true) === (b.eligible ?? true) &&
    reasonSetsEqual(a.reason_codes, b.reason_codes)
  );
}

/**
 * Collapse exact material duplicates (reason sets order-normalized).
 * Any material conflict for the same location_id → hasConflict (no winner).
 * Detection is order-independent: first vs second conflict still hasConflict.
 */
function resolveAttentionByLocation(
  signals: ReadonlyArray<StagingConsiderationAttentionInput>
): {
  byLocation: Map<string, StagingConsiderationAttentionInput>;
  hasConflict: boolean;
} {
  const byLocation = new Map<string, StagingConsiderationAttentionInput>();
  let hasConflict = false;
  const conflictingIds = new Set<string>();

  for (const signal of signals) {
    const id = signal.location_id;
    const normalized: StagingConsiderationAttentionInput = {
      ...signal,
      reason_codes: normalizeReasonCodes(signal.reason_codes),
    };

    if (conflictingIds.has(id)) {
      hasConflict = true;
      continue;
    }

    const existing = byLocation.get(id);
    if (!existing) {
      byLocation.set(id, normalized);
      continue;
    }

    if (isMateriallyIdenticalAttention(existing, normalized)) {
      // Exact duplicate — already stored with normalized reasons.
      continue;
    }

    byLocation.delete(id);
    conflictingIds.add(id);
    hasConflict = true;
  }

  return { byLocation, hasConflict };
}

function toCandidate(
  signal: StagingConsiderationAttentionInput
): StagingConsiderationCandidate {
  return {
    location_id: signal.location_id,
    pressure: signal.pressure,
    actionability: signal.actionability,
    source_signal_method: signal.method,
    source_signal_version: signal.method_version,
    reason_codes: [...(signal.reason_codes ?? [])],
  };
}

/**
 * Non-semantic serialization order: stable location_id ascending.
 * Array order is NOT recommendation precedence / rank.
 */
function compareCandidatesByLocationId(
  a: StagingConsiderationCandidate,
  b: StagingConsiderationCandidate
): number {
  if (a.location_id < b.location_id) return -1;
  if (a.location_id > b.location_id) return 1;
  return 0;
}

/**
 * Pure Department Staging Consideration evaluator.
 * Deterministic given identical evidence + as_of.
 */
export function composeDepartmentStagingConsideration(
  input: DepartmentStagingConsiderationInput
): DepartmentStagingConsiderationAssessment {
  const base = {
    department_id: input.department_id,
    iso_week: input.iso_week,
    as_of: input.as_of,
    method: DEPARTMENT_STAGING_CONSIDERATION_METHOD,
    method_version: DEPARTMENT_STAGING_CONSIDERATION_VERSION,
  } as const;

  if (
    !input.planning_evidence_available ||
    !input.staged_state_evidence_available
  ) {
    return emptyUnavailable(input);
  }

  if (!isConsistentStagingPlanning(input.planning)) {
    return emptyUnavailable(input);
  }

  const planning: StagingConsiderationPlanning = {
    target: input.planning.target,
    staged: input.planning.staged,
    staging_deficit: input.planning.staging_deficit,
  };

  if (planning.staging_deficit === 0) {
    return {
      ...base,
      planning,
      candidates: [],
      status: "NO_ADDITIONAL_STAGING_NEEDED",
    };
  }

  // deficit > 0 — attention evidence required for a successful AVAILABLE result
  if (!input.attention_evidence_available) {
    return emptyUnavailable(input);
  }

  const stagedIds = new Set(input.staged_location_ids);
  const { byLocation, hasConflict } = resolveAttentionByLocation(
    input.attention_signals
  );

  // Conflicting SI evidence ≠ empty successful pool (deficit > 0 path only).
  if (hasConflict) {
    return emptyUnavailable(input);
  }

  const candidates: StagingConsiderationCandidate[] = [];
  for (const signal of byLocation.values()) {
    if (!qualifiesForStagingConsideration(signal, stagedIds)) continue;
    candidates.push(toCandidate(signal));
  }

  candidates.sort(compareCandidatesByLocationId);

  return {
    ...base,
    planning,
    candidates,
    status: "AVAILABLE",
  };
}
