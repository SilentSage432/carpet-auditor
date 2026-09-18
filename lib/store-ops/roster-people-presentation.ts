/**
 * UX-REDUCE-004 — Roster People presentation helpers.
 *
 * Derived only. Roster represents rotation participation and schedule
 * evidence, not employment administration. Does not invent hours,
 * presence, or workforce-scope policy.
 */

import type { CurrentAvailability } from "./current-availability";

export function isScheduleUnknown(
  availability: Pick<CurrentAvailability, "reason">
): boolean {
  return availability.reason === "UNKNOWN";
}

/** Quiet healthy rows; louder only for call-out / unknown schedule. */
export function rosterAvailabilityToneClass(
  availability: Pick<CurrentAvailability, "reason" | "label">
): string {
  if (availability.reason === "CALLED_OUT") {
    return "text-amber-200/90";
  }
  if (availability.reason === "UNKNOWN") {
    return "text-zinc-500";
  }
  return "text-zinc-400";
}

export function formatOwnedBayCaption(ownedBays: number): string | null {
  if (ownedBays <= 0) return null;
  return `${ownedBays} bay${ownedBays === 1 ? "" : "s"} still owned this week`;
}

export function formatPeopleCount(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}
