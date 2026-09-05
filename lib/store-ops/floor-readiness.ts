/**
 * Floor readiness headline — composes existing freshness + weekly target.
 * Does not invent cycle-completion ETA or duplicate ownership of bay freshness.
 */

import { resolveWeeklyBayTarget } from "@/lib/store-ops/week";

export type FloorReadinessInput = {
  totalBays: number;
  staleCount: number;
  weeklyTarget?: number | null;
  /** This week's staged open bays (optional weekly context). */
  weekOpen?: number;
  /** This week's completed rotation rows (optional weekly context). */
  weekComplete?: number;
};

/**
 * Truthful mobile line for Floor header.
 * Prefer stale-of-total readiness (authoritative from store_locations freshness).
 * Append weekly target when known. Optionally note this week's open/complete.
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

  const weekOpen = input.weekOpen;
  const weekComplete = input.weekComplete;
  if (
    weekOpen != null &&
    weekComplete != null &&
    (weekOpen > 0 || weekComplete > 0)
  ) {
    parts.push(`This week ${weekOpen} open · ${weekComplete} complete`);
  }

  return parts.join(" · ");
}
