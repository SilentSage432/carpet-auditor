/**
 * UX-REDUCE-003 — Map department coverage presentation.
 *
 * Derived only. Map represents coverage geography, not topology
 * implementation. Physical bay = (department_id, aisle, bay).
 * SELLING/TOPSTOCK are secondary surfaces of one obligation.
 * Does not persist, invent coverage, or alter engine semantics.
 */

import { worstMapReadiness, type MapReadinessTone } from "./map-readiness";
import { groupLocationsByPhysicalBay } from "./physical-bay";
import type { StoreLocation } from "./types";

/** DS-facing coverage geography labels (readiness tone → presentation). */
export type MapCoverageState =
  | "covered"
  | "this_week"
  | "needs_attention"
  | "remaining";

export type MapCoverageSummary = {
  physicalBayCount: number;
  covered: number;
  thisWeek: number;
  needsAttention: number;
  remaining: number;
};

/**
 * Precedence for a physical bay composed from sibling surface tones:
 * needs attention > this week > covered > remaining.
 * Mirrors worstMapReadiness over classifyMapReadiness outputs.
 */
export function mapCoverageStateFromTone(
  tone: MapReadinessTone
): MapCoverageState {
  if (tone === "attention") return "needs_attention";
  if (tone === "scheduled") return "this_week";
  if (tone === "verified") return "covered";
  return "remaining";
}

export function mapCoverageStateLabel(state: MapCoverageState): string {
  if (state === "covered") return "Covered";
  if (state === "this_week") return "This week";
  if (state === "needs_attention") return "Needs attention";
  return "Remaining";
}

/** Everyday Map label for a readiness tone. */
export function mapCoverageToneLabel(tone: MapReadinessTone): string {
  return mapCoverageStateLabel(mapCoverageStateFromTone(tone));
}

/**
 * Count distinct physical bays from location rows.
 * Sibling SELLING/TOPSTOCK collapse to one. Single-surface bays count as one.
 */
export function countPhysicalBays(locations: StoreLocation[]): number {
  return groupLocationsByPhysicalBay(locations).length;
}

export type PhysicalBayToneInput = {
  tones: MapReadinessTone[];
};

/** Compose one physical-bay tone from surface tones (empty → remaining/idle). */
export function composePhysicalBayTone(
  tones: Iterable<MapReadinessTone | null | undefined>
): MapReadinessTone {
  const list: MapReadinessTone[] = [];
  for (const t of tones) {
    if (t) list.push(t);
  }
  if (list.length === 0) return "idle";
  return worstMapReadiness(list);
}

/**
 * Geography-oriented summary for Map chrome — physical-bay cardinality.
 * Does not invent state; callers supply tones already classified by
 * classifyMapReadiness / composePhysicalBayTone.
 */
export function composeMapCoverageSummary(
  physicalBayTones: MapReadinessTone[]
): MapCoverageSummary {
  let covered = 0;
  let thisWeek = 0;
  let needsAttention = 0;
  let remaining = 0;
  for (const tone of physicalBayTones) {
    const state = mapCoverageStateFromTone(tone);
    if (state === "covered") covered += 1;
    else if (state === "this_week") thisWeek += 1;
    else if (state === "needs_attention") needsAttention += 1;
    else remaining += 1;
  }
  return {
    physicalBayCount: physicalBayTones.length,
    covered,
    thisWeek,
    needsAttention,
    remaining,
  };
}

export function formatPhysicalBayCount(n: number): string {
  return `${n} physical bay${n === 1 ? "" : "s"}`;
}

export function formatAisleBayCount(n: number): string {
  return `${n} bay${n === 1 ? "" : "s"}`;
}

/**
 * Aisle progress line — covered / attention over physical bays.
 * Ordinary remaining is omitted so owed coverage stays quiet.
 */
export function formatAisleCoverageProgress(summary: {
  covered: number;
  needsAttention: number;
  physicalBayCount: number;
}): string {
  const parts = [
    `${summary.covered} covered`,
  ];
  if (summary.needsAttention > 0) {
    parts.push(`${summary.needsAttention} need attention`);
  }
  return parts.join(" · ");
}

/** Compact Map header summary — geography, not people ownership. */
export function formatMapCoverageSummaryLine(
  summary: MapCoverageSummary
): string {
  const parts = [
    formatPhysicalBayCount(summary.physicalBayCount),
    `${summary.covered} covered`,
  ];
  if (summary.thisWeek > 0) {
    parts.push(`${summary.thisWeek} this week`);
  }
  if (summary.needsAttention > 0) {
    parts.push(`${summary.needsAttention} need attention`);
  }
  if (summary.remaining > 0) {
    parts.push(`${summary.remaining} remaining`);
  }
  return parts.join(" · ");
}
