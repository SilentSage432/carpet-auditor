/**
 * Canonical Layer-1 weekly rotation metrics (Art VI / VII / VIII).
 * Deterministic derivations only — does not persist, forecast, or mutate Layer 0.
 *
 * Method: weekly-rotation-metrics-v1
 * Readiness companion: floor-readiness-v1 (lib/store-ops/floor-readiness.ts)
 */

import { BAY_STALE_DAYS, daysSinceIso } from "./bay-health";
import type {
  StoreLocation,
  WeeklyRotationWithLocation,
} from "./types";
import { resolveWeeklyBayTarget } from "./week";

/** Stable method id for weekly rotation Layer-1 claims. */
export const WEEKLY_ROTATION_METRICS_METHOD = "weekly-rotation-metrics-v1";

/** Stable method id for Floor readiness headline (freshness + week context). */
export const FLOOR_READINESS_METHOD = "floor-readiness-v1";

export type RotationMetricRow = {
  is_completed?: boolean | null;
  verification_status?: string | null;
  completed_at?: string | null;
  verified_at?: string | null;
};

export type WeeklyRotationMetrics = {
  method: typeof WEEKLY_ROTATION_METRICS_METHOD;
  /** Active aisle/standard locations in scope (excludes showroom stack-out). */
  eligible: number;
  /** Week rotation rows in scope. */
  staged: number;
  /** Submitted / closed operationally (`is_completed` or review past PENDING). */
  reportedComplete: number;
  /** Explicitly awaiting DS review. */
  pendingVerification: number;
  /** Authoritative DS verification only (`verification_status = VERIFIED_COMPLETE`). */
  verifiedComplete: number;
  /**
   * Staged work not yet verified complete.
   * Includes open + pending verification + any reported-without-verify legacy rows.
   */
  open: number;
  /** Eligible locations whose last_completed_at is null or older than BAY_STALE_DAYS. */
  stale: number;
  /** Configured weekly bay target for the department/scope. */
  target: number;
  /** max(0, target − verifiedComplete) — Art VI readiness deficit. */
  verifiedTargetDeficit: number;
  /** max(0, target − staged) — staging shortfall vs target (separate concept). */
  stagingDeficit: number;
};

/**
 * Verified complete — Art VI.
 * Does NOT infer from `is_completed` alone (A-1).
 */
export function isRotationVerifiedComplete(
  row: RotationMetricRow | null | undefined
): boolean {
  return (
    String(row?.verification_status ?? "").toUpperCase() === "VERIFIED_COMPLETE"
  );
}

/** Explicit DS review queue state. */
export function isRotationPendingVerification(
  row: RotationMetricRow | null | undefined
): boolean {
  return (
    String(row?.verification_status ?? "").toUpperCase() ===
    "PENDING_VERIFICATION"
  );
}

/**
 * Reported complete — associate/actor submit or already verified.
 * Includes pending verification and verified; not mere staging.
 */
export function isRotationReportedComplete(
  row: RotationMetricRow | null | undefined
): boolean {
  if (!row) return false;
  if (isRotationVerifiedComplete(row) || isRotationPendingVerification(row)) {
    return true;
  }
  return Boolean(row.is_completed);
}

/**
 * Eligible for weekly aisle rotation / cycle readiness denominator.
 * Matches draw filters: active + not SHOWROOM_STACKOUT.
 */
export function isEligibleRotationLocation(
  loc: Pick<StoreLocation, "is_active" | "location_type"> | null | undefined
): boolean {
  if (!loc) return false;
  if (loc.is_active === false) return false;
  return (loc.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT";
}

export function countEligibleLocations(
  locations: Array<
    Pick<StoreLocation, "is_active" | "location_type"> | null | undefined
  >
): number {
  return locations.filter((loc) => isEligibleRotationLocation(loc)).length;
}

export function countStaleEligibleLocations(
  locations: Array<
    Pick<
      StoreLocation,
      "is_active" | "location_type" | "last_completed_at"
    > | null | undefined
  >,
  now: Date = new Date()
): number {
  let n = 0;
  for (const loc of locations) {
    if (!isEligibleRotationLocation(loc)) continue;
    const age = daysSinceIso(loc?.last_completed_at, now);
    if (age == null || age > BAY_STALE_DAYS) n += 1;
  }
  return n;
}

/**
 * Map week-overlay "completed this week" for readiness tones.
 * Prefer explicit verification; `last_completed_at` is verification-backed when set.
 */
export function isWeekVerifiedForMapOverlay(
  row: RotationMetricRow | null | undefined
): boolean {
  return isRotationVerifiedComplete(row);
}

/**
 * Verification lag in milliseconds when both timestamps survive.
 * Send-back clears completed_at — those rows yield null (limitation documented).
 */
export function verificationLagMs(
  row: RotationMetricRow | null | undefined
): number | null {
  if (!isRotationVerifiedComplete(row)) return null;
  const completed = Date.parse(String(row?.completed_at ?? ""));
  const verified = Date.parse(String(row?.verified_at ?? ""));
  if (!Number.isFinite(completed) || !Number.isFinite(verified)) return null;
  return Math.max(0, verified - completed);
}

export function verificationLagHours(
  row: RotationMetricRow | null | undefined
): number | null {
  const ms = verificationLagMs(row);
  if (ms == null) return null;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export function composeWeeklyRotationMetrics(input: {
  rotations: Array<RotationMetricRow | WeeklyRotationWithLocation>;
  weeklyTarget?: number | null;
  locations?: Array<
    Pick<
      StoreLocation,
      "is_active" | "location_type" | "last_completed_at"
    > | null | undefined
  >;
  now?: Date;
}): WeeklyRotationMetrics {
  const rotations = input.rotations ?? [];
  const staged = rotations.length;
  let reportedComplete = 0;
  let pendingVerification = 0;
  let verifiedComplete = 0;

  for (const row of rotations) {
    if (isRotationReportedComplete(row)) reportedComplete += 1;
    if (isRotationPendingVerification(row)) pendingVerification += 1;
    if (isRotationVerifiedComplete(row)) verifiedComplete += 1;
  }

  const open = Math.max(0, staged - verifiedComplete);
  const target = resolveWeeklyBayTarget(input.weeklyTarget);
  const locations = input.locations ?? [];
  const eligible =
    locations.length > 0 ? countEligibleLocations(locations) : 0;
  const stale =
    locations.length > 0
      ? countStaleEligibleLocations(locations, input.now)
      : 0;

  return {
    method: WEEKLY_ROTATION_METRICS_METHOD,
    eligible,
    staged,
    reportedComplete,
    pendingVerification,
    verifiedComplete,
    open,
    stale,
    target,
    verifiedTargetDeficit: Math.max(0, target - verifiedComplete),
    stagingDeficit: Math.max(0, target - staged),
  };
}

/**
 * Compact Floor week line — verified vs awaiting review, never ambiguous "complete".
 * Example: `12 staged · 4 verified · 2 awaiting review`
 */
export function composeFloorWeekProgressLine(
  metrics: Pick<
    WeeklyRotationMetrics,
    "staged" | "verifiedComplete" | "pendingVerification" | "open"
  >
): string {
  const staged = Math.max(0, Math.floor(metrics.staged));
  if (staged <= 0) return "No bays staged this week";

  const verified = Math.max(0, Math.floor(metrics.verifiedComplete));
  const awaiting = Math.max(0, Math.floor(metrics.pendingVerification));
  const parts = [`${staged} staged`, `${verified} verified`];
  if (awaiting > 0) {
    parts.push(`${awaiting} awaiting review`);
  } else {
    const stillOpen = Math.max(0, Math.floor(metrics.open));
    if (stillOpen > 0) parts.push(`${stillOpen} open`);
  }
  return parts.join(" · ");
}
