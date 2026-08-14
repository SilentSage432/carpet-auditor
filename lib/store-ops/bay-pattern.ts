/**
 * Retail bay numbering for aisle faces.
 * Odd Only 1,3,5…; Even Only 2,4,6… (step 2, no duplicates).
 * Sequential ranges are not used — opposite faces must not share a draw.
 * Locations compose this; presentation only selects the pattern.
 */

import type { BayNumberingPattern } from "./types";

export type { BayNumberingPattern };

export const DEFAULT_BAY_PATTERN: BayNumberingPattern = "odd";

export function parseBayNumberingPattern(raw: unknown): BayNumberingPattern {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (value === "even" || value === "evens" || value === "even_only") {
    return "even";
  }
  // Legacy "sequential" / unknown CSV values map to Odd Only.
  return "odd";
}

/**
 * Expand a start/end bay range for one retail face.
 * Odd Only / Even Only step by 2 so opposite faces are not duplicated.
 */
export function expandBayNumbers(
  startBay: number,
  endBay: number,
  pattern: BayNumberingPattern = DEFAULT_BAY_PATTERN
): number[] {
  if (!Number.isFinite(startBay) || !Number.isFinite(endBay)) {
    throw new Error("start_bay and end_bay are required");
  }
  const start = Math.trunc(startBay);
  const end = Math.trunc(endBay);
  if (start > end) {
    throw new Error("start_bay must be ≤ end_bay");
  }
  if (start < 0 || end < 0) {
    throw new Error("bay numbers must be ≥ 0");
  }

  const face: BayNumberingPattern =
    pattern === "even" ? "even" : "odd";
  let bay = start;
  if (face === "odd" && bay % 2 === 0) bay += 1;
  if (face === "even" && bay % 2 !== 0) bay += 1;

  const bays: number[] = [];
  for (; bay <= end; bay += 2) {
    bays.push(bay);
  }
  if (bays.length === 0) {
    throw new Error(
      face === "odd"
        ? "Odd Only: no odd bay numbers in this start/end range"
        : "Even Only: no even bay numbers in this start/end range"
    );
  }
  return bays;
}
