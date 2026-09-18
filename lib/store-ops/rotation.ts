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

/** True incomplete-work carry-over. Manual High is not carry-over. */
export function isCarryOverDrawLocation(
  loc: Pick<StoreLocation, "status" | "carried_over">
): boolean {
  return loc.status === "CARRIED_OVER" || loc.carried_over === true;
}

/** Durable manual High among currently owed/eligible coverage. */
export function isManualHighPriorityLocation(
  loc: Pick<StoreLocation, "priority_override">
): boolean {
  return loc.priority_override === true;
}

/**
 * Prepend true call-out carry-over before cadence / High / seasonal pressure.
 * Deterministic: recent last_carried_over_at first, then aisle, bay.
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
        if (loc.status === "CARRIED_OVER" || loc.carried_over === true) return 1;
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
 * After carry-over / seasonal / manual High, draw velocity_tier
 * high/critical_hotspot, remaining High, and bays past custom_decay_days
 * before remaining PENDING.
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
