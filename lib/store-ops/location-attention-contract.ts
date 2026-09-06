/**
 * SI-001A/B serializable attention API contract — client-safe types only.
 * No Supabase / route / engine logic.
 */

import {
  LOCATION_ATTENTION_PRESSURE_METHOD,
  LOCATION_ATTENTION_PRESSURE_VERSION,
  type LocationAttentionSignal,
} from "./location-attention-pressure";

export const ATTENTION_EVIDENCE_DIMENSIONS = [
  "current_rotation",
  "barriers",
  "seasonal_context",
] as const;

export type AttentionEvidenceDimension =
  (typeof ATTENTION_EVIDENCE_DIMENSIONS)[number];

export type EvidenceStatus = "AVAILABLE" | "UNAVAILABLE";

export type AttentionDepartmentMeta = {
  id: string;
  code: string;
  name: string;
};

/** Public GET /api/store-intelligence/attention response. */
export type LocationAttentionResponse = {
  operational_date: string;
  generated_at: string;
  department: AttentionDepartmentMeta;
  method: typeof LOCATION_ATTENTION_PRESSURE_METHOD;
  method_version: typeof LOCATION_ATTENTION_PRESSURE_VERSION;
  degraded: boolean;
  unavailable_evidence: AttentionEvidenceDimension[];
  evidence_status: Record<AttentionEvidenceDimension, EvidenceStatus>;
  signals: LocationAttentionSignal[];
};

export type { LocationAttentionSignal };
export {
  LOCATION_ATTENTION_PRESSURE_METHOD,
  LOCATION_ATTENTION_PRESSURE_VERSION,
};
