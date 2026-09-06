/**
 * SI-001 Current location attention pressure — Layer-1 deterministic derivation.
 *
 * Method: location-attention-pressure-v1
 *
 * Composes present operational facts + declared seasonal claims into:
 * pressure · actionability · confidence · reasons
 *
 * Does NOT: assign work, weight Sunday draw, predict futures, persist, call LLMs,
 * consume manual draw-priority counters/overrides, or mutate Layer 0.
 *
 * Constitutional posture: complies with Arts VII–XI, XIII, XV, XX (extends
 * existing Layer-1 derivation practice; no amendment).
 *
 * ---------------------------------------------------------------------------
 * PRESSURE RULE TABLE (v1)
 * ---------------------------------------------------------------------------
 * 1. GATE — inactive or non-aisle-eligible → pressure NONE + GATE reason.
 * 2. coverage_history from last_completed_at (null → NONE; else PRESENT).
 *    Null age NEVER invents overdue / stale / 365-day fiction.
 * 3. Operational need families (when evidence dims are available):
 *      COVERAGE_STALE | CADENCE_OVERDUE | CARRYOVER_OPEN |
 *      VERIFICATION_PENDING | BARRIER_OPEN
 *    NO_COVERAGE_HISTORY, velocity, and seasonality alone are NOT need.
 * 4. Base tier from need-family count:
 *      0 → NONE (or LOW if weak non-need signals — §5)
 *      1 → MEDIUM
 *      2+ → HIGH
 * 5. Weak non-need (no operational need):
 *      NO_COVERAGE_HISTORY alone → LOW
 *      any seasonal claim with relevance ≠ NONE → LOW
 *      else → NONE
 * 6. Velocity MODIFY (at most +1, only when need + base MEDIUM):
 *      velocity_tier high | critical_hotspot → MEDIUM → HIGH
 * 7. Seasonal composition (bounded; strongest eligible claim wins once):
 *      Resolve strongest eligible relevance across all claims (see §SEASONAL).
 *      Location NONE for a context suppresses only that location claim;
 *      department claim for the same context remains independent.
 *      When operational need exists:
 *        strongest LOW    → no tier raise; claim effects CONTEXT
 *        strongest MEDIUM → no tier raise; contributing claims effect MODIFY
 *        strongest HIGH   → at most +1 (MEDIUM → HIGH); HIGH claims MODIFY
 *      When no need: all seasonal effects CONTEXT; pressure stays §5.
 * 8. Clamp to NONE | LOW | MEDIUM | HIGH. CRITICAL deferred.
 *
 * ---------------------------------------------------------------------------
 * SEASONAL STRENGTH (LOW < MEDIUM < HIGH)
 * ---------------------------------------------------------------------------
 * Eligible contributions: each dept/location claim with relevance LOW|MEDIUM|HIGH.
 * Location NONE: not an eligible contribution (still emits CONTEXT reason).
 * Overlap: preserve every reason; pressure uses max strength once (no ratchet).
 *
 * ---------------------------------------------------------------------------
 * CONFIDENCE (evidence maturity — orthogonal to actionability & pressure)
 * ---------------------------------------------------------------------------
 * See composeAttentionConfidence. Does not use BLOCKED/UNKNOWN/ACTIONABLE.
 *
 * ---------------------------------------------------------------------------
 * EMPTY VS UNAVAILABLE (caller contract)
 * ---------------------------------------------------------------------------
 * *_evidence_available = true  → arrays/nulls mean positively resolved empty/absent.
 * *_evidence_available = false → dimension not loaded; SI must not treat emptiness
 *                                as “none known” for confidence maturity, and must
 *                                not invent need from that dimension.
 *
 * Clock: pure assessment uses only input.as_of + operational_date.
 * generated_at via attachAttentionGeneratedAt (outer).
 */

import { BAY_STALE_DAYS, daysSinceIso } from "./bay-health";
import { isEligibleRotationLocation } from "./location-eligibility";
import type {
  ExceptionReason,
  RotationVerificationStatus,
  VelocityTier,
} from "./types";
import { parseVelocityTier, resolveDecayDays } from "./velocity";

/** Stable method id for SI-001 Layer-1 claims. */
export const LOCATION_ATTENTION_PRESSURE_METHOD =
  "location-attention-pressure-v1" as const;

export const LOCATION_ATTENTION_PRESSURE_VERSION = 1 as const;

/** CRITICAL deferred — see module header. */
export type AttentionPressure = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type AttentionConfidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * ACTIONABLE — known evidence does not show a physical block.
 * BLOCKED — at least one canonical physical-blocker barrier is open.
 * UNKNOWN — open barrier reason is not in the reviewed blocker/non-blocker sets.
 */
export type AttentionActionability = "ACTIONABLE" | "BLOCKED" | "UNKNOWN";

export type CoverageHistory = "NONE" | "PRESENT";

/**
 * GATE — eligibility stop.
 * RAISE — establishes / contributes to operational need.
 * MODIFY — bounded seasonal/velocity adjustment semantics when need exists.
 * CONTEXT — explanatory; does not raise pressure tier.
 */
export type AttentionReasonEffect = "RAISE" | "MODIFY" | "CONTEXT" | "GATE";

export type AttentionReasonCode =
  | "LOCATION_INACTIVE"
  | "LOCATION_INELIGIBLE"
  | "NO_COVERAGE_HISTORY"
  | "COVERAGE_STALE"
  | "CADENCE_OVERDUE"
  | "COVERAGE_FRESH"
  | "VERIFICATION_PENDING"
  | "CARRYOVER_OPEN"
  | "BARRIER_OPEN"
  | "VELOCITY_HIGH"
  | "VELOCITY_CRITICAL"
  | "SEASONAL_DEPARTMENT_LOW"
  | "SEASONAL_DEPARTMENT_MEDIUM"
  | "SEASONAL_DEPARTMENT_HIGH"
  | "SEASONAL_DEPARTMENT_NONE"
  | "SEASONAL_LOCATION_LOW"
  | "SEASONAL_LOCATION_MEDIUM"
  | "SEASONAL_LOCATION_HIGH"
  | "SEASONAL_LOCATION_NONE";

export type OperationalContextKind = "SEASON" | "EVENT";

export type OperationalContextRelevanceLevel =
  | "NONE"
  | "LOW"
  | "MEDIUM"
  | "HIGH";

/** Active declared department relevance for one context (FS-002). */
export type ActiveDepartmentRelevanceClaim = {
  context_id: string;
  context_kind: OperationalContextKind;
  relevance: OperationalContextRelevanceLevel;
};

/** Active declared location relevance for one context (FS-003). */
export type ActiveLocationRelevanceClaim = {
  context_id: string;
  context_kind: OperationalContextKind;
  relevance: OperationalContextRelevanceLevel;
};

export type AttentionBarrierEvidence = {
  reason: ExceptionReason | string;
  created_at: string;
};

/**
 * Normalized evidence only — no StoreLocation / WeeklyRotation / full context rows.
 * Manual draw-priority fields are intentionally omitted from this contract.
 *
 * Availability flags distinguish empty (resolved none) from unavailable (not loaded).
 */
export type LocationAttentionInput = {
  location_id: string;
  is_active: boolean;
  location_type: string | null;
  /** ≈ last verified close (DS verify / auto-verify). */
  last_completed_at: string | null;
  velocity_tier: VelocityTier | string | null;
  custom_decay_days: number | null;
  carried_over: boolean;
  location_status: string | null;
  /**
   * Active week row status. Null means no staged row only when
   * current_rotation_evidence_available is true.
   */
  verification_status: RotationVerificationStatus | string | null;
  open_barriers: ReadonlyArray<AttentionBarrierEvidence>;
  department_relevance_claims: ReadonlyArray<ActiveDepartmentRelevanceClaim>;
  location_relevance_claims: ReadonlyArray<ActiveLocationRelevanceClaim>;
  /**
   * true → verification_status null/value is authoritative for this assessment.
   * false → rotation dimension unavailable; do not invent verification need.
   */
  current_rotation_evidence_available: boolean;
  /**
   * true → open_barriers is the complete resolved set (possibly empty).
   * false → barriers not loaded; ignore array for need/confidence.
   */
  barrier_evidence_available: boolean;
  /**
   * true → claim arrays are complete resolved seasonal evidence (possibly empty).
   * false → contexts not resolved; ignore claim arrays for need/confidence.
   */
  seasonal_context_evidence_available: boolean;
  operational_date: string;
  as_of: string;
};

type ReasonEvidence = {
  days_since_verified?: number;
  stale_after_days?: number;
  expected_decay_days?: number;
  velocity_tier?: string;
  reason?: string;
  created_at?: string;
  context_id?: string;
  context_kind?: OperationalContextKind;
  relevance?: OperationalContextRelevanceLevel;
  location_type?: string;
};

export type LocationAttentionReason = {
  code: AttentionReasonCode;
  effect: AttentionReasonEffect;
  evidence: ReasonEvidence;
};

/** Pure semantic result — no generated_at (clock-free). */
export type LocationAttentionAssessment = {
  location_id: string;
  operational_date: string;
  pressure: AttentionPressure;
  actionability: AttentionActionability;
  confidence: AttentionConfidence;
  coverage_history: CoverageHistory;
  reasons: LocationAttentionReason[];
  /**
   * Count of independent evidence families with material observations.
   * See countEvidenceFamilies — not object-cardinality / reasons.length.
   */
  evidence_count: number;
  method: typeof LOCATION_ATTENTION_PRESSURE_METHOD;
  method_version: typeof LOCATION_ATTENTION_PRESSURE_VERSION;
};

export type LocationAttentionSignal = LocationAttentionAssessment & {
  generated_at: string;
};

export const PHYSICAL_BLOCKER_BARRIER_REASONS = [
  "Blocked Bay",
  "Freight/Pallets In Aisle",
] as const satisfies ReadonlyArray<ExceptionReason>;

export const NON_BLOCKING_BARRIER_REASONS = [
  "Unpalletized Top-Stock",
  "Missing SIMS Tags",
  "Short Staffed",
  "High Customer Volume",
] as const satisfies ReadonlyArray<ExceptionReason>;

const PHYSICAL_BLOCKER_SET = new Set<string>(PHYSICAL_BLOCKER_BARRIER_REASONS);
const NON_BLOCKING_SET = new Set<string>(NON_BLOCKING_BARRIER_REASONS);

export type BarrierActionabilityClass =
  | "BLOCKING"
  | "NON_BLOCKING"
  | "UNKNOWN";

/** Rank for seasonal strength: NONE=0, LOW=1, MEDIUM=2, HIGH=3. */
export type SeasonalStrengthRank = 0 | 1 | 2 | 3;

export function classifyBarrierActionability(
  reason: string
): BarrierActionabilityClass {
  const key = String(reason ?? "").trim();
  if (PHYSICAL_BLOCKER_SET.has(key)) return "BLOCKING";
  if (NON_BLOCKING_SET.has(key)) return "NON_BLOCKING";
  return "UNKNOWN";
}

/** SI eligibility — same neutral helper as rotation metrics. */
export function isEligibleAttentionLocation(input: {
  is_active: boolean;
  location_type: string | null;
}): boolean {
  return isEligibleRotationLocation(input);
}

function isCarryoverOpen(input: LocationAttentionInput): boolean {
  if (input.carried_over === true) return true;
  return String(input.location_status ?? "").toUpperCase() === "CARRIED_OVER";
}

function isVerificationPending(
  status: LocationAttentionInput["verification_status"]
): boolean {
  return String(status ?? "").toUpperCase() === "PENDING_VERIFICATION";
}

function pressureRank(p: AttentionPressure): number {
  if (p === "HIGH") return 3;
  if (p === "MEDIUM") return 2;
  if (p === "LOW") return 1;
  return 0;
}

function pressureFromRank(rank: number): AttentionPressure {
  if (rank >= 3) return "HIGH";
  if (rank === 2) return "MEDIUM";
  if (rank === 1) return "LOW";
  return "NONE";
}

function bumpPressure(p: AttentionPressure): AttentionPressure {
  return pressureFromRank(Math.min(3, pressureRank(p) + 1));
}

function relevanceRank(
  relevance: OperationalContextRelevanceLevel
): SeasonalStrengthRank {
  if (relevance === "HIGH") return 3;
  if (relevance === "MEDIUM") return 2;
  if (relevance === "LOW") return 1;
  return 0;
}

/**
 * Actionability from open barriers only (orthogonal to pressure & confidence).
 * When barrier evidence unavailable → ACTIONABLE (no invented block).
 */
export function composeAttentionActionability(
  barriers: ReadonlyArray<AttentionBarrierEvidence>,
  barrierEvidenceAvailable: boolean
): AttentionActionability {
  if (!barrierEvidenceAvailable) return "ACTIONABLE";
  let sawUnknown = false;
  for (const b of barriers) {
    const cls = classifyBarrierActionability(b.reason);
    if (cls === "BLOCKING") return "BLOCKED";
    if (cls === "UNKNOWN") sawUnknown = true;
  }
  return sawUnknown ? "UNKNOWN" : "ACTIONABLE";
}

/**
 * Independent evidence families with material observations (not cardinality).
 *
 * +1 verified coverage observation (last_completed_at present)
 * +1 current rotation row present (available + non-null status)
 * +1 barrier set non-empty (available + ≥1 barrier) — set, not per row
 * +1 seasonal claim set non-empty (available + ≥1 claim) — set, not per claim
 * +1 carryover currently open
 *
 * Does not count eligibility, cadence config alone, or empty resolved dims.
 * Does not drive pressure.
 */
export function countEvidenceFamilies(input: LocationAttentionInput): number {
  let n = 0;
  if (input.last_completed_at) n += 1;
  if (
    input.current_rotation_evidence_available &&
    input.verification_status != null &&
    String(input.verification_status) !== ""
  ) {
    n += 1;
  }
  if (input.barrier_evidence_available && input.open_barriers.length > 0) {
    n += 1;
  }
  if (
    input.seasonal_context_evidence_available &&
    (input.department_relevance_claims.length > 0 ||
      input.location_relevance_claims.length > 0)
  ) {
    n += 1;
  }
  if (isCarryoverOpen(input)) n += 1;
  return n;
}

/** @deprecated alias — prefer countEvidenceFamilies */
export const countEvidenceAtoms = countEvidenceFamilies;

function hasSubstantiveCurrentObservation(
  input: LocationAttentionInput
): boolean {
  if (isCarryoverOpen(input)) return true;
  if (
    input.current_rotation_evidence_available &&
    input.verification_status != null &&
    String(input.verification_status) !== ""
  ) {
    return true;
  }
  if (input.barrier_evidence_available && input.open_barriers.length > 0) {
    return true;
  }
  if (
    input.seasonal_context_evidence_available &&
    (input.department_relevance_claims.length > 0 ||
      input.location_relevance_claims.length > 0)
  ) {
    return true;
  }
  return false;
}

/**
 * Confidence = evidence maturity / completeness for the assessment.
 * Orthogonal to actionability and pressure magnitude.
 *
 * Dimensions (positively available):
 *   rotation · barriers · seasonal contexts
 *
 * Longitudinal: coverage_history PRESENT vs NONE
 *
 * LOW — no verified history AND (<2 current dims available OR no substantive
 *       current observation).
 * MEDIUM — verified history without full current-state resolution + substance,
 *          OR no history but ≥2 dims available with substantive current facts.
 * HIGH — verified history AND all three current dims available AND at least
 *        one substantive current observation (row / barrier / claim / carryover).
 *
 * Fresh + all dims available + empty current observations → MEDIUM (not HIGH).
 * BLOCKED / UNKNOWN never force confidence tiers.
 */
export function composeAttentionConfidence(input: {
  coverage_history: CoverageHistory;
  current_rotation_evidence_available: boolean;
  barrier_evidence_available: boolean;
  seasonal_context_evidence_available: boolean;
  substantive_current: boolean;
}): AttentionConfidence {
  const dims =
    Number(input.current_rotation_evidence_available) +
    Number(input.barrier_evidence_available) +
    Number(input.seasonal_context_evidence_available);

  if (input.coverage_history === "NONE") {
    if (dims >= 2 && input.substantive_current) return "MEDIUM";
    return "LOW";
  }

  if (dims === 3 && input.substantive_current) return "HIGH";
  return "MEDIUM";
}

/**
 * Strongest eligible seasonal contribution across all claims.
 * Location NONE does not contribute; department claims remain independent.
 */
export function resolveStrongestSeasonalStrength(
  dept: ReadonlyArray<ActiveDepartmentRelevanceClaim>,
  loc: ReadonlyArray<ActiveLocationRelevanceClaim>
): SeasonalStrengthRank {
  let best: SeasonalStrengthRank = 0;
  for (const c of dept) {
    const r = relevanceRank(c.relevance);
    if (r > best) best = r;
  }
  for (const c of loc) {
    const r = relevanceRank(c.relevance);
    if (r > best) best = r;
  }
  return best;
}

function compareReasons(
  a: LocationAttentionReason,
  b: LocationAttentionReason
): number {
  const code = a.code.localeCompare(b.code);
  if (code !== 0) return code;
  const ca = String(a.evidence.context_id ?? "");
  const cb = String(b.evidence.context_id ?? "");
  const c = ca.localeCompare(cb);
  if (c !== 0) return c;
  const ra = String(a.evidence.reason ?? "");
  const rb = String(b.evidence.reason ?? "");
  const r = ra.localeCompare(rb);
  if (r !== 0) return r;
  return String(a.evidence.created_at ?? "").localeCompare(
    String(b.evidence.created_at ?? "")
  );
}

function sortReasons(
  reasons: LocationAttentionReason[]
): LocationAttentionReason[] {
  return [...reasons].sort(compareReasons);
}

function seasonalDeptCode(
  relevance: OperationalContextRelevanceLevel
): AttentionReasonCode {
  if (relevance === "HIGH") return "SEASONAL_DEPARTMENT_HIGH";
  if (relevance === "MEDIUM") return "SEASONAL_DEPARTMENT_MEDIUM";
  if (relevance === "LOW") return "SEASONAL_DEPARTMENT_LOW";
  return "SEASONAL_DEPARTMENT_NONE";
}

function seasonalLocCode(
  relevance: OperationalContextRelevanceLevel
): AttentionReasonCode {
  if (relevance === "HIGH") return "SEASONAL_LOCATION_HIGH";
  if (relevance === "MEDIUM") return "SEASONAL_LOCATION_MEDIUM";
  if (relevance === "LOW") return "SEASONAL_LOCATION_LOW";
  return "SEASONAL_LOCATION_NONE";
}

function seasonalClaimEffect(
  relevance: OperationalContextRelevanceLevel,
  operationalNeed: boolean,
  strongest: SeasonalStrengthRank
): AttentionReasonEffect {
  if (!operationalNeed) return "CONTEXT";
  if (relevance === "NONE" || relevance === "LOW") return "CONTEXT";
  // Only claims matching the strongest MEDIUM/HIGH level mark MODIFY.
  if (relevanceRank(relevance) === strongest && strongest >= 2) return "MODIFY";
  return "CONTEXT";
}

/**
 * Pure deterministic SI-001 composition.
 * Same complete input → same semantic assessment (deep-equal reasons order).
 */
export function composeLocationAttentionPressure(
  input: LocationAttentionInput
): LocationAttentionAssessment {
  const reasons: LocationAttentionReason[] = [];
  const asOf = new Date(input.as_of);
  const evidence_count = countEvidenceFamilies(input);

  const base = {
    location_id: input.location_id,
    operational_date: input.operational_date,
    evidence_count,
    method: LOCATION_ATTENTION_PRESSURE_METHOD,
    method_version: LOCATION_ATTENTION_PRESSURE_VERSION,
  } as const;

  const coverage_history: CoverageHistory = input.last_completed_at
    ? "PRESENT"
    : "NONE";

  // --- GATE ---
  if (input.is_active === false) {
    reasons.push({
      code: "LOCATION_INACTIVE",
      effect: "GATE",
      evidence: {},
    });
    return {
      ...base,
      pressure: "NONE",
      actionability: "ACTIONABLE",
      confidence: "LOW",
      coverage_history,
      reasons: sortReasons(reasons),
    };
  }

  if (!isEligibleAttentionLocation(input)) {
    reasons.push({
      code: "LOCATION_INELIGIBLE",
      effect: "GATE",
      evidence: {
        location_type: String(input.location_type ?? "SHOWROOM_STACKOUT"),
      },
    });
    return {
      ...base,
      pressure: "NONE",
      actionability: "ACTIONABLE",
      confidence: "LOW",
      coverage_history,
      reasons: sortReasons(reasons),
    };
  }

  const days_since_verified =
    coverage_history === "PRESENT"
      ? daysSinceIso(input.last_completed_at, asOf)
      : null;

  if (coverage_history === "NONE") {
    reasons.push({
      code: "NO_COVERAGE_HISTORY",
      effect: "CONTEXT",
      evidence: {},
    });
  }

  const tier = parseVelocityTier(input.velocity_tier);
  const expected_decay_days = resolveDecayDays({
    velocity_tier: tier,
    custom_decay_days: input.custom_decay_days,
  });

  let needStale = false;
  let needCadence = false;
  let needCarryover = false;
  let needVerification = false;
  let needBarrier = false;

  if (days_since_verified != null && days_since_verified > BAY_STALE_DAYS) {
    needStale = true;
    reasons.push({
      code: "COVERAGE_STALE",
      effect: "RAISE",
      evidence: {
        days_since_verified,
        stale_after_days: BAY_STALE_DAYS,
      },
    });
  }

  if (
    days_since_verified != null &&
    days_since_verified >= expected_decay_days
  ) {
    needCadence = true;
    reasons.push({
      code: "CADENCE_OVERDUE",
      effect: "RAISE",
      evidence: {
        days_since_verified,
        expected_decay_days,
      },
    });
  }

  if (days_since_verified != null && !needStale && !needCadence) {
    reasons.push({
      code: "COVERAGE_FRESH",
      effect: "CONTEXT",
      evidence: {
        days_since_verified,
        stale_after_days: BAY_STALE_DAYS,
        expected_decay_days,
      },
    });
  }

  if (isCarryoverOpen(input)) {
    needCarryover = true;
    reasons.push({
      code: "CARRYOVER_OPEN",
      effect: "RAISE",
      evidence: {},
    });
  }

  if (
    input.current_rotation_evidence_available &&
    isVerificationPending(input.verification_status)
  ) {
    needVerification = true;
    reasons.push({
      code: "VERIFICATION_PENDING",
      effect: "RAISE",
      evidence: {},
    });
  }

  const barriers = input.barrier_evidence_available
    ? [...input.open_barriers].sort((a, b) => {
        const r = String(a.reason).localeCompare(String(b.reason));
        if (r !== 0) return r;
        return String(a.created_at).localeCompare(String(b.created_at));
      })
    : [];

  for (const b of barriers) {
    needBarrier = true;
    reasons.push({
      code: "BARRIER_OPEN",
      effect: "RAISE",
      evidence: {
        reason: String(b.reason),
        created_at: String(b.created_at),
      },
    });
  }

  const actionability = composeAttentionActionability(
    barriers,
    input.barrier_evidence_available
  );

  const needFamilyCount =
    Number(needStale) +
    Number(needCadence) +
    Number(needCarryover) +
    Number(needVerification) +
    Number(needBarrier);

  const operationalNeed = needFamilyCount > 0;

  if (tier === "critical_hotspot") {
    reasons.push({
      code: "VELOCITY_CRITICAL",
      effect: operationalNeed ? "MODIFY" : "CONTEXT",
      evidence: { velocity_tier: tier },
    });
  } else if (tier === "high") {
    reasons.push({
      code: "VELOCITY_HIGH",
      effect: operationalNeed ? "MODIFY" : "CONTEXT",
      evidence: { velocity_tier: tier },
    });
  }

  const deptClaims = input.seasonal_context_evidence_available
    ? [...input.department_relevance_claims].sort((a, b) => {
        const c = a.context_id.localeCompare(b.context_id);
        if (c !== 0) return c;
        return a.relevance.localeCompare(b.relevance);
      })
    : [];
  const locClaims = input.seasonal_context_evidence_available
    ? [...input.location_relevance_claims].sort((a, b) => {
        const c = a.context_id.localeCompare(b.context_id);
        if (c !== 0) return c;
        return a.relevance.localeCompare(b.relevance);
      })
    : [];

  const strongest = resolveStrongestSeasonalStrength(deptClaims, locClaims);

  for (const c of deptClaims) {
    reasons.push({
      code: seasonalDeptCode(c.relevance),
      effect: seasonalClaimEffect(c.relevance, operationalNeed, strongest),
      evidence: {
        context_id: c.context_id,
        context_kind: c.context_kind,
        relevance: c.relevance,
      },
    });
  }

  for (const c of locClaims) {
    reasons.push({
      code: seasonalLocCode(c.relevance),
      effect: seasonalClaimEffect(c.relevance, operationalNeed, strongest),
      evidence: {
        context_id: c.context_id,
        context_kind: c.context_kind,
        relevance: c.relevance,
      },
    });
  }

  // --- Base pressure ---
  let pressure: AttentionPressure = "NONE";
  if (needFamilyCount >= 2) {
    pressure = "HIGH";
  } else if (needFamilyCount === 1) {
    pressure = "MEDIUM";
  } else if (coverage_history === "NONE") {
    pressure = "LOW";
  } else if (strongest >= 1) {
    pressure = "LOW";
  }

  // Bounded velocity +1 (MEDIUM → HIGH only)
  if (
    operationalNeed &&
    (tier === "high" || tier === "critical_hotspot") &&
    pressure === "MEDIUM"
  ) {
    pressure = bumpPressure(pressure);
  }

  // Bounded seasonal: only strongest HIGH raises (+1 once). LOW/MEDIUM do not.
  if (operationalNeed && strongest === 3 && pressure === "MEDIUM") {
    pressure = bumpPressure(pressure);
  }

  const confidence = composeAttentionConfidence({
    coverage_history,
    current_rotation_evidence_available:
      input.current_rotation_evidence_available,
    barrier_evidence_available: input.barrier_evidence_available,
    seasonal_context_evidence_available:
      input.seasonal_context_evidence_available,
    substantive_current: hasSubstantiveCurrentObservation(input),
  });

  return {
    ...base,
    pressure,
    actionability,
    confidence,
    coverage_history,
    reasons: sortReasons(reasons),
  };
}

export function attachAttentionGeneratedAt(
  assessment: LocationAttentionAssessment,
  generated_at: string
): LocationAttentionSignal {
  return { ...assessment, generated_at };
}

export function assessmentHasOperationalNeed(
  assessment: LocationAttentionAssessment
): boolean {
  return assessment.reasons.some(
    (r) =>
      r.effect === "RAISE" &&
      (r.code === "COVERAGE_STALE" ||
        r.code === "CADENCE_OVERDUE" ||
        r.code === "CARRYOVER_OPEN" ||
        r.code === "VERIFICATION_PENDING" ||
        r.code === "BARRIER_OPEN")
  );
}
