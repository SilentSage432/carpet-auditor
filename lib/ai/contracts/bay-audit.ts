/**
 * Bay audit verdict contracts — isomorphic (no Gemini SDK).
 */

export const BAY_AUDIT_VERDICTS = ["PASS", "CONDITIONAL", "FAIL"] as const;

export type BayAuditVerdict = (typeof BAY_AUDIT_VERDICTS)[number];

export const RUBRIC_CRITERIA = [
  "PASS",
  "FAIL",
  "UNKNOWN",
  "NA",
] as const;

export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number];

export type BayAuditRubric = {
  planogram_neatness: RubricCriterion;
  shelf_tags: RubricCriterion;
  topstock_banding: RubricCriterion;
  aisle_clearance: RubricCriterion;
};

export type BayAuditIssue = {
  issue: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  recommendation: string;
};

export type BayAuditVerdictResult = {
  verdict: BayAuditVerdict;
  rubric: BayAuditRubric;
  carton_count_estimate: number;
  pallet_count: number;
  detected_issues: BayAuditIssue[];
  summary: string;
  supervisor_override_required: boolean;
};

export type BayAuditLogRow = {
  id: string;
  store_number: string;
  department_id: string;
  bay_number: string;
  rotation_id: string | null;
  actor_id: string | null;
  verdict: BayAuditVerdict;
  rubric: BayAuditRubric;
  detected_issues: BayAuditIssue[];
  carton_estimate: number | null;
  image_url: string | null;
  source: "gemini" | "local";
  supervisor_override: boolean;
  override_by: string | null;
  latency_ms: number | null;
  created_at: string;
};
