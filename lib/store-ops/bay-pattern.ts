/**
 * Retail bay numbering for aisle faces.
 * Sequential 1,2,3…; Odd Only 1,3,5…; Even Only 2,4,6… (step 2, no duplicates).
 * Locations compose this; presentation only selects the pattern.
 */

import type { BayNumberingPattern } from "./types";

export type { BayNumberingPattern };

export function parseBayNumberingPattern(raw: unknown): BayNumberingPattern {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (value === "odd" || value === "odds" || value === "odd_only") return "odd";
  if (value === "even" || value === "evens" || value === "even_only") {
    return "even";
  }
  return "sequential";
}

/**
 * Expand a start/end bay range with retail facing-side patterns.
 * Odd Only / Even Only step by 2 so opposite faces are not duplicated.
 */
export function expandBayNumbers(
  startBay: number,
  endBay: number,
  pattern: BayNumberingPattern = "sequential"
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

  const step = pattern === "sequential" ? 1 : 2;
  let bay = start;
  if (pattern === "odd" && bay % 2 === 0) bay += 1;
  if (pattern === "even" && bay % 2 !== 0) bay += 1;

  const bays: number[] = [];
  for (; bay <= end; bay += step) {
    bays.push(bay);
  }
  if (bays.length === 0) {
    throw new Error(
      pattern === "odd"
        ? "Odd Only: no odd bay numbers in this start/end range"
        : "Even Only: no even bay numbers in this start/end range"
    );
  }
  return bays;
}
