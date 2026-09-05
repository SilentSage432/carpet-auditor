/**
 * Floor readiness headline — Layer-1 freshness + week context (floor-readiness-v1).
 * Stale uses store_locations.last_completed_at (set on DS verify / auto-verify).
 * Week appendix uses verified / awaiting review — never ambiguous "complete" (Art VI).
 */

import {
  FLOOR_READINESS_METHOD,
  type WeeklyRotationMetrics,
} from "@/lib/store-ops/rotation-metrics";
import { resolveWeeklyBayTarget } from "@/lib/store-ops/week";

export type FloorReadinessInput = {
  totalBays: number;
  staleCount: number;
  weeklyTarget?: number | null;
  /** Prefer canonical weekly metrics when available. */
  weekMetrics?: Pick<
    WeeklyRotationMetrics,
    "staged" | "verifiedComplete" | "pendingVerification" | "open"
  > | null;
  /**
   * @deprecated Use weekMetrics — open count that excludes only reported-complete
   * was ambiguous under Art VI.
   */
  weekOpen?: number;
  /**
   * @deprecated Use weekMetrics.verifiedComplete — must not mean reported-complete.
   */
  weekComplete?: number;
};

/**
 * Truthful mobile line for Floor header.
 * Freshness is verification-backed via last_completed_at.
 * Week context prefers staged / verified / awaiting review.
 */
export function composeFloorReadinessLine(input: FloorReadinessInput): string {
  const total = Math.max(0, Math.floor(input.totalBays));
  const stale = Math.max(0, Math.min(total, Math.floor(input.staleCount)));
  if (total <= 0) {
    return "Readiness: no mapped bays yet";
  }

  const target = resolveWeeklyBayTarget(input.weeklyTarget);
  const parts = [
    `Readiness: ${stale} of ${total} currently stale · target ${target}/week`,
  ];

  const week = input.weekMetrics;
  if (week && week.staged > 0) {
    const verified = Math.max(0, Math.floor(week.verifiedComplete));
    const awaiting = Math.max(0, Math.floor(week.pendingVerification));
    const weekBits = [
      `${Math.floor(week.staged)} staged`,
      `${verified} verified`,
    ];
    if (awaiting > 0) weekBits.push(`${awaiting} awaiting review`);
    parts.push(`This week ${weekBits.join(" · ")}`);
    return parts.join(" · ");
  }

  // Legacy path — only emit when callers still pass weekOpen/weekComplete.
  // Treat weekComplete as verified-only if provided without weekMetrics.
  const weekOpen = input.weekOpen;
  const weekComplete = input.weekComplete;
  if (
    weekOpen != null &&
    weekComplete != null &&
    (weekOpen > 0 || weekComplete > 0)
  ) {
    parts.push(
      `This week ${weekOpen} open · ${weekComplete} verified`
    );
  }

  return parts.join(" · ");
}

export { FLOOR_READINESS_METHOD };
