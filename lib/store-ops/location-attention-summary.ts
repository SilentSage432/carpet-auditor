/**
 * SI-001C Floor attention summary — pure tier counts over SI-001A signals.
 *
 * Presentation aggregation only. Does not recompute pressure, confidence,
 * actionability, or reasons. No department score / rank / classification.
 *
 * Constitutional: Arts VII–IX, XI, XV, XIX, XX — COMPLIES; EXTENDS Art XI UI.
 */

import type {
  LocationAttentionResponse,
  LocationAttentionSignal,
} from "./location-attention-contract";

export type LocationAttentionSummary = {
  eligibleCount: number;
  noneCount: number;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  mediumOrHighCount: number;
};

export function emptyLocationAttentionSummary(): LocationAttentionSummary {
  return {
    eligibleCount: 0,
    noneCount: 0,
    lowCount: 0,
    mediumCount: 0,
    highCount: 0,
    mediumOrHighCount: 0,
  };
}

/**
 * Count existing SI-001A signals by pressure tier.
 * Order-independent. Does not mutate input. Does not filter by confidence/actionability.
 */
export function composeLocationAttentionSummary(
  signals: ReadonlyArray<LocationAttentionSignal>
): LocationAttentionSummary {
  let noneCount = 0;
  let lowCount = 0;
  let mediumCount = 0;
  let highCount = 0;

  for (const signal of signals) {
    if (signal.pressure === "HIGH") highCount += 1;
    else if (signal.pressure === "MEDIUM") mediumCount += 1;
    else if (signal.pressure === "LOW") lowCount += 1;
    else noneCount += 1;
  }

  const eligibleCount = signals.length;
  return {
    eligibleCount,
    noneCount,
    lowCount,
    mediumCount,
    highCount,
    mediumOrHighCount: mediumCount + highCount,
  };
}

/** Convenience: summarize a full SI-001A response. */
export function summarizeLocationAttentionResponse(
  response: Pick<LocationAttentionResponse, "signals">
): LocationAttentionSummary {
  return composeLocationAttentionSummary(response.signals);
}

/**
 * DS-facing MEDIUM/HIGH count line. Omits zero tiers.
 * Null when no Medium/High (caller shows quiet copy).
 */
export function formatAttentionTierCountLine(
  summary: Pick<LocationAttentionSummary, "highCount" | "mediumCount">
): string | null {
  const parts: string[] = [];
  if (summary.highCount > 0) {
    parts.push(`${summary.highCount} High`);
  }
  if (summary.mediumCount > 0) {
    parts.push(`${summary.mediumCount} Medium`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
