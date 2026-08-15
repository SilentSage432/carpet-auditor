/**
 * Sunday rotation velocity-priority composition.
 * Generate/complete persistence stays in rotations.ts.
 * Consumes velocity.ts — does not recompute cadence or invent draw stats.
 */

import type { StoreLocation } from "./types";
import { isRotationVelocityPriority } from "./velocity";
import { pickWeightedByPriorityAndAge } from "./week";

export { isRotationVelocityPriority };

/**
 * After CARRIED_OVER, draw velocity_tier high/critical_hotspot and
 * priority_override locations before remaining PENDING.
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
  const hot = available.filter(isRotationVelocityPriority);
  const rest = available.filter((loc) => !isRotationVelocityPriority(loc));

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
