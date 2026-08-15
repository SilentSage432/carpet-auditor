/**
 * Sunday rotation velocity-priority composition.
 * Generate/complete persistence stays in rotations.ts.
 * Consumes velocity.ts — does not recompute cadence or invent draw stats.
 */

import type { StoreLocation } from "./types";
import {
  isCadenceDueForSundayDraw,
  isRotationVelocityPriority,
} from "./velocity";
import { pickWeightedByPriorityAndAge } from "./week";

export { isRotationVelocityPriority };

/** Locations that must sit at the top of the next Sunday staging list. */
export function isCarryOverDrawLocation(
  loc: Pick<
    StoreLocation,
    "status" | "carried_over" | "priority_override"
  >
): boolean {
  return (
    loc.status === "CARRIED_OVER" ||
    loc.carried_over === true ||
    loc.priority_override === true
  );
}

/**
 * Prepend call-out carry-over + priority pins before cadence decay.
 * Deterministic: recent last_carried_over_at first, then status, then pin.
 */
export function pickSundayCarryOverFirst(
  candidates: StoreLocation[],
  count: number
): StoreLocation[] {
  const n = Math.max(0, count);
  if (n === 0 || candidates.length === 0) return [];

  return [...candidates]
    .filter(isCarryOverDrawLocation)
    .sort((a, b) => {
      const rank = (loc: StoreLocation) => {
        if (loc.status === "CARRIED_OVER" || loc.carried_over === true) return 2;
        if (loc.priority_override === true) return 1;
        return 0;
      };
      const d = rank(b) - rank(a);
      if (d !== 0) return d;
      const ta = Date.parse(String(a.last_carried_over_at ?? "")) || 0;
      const tb = Date.parse(String(b.last_carried_over_at ?? "")) || 0;
      if (tb !== ta) return tb - ta;
      const aisle = String(a.aisle).localeCompare(String(b.aisle), undefined, {
        numeric: true,
      });
      if (aisle !== 0) return aisle;
      return Number(a.bay) - Number(b.bay);
    })
    .slice(0, n);
}

/**
 * After carry-over prepend, draw velocity_tier high/critical_hotspot,
 * priority_override, and bays past custom_decay_days before remaining PENDING.
 */
export function pickSundayVelocityPrioritized(
  pending: StoreLocation[],
  remainingCount: number,
  alreadyPickedIds: Iterable<string>
): StoreLocation[] {
  const n = Math.max(0, remainingCount);
  if (n === 0 || pending.length === 0) return [];

  const taken = new Set(alreadyPickedIds);
  const available = pending.filter((loc) => !taken.has(loc.id));
  const hot = available.filter(
    (loc) =>
      isRotationVelocityPriority(loc) || isCadenceDueForSundayDraw(loc)
  );
  const rest = available.filter(
    (loc) =>
      !isRotationVelocityPriority(loc) && !isCadenceDueForSundayDraw(loc)
  );

  const hotPick = pickWeightedByPriorityAndAge(
    hot,
    Math.min(n, hot.length)
  );
  const stillNeed = n - hotPick.length;
  if (stillNeed <= 0) return hotPick;

  return [
    ...hotPick,
    ...pickWeightedByPriorityAndAge(rest, Math.min(stillNeed, rest.length)),
  ];
}
