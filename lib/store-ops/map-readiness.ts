/**
 * Store Map readiness tones — visual state only.
 * Composes bay-health stale days + ISO week + rotation/barrier flags.
 * Does not persist, recommend, or own completions.
 */

import { BAY_STALE_DAYS, daysSinceIso } from "./bay-health";
import type { RotationStatus } from "./types";
import { isoTimestampInWeek } from "./week";

export const BAY_READINESS_EVENT = "deptsync:bay-readiness";

export type MapReadinessTone =
  | "verified"
  | "scheduled"
  | "attention"
  | "idle";

export type MapReadinessInput = {
  lastCompletedAt?: string | null;
  status?: RotationStatus | string | null;
  inCurrentWeekRotation?: boolean;
  currentWeekCompleted?: boolean;
  hasBarrier?: boolean;
  weekLabel?: string;
  now?: Date;
};

export type BayReadinessEventDetail = {
  locationIds: string[];
  tone: MapReadinessTone;
};

export function emitBayReadiness(detail: BayReadinessEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BayReadinessEventDetail>(BAY_READINESS_EVENT, { detail })
  );
}

/**
 * Green: verified this ISO week (verification_status or last_completed_at in week).
 * Yellow: on this week's rotation, not yet verified.
 * Red: stale >7d or active barrier.
 * Idle: mapped, none of the above.
 *
 * `currentWeekCompleted` MUST mean verified — pending verification must not paint green.
 * `last_completed_at` is set only on DS verify / auto-verify close.
 */
export function classifyMapReadiness(
  input: MapReadinessInput
): MapReadinessTone {
  const week = String(input.weekLabel ?? "").trim();
  const completedThisWeek =
    Boolean(input.currentWeekCompleted) ||
    (week.length > 0 &&
      isoTimestampInWeek(input.lastCompletedAt ?? null, week));

  if (completedThisWeek) return "verified";
  if (input.hasBarrier) return "attention";

  const ageDays = daysSinceIso(input.lastCompletedAt, input.now ?? new Date());
  if (ageDays == null || ageDays > BAY_STALE_DAYS) return "attention";

  if (input.inCurrentWeekRotation || input.status === "ASSIGNED") {
    return "scheduled";
  }
  return "idle";
}

export function worstMapReadiness(
  tones: Iterable<MapReadinessTone>
): MapReadinessTone {
  let worst: MapReadinessTone = "idle";
  for (const tone of tones) {
    if (tone === "attention") return "attention";
    if (tone === "scheduled") worst = "scheduled";
    else if (tone === "verified" && worst === "idle") worst = "verified";
  }
  return worst;
}

export function mapReadinessDotClass(tone: MapReadinessTone): string {
  if (tone === "verified") {
    return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]";
  }
  if (tone === "scheduled") {
    return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]";
  }
  if (tone === "attention") {
    return "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.75)]";
  }
  return "bg-zinc-600";
}

export function mapReadinessLabel(tone: MapReadinessTone): string {
  if (tone === "verified") return "Verified this week";
  if (tone === "scheduled") return "Scheduled / pending";
  if (tone === "attention") return "Stale or barrier";
  return "Mapped";
}
