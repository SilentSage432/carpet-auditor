/**
 * SI-001B Map attention presentation — labels & marker rules only.
 *
 * Does NOT recompute SI-001 pressure / confidence / actionability / reasons.
 * Constitutional: Art VII–IX, XI, XV, XIX (complies; UI Expression of derived intelligence).
 */

import type {
  AttentionActionability,
  AttentionConfidence,
  AttentionPressure,
  AttentionReasonCode,
  AttentionReasonEffect,
  LocationAttentionReason,
  LocationAttentionSignal,
} from "./location-attention-pressure";
import type { AttentionEvidenceDimension } from "./location-attention-contract";

export type MapAttentionClientStatus =
  | "IDLE"
  | "LOADING"
  | "AVAILABLE"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "NEEDS_DEPARTMENT";

export type AttentionCellMarkerView = {
  compact_label: "Med" | "High";
  a11y_suffix: string;
};

/** Tier display — never expose internal "pressure". */
export function attentionTierLabel(pressure: AttentionPressure): string {
  if (pressure === "NONE") return "None";
  if (pressure === "LOW") return "Low";
  if (pressure === "MEDIUM") return "Medium";
  return "High";
}

export function attentionConfidenceLabel(
  confidence: AttentionConfidence
): string {
  if (confidence === "LOW") return "Low";
  if (confidence === "MEDIUM") return "Medium";
  return "High";
}

export function attentionActionabilityLabel(
  actionability: AttentionActionability
): string {
  if (actionability === "ACTIONABLE") return "Actionable";
  if (actionability === "BLOCKED") return "Blocked";
  return "Unclear";
}

/**
 * MEDIUM/HIGH → cell marker. NONE/LOW → none.
 * Visibility ignores confidence and actionability.
 */
export function attentionCellMarker(
  pressure: AttentionPressure
): AttentionCellMarkerView | null {
  if (pressure === "MEDIUM") {
    return {
      compact_label: "Med",
      a11y_suffix: "Current attention medium",
    };
  }
  if (pressure === "HIGH") {
    return {
      compact_label: "High",
      a11y_suffix: "Current attention high",
    };
  }
  return null;
}

export function attentionCellMarkerForSignal(
  signal: LocationAttentionSignal | null | undefined
): AttentionCellMarkerView | null {
  if (!signal) return null;
  return attentionCellMarker(signal.pressure);
}

/** Pair: strongest MEDIUM/HIGH across faces; else null. */
export function attentionCellMarkerForPair(
  signals: Array<LocationAttentionSignal | null | undefined>
): AttentionCellMarkerView | null {
  let best: AttentionCellMarkerView | null = null;
  for (const signal of signals) {
    const marker = attentionCellMarkerForSignal(signal);
    if (!marker) continue;
    if (marker.compact_label === "High") return marker;
    best = marker;
  }
  return best;
}

export const ATTENTION_PROVENANCE_LABEL =
  "Derived from current DeptSync evidence" as const;

export const ATTENTION_PARTIAL_STATUS_LABEL =
  "Attention partially available" as const;

export const ATTENTION_UNAVAILABLE_STATUS_LABEL =
  "Attention unavailable" as const;

export const ATTENTION_NEEDS_DEPARTMENT_LABEL =
  "Select a department for current attention." as const;

export const ATTENTION_SOME_EVIDENCE_UNAVAILABLE =
  "Some evidence unavailable" as const;

export function attentionUnavailableDimensionLabel(
  dim: AttentionEvidenceDimension
): string {
  if (dim === "current_rotation") {
    return "Current rotation information unavailable";
  }
  if (dim === "barriers") {
    return "Barrier information unavailable";
  }
  return "Seasonal context unavailable";
}

/**
 * Deterministic reason-code (+ effect) → DS label.
 * Seasonal: MODIFY → strengthened; CONTEXT → present; NONE codes → not relevant.
 * Does not invent strengthening from code alone.
 */
export function attentionReasonLabel(
  code: AttentionReasonCode,
  effect?: AttentionReasonEffect
): string {
  switch (code) {
    case "LOCATION_INACTIVE":
      return "Location is inactive";
    case "LOCATION_INELIGIBLE":
      return "Location is not aisle-eligible";
    case "NO_COVERAGE_HISTORY":
      return "No verified coverage history";
    case "COVERAGE_STALE":
      return "Coverage is stale";
    case "CADENCE_OVERDUE":
      return "Cadence is due";
    case "COVERAGE_FRESH":
      return "Coverage is fresh";
    case "VERIFICATION_PENDING":
      return "Awaiting verification";
    case "CARRYOVER_OPEN":
      return "Carryover remains open";
    case "BARRIER_OPEN":
      return "Barrier contributes to current attention";
    case "VELOCITY_HIGH":
      return "High velocity context";
    case "VELOCITY_CRITICAL":
      return "Critical hotspot velocity context";
    case "SEASONAL_DEPARTMENT_NONE":
    case "SEASONAL_LOCATION_NONE":
      return "Seasonal context marked not relevant";
    case "SEASONAL_DEPARTMENT_LOW":
    case "SEASONAL_DEPARTMENT_MEDIUM":
    case "SEASONAL_DEPARTMENT_HIGH":
    case "SEASONAL_LOCATION_LOW":
    case "SEASONAL_LOCATION_MEDIUM":
    case "SEASONAL_LOCATION_HIGH":
      if (effect === "MODIFY") {
        return "Seasonal context strengthened current attention";
      }
      return "Seasonal context is present";
    default: {
      const _exhaustive: never = code;
      return String(_exhaustive);
    }
  }
}

/** Presentation family order — stable, not a priority/rank. */
const REASON_FAMILY_ORDER: Record<AttentionReasonCode, number> = {
  LOCATION_INACTIVE: 0,
  LOCATION_INELIGIBLE: 1,
  VERIFICATION_PENDING: 10,
  CARRYOVER_OPEN: 20,
  COVERAGE_STALE: 30,
  CADENCE_OVERDUE: 31,
  COVERAGE_FRESH: 32,
  NO_COVERAGE_HISTORY: 33,
  BARRIER_OPEN: 40,
  VELOCITY_HIGH: 50,
  VELOCITY_CRITICAL: 51,
  SEASONAL_DEPARTMENT_HIGH: 60,
  SEASONAL_DEPARTMENT_MEDIUM: 61,
  SEASONAL_DEPARTMENT_LOW: 62,
  SEASONAL_DEPARTMENT_NONE: 63,
  SEASONAL_LOCATION_HIGH: 64,
  SEASONAL_LOCATION_MEDIUM: 65,
  SEASONAL_LOCATION_LOW: 66,
  SEASONAL_LOCATION_NONE: 67,
};

export function sortAttentionReasonsForDisplay(
  reasons: ReadonlyArray<LocationAttentionReason>
): LocationAttentionReason[] {
  return [...reasons].sort((a, b) => {
    const fa = REASON_FAMILY_ORDER[a.code] ?? 99;
    const fb = REASON_FAMILY_ORDER[b.code] ?? 99;
    if (fa !== fb) return fa - fb;
    const c = a.code.localeCompare(b.code);
    if (c !== 0) return c;
    return String(a.evidence.context_id ?? "").localeCompare(
      String(b.evidence.context_id ?? "")
    );
  });
}

/**
 * Deduplicate consecutive identical display labels after sort.
 * Presentation-only — does not mutate API reason objects.
 * CONTEXT vs MODIFY seasonal lines remain distinct when labels differ.
 */
export function attentionReasonDisplayLines(
  reasons: ReadonlyArray<LocationAttentionReason>
): string[] {
  const sorted = sortAttentionReasonsForDisplay(reasons);
  const lines: string[] = [];
  for (const reason of sorted) {
    const label = attentionReasonLabel(reason.code, reason.effect);
    if (lines[lines.length - 1] === label) continue;
    lines.push(label);
  }
  return lines;
}

/**
 * Format SI-001A `generated_at` for display.
 * Does not call Date.now(). When `timeZone` is omitted, uses the runtime
 * default (typically device-local). Pass an IANA zone for deterministic tests
 * or future store-timezone wiring — Map does not currently supply store TZ.
 */
export function formatAttentionAsOf(
  generatedAt: string,
  timeZone?: string | null
): string {
  const d = new Date(generatedAt);
  if (Number.isNaN(d.getTime())) return "As of unknown time";
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    return `As of ${formatted}`;
  } catch {
    return `As of ${d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })}`;
  }
}

export function indexAttentionSignalsByLocation(
  signals: ReadonlyArray<LocationAttentionSignal>
): Map<string, LocationAttentionSignal> {
  const map = new Map<string, LocationAttentionSignal>();
  for (const signal of signals) {
    map.set(signal.location_id, signal);
  }
  return map;
}

export function mapAttentionStatusLabel(
  status: MapAttentionClientStatus
): string | null {
  if (status === "DEGRADED") return ATTENTION_PARTIAL_STATUS_LABEL;
  if (status === "UNAVAILABLE") return ATTENTION_UNAVAILABLE_STATUS_LABEL;
  if (status === "NEEDS_DEPARTMENT") return ATTENTION_NEEDS_DEPARTMENT_LABEL;
  return null;
}
