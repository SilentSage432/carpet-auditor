/**
 * AI Bay Audit — multimodal verdict + rubric (extends visual bay scan).
 */

import { asGeminiSchema } from "@/lib/ai/gemini-schema";
import type {
  BayAuditIssue,
  BayAuditRubric,
  BayAuditVerdict,
  BayAuditVerdictResult,
  RubricCriterion,
} from "@/lib/ai/contracts/bay-audit";
import {
  buildBayScanPrompt,
  normalizeBayScanResult,
  type BayScanMeta,
} from "@/lib/store-ops/ai-bay-scan";

export type { BayScanMeta };

export type { BayAuditVerdictResult } from "@/lib/ai/contracts/bay-audit";

const rubricCriterionSchema = asGeminiSchema({
  type: "string",
  format: "enum",
  enum: ["PASS", "FAIL", "UNKNOWN", "NA"],
});

const bayAuditIssueSchema = asGeminiSchema({
  type: "object",
  properties: {
    issue: { type: "string" },
    severity: {
      type: "string",
      format: "enum",
      enum: ["HIGH", "MEDIUM", "LOW"],
    },
    recommendation: { type: "string" },
  },
  required: ["issue", "severity", "recommendation"],
});

/** Structured output for bay audit completion gate. */
export const BAY_AUDIT_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    verdict: {
      type: "string",
      format: "enum",
      enum: ["PASS", "CONDITIONAL", "FAIL"],
    },
    rubric: {
      type: "object",
      properties: {
        planogram_neatness: rubricCriterionSchema,
        shelf_tags: rubricCriterionSchema,
        topstock_banding: rubricCriterionSchema,
        aisle_clearance: rubricCriterionSchema,
      },
      required: [
        "planogram_neatness",
        "shelf_tags",
        "topstock_banding",
        "aisle_clearance",
      ],
    },
    carton_count_estimate: { type: "integer" },
    pallet_count: { type: "integer" },
    detected_issues: {
      type: "array",
      items: bayAuditIssueSchema,
    },
    summary: { type: "string" },
    supervisor_override_required: { type: "boolean" },
  },
  required: [
    "verdict",
    "rubric",
    "carton_count_estimate",
    "pallet_count",
    "detected_issues",
    "summary",
    "supervisor_override_required",
  ],
});

export function buildBayAuditPrompt(meta?: BayScanMeta): string {
  return `${buildBayScanPrompt(meta)}

Additionally score these rubric criteria from the image:
- planogram_neatness: facing alignment, voids, clutter on the selling floor
- shelf_tags: bin tags / shelf labels visible and aligned
- topstock_banding: top-stock banding / wrap / stable stacks (NA if topstock not visible)
- aisle_clearance: main aisle path clear of blocking freight or overhang

Return verdict:
- PASS when all visible criteria pass and no HIGH severity issues
- CONDITIONAL when minor fixes remain but the bay can close with follow-up
- FAIL when safety, missing tags, blocked aisle, or major presentation failure

Set supervisor_override_required true when verdict is FAIL or any HIGH severity issue is present.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeCriterion(raw: unknown): RubricCriterion {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (v === "PASS" || v === "FAIL" || v === "UNKNOWN" || v === "NA") {
    return v;
  }
  return "UNKNOWN";
}

function normalizeVerdict(raw: unknown): BayAuditVerdict {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (v === "PASS" || v === "CONDITIONAL" || v === "FAIL") return v;
  return "CONDITIONAL";
}

function deriveVerdictFromRubric(
  rubric: BayAuditRubric,
  issues: BayAuditIssue[]
): BayAuditVerdict {
  const hasHigh = issues.some((i) => i.severity === "HIGH");
  const fails = [
    rubric.planogram_neatness,
    rubric.shelf_tags,
    rubric.aisle_clearance,
  ].some((c) => c === "FAIL");
  if (hasHigh || fails || rubric.aisle_clearance === "FAIL") return "FAIL";
  const unknowns = Object.values(rubric).filter((c) => c === "UNKNOWN").length;
  if (unknowns >= 2) return "CONDITIONAL";
  const softFail = [
    rubric.planogram_neatness,
    rubric.shelf_tags,
    rubric.topstock_banding,
  ].some((c) => c === "FAIL");
  if (softFail || issues.some((i) => i.severity === "MEDIUM")) {
    return "CONDITIONAL";
  }
  return "PASS";
}

export function normalizeBayAuditVerdict(raw: unknown): BayAuditVerdictResult {
  const root = asRecord(raw) ?? {};
  const scan = normalizeBayScanResult(raw);
  const rubricRaw = asRecord(root.rubric) ?? {};

  const rubric: BayAuditRubric = {
    planogram_neatness: normalizeCriterion(rubricRaw.planogram_neatness),
    shelf_tags: normalizeCriterion(rubricRaw.shelf_tags),
    topstock_banding: normalizeCriterion(rubricRaw.topstock_banding),
    aisle_clearance: normalizeCriterion(rubricRaw.aisle_clearance),
  };

  const detected_issues: BayAuditIssue[] = scan.detected_issues.map((row) => ({
    issue: row.issue,
    severity: row.severity,
    recommendation: row.recommendation,
  }));

  let verdict = normalizeVerdict(root.verdict);
  if (!root.verdict) {
    if (scan.cleanliness_score === "HAZARD") verdict = "FAIL";
    else if (scan.cleanliness_score === "NEEDS_ATTENTION") {
      verdict = deriveVerdictFromRubric(rubric, detected_issues);
    } else {
      verdict = deriveVerdictFromRubric(rubric, detected_issues);
    }
  }

  const supervisor_override_required =
    typeof root.supervisor_override_required === "boolean"
      ? root.supervisor_override_required
      : verdict === "FAIL" ||
        detected_issues.some((i) => i.severity === "HIGH");

  return {
    verdict,
    rubric,
    carton_count_estimate: scan.carton_count_estimate,
    pallet_count: scan.pallet_count,
    detected_issues,
    summary: scan.summary,
    supervisor_override_required,
  };
}

export function buildLocalBayAuditVerdict(meta?: BayScanMeta): BayAuditVerdictResult {
  const scan = normalizeBayScanResult({
    carton_count_estimate: 0,
    pallet_count: 0,
    cleanliness_score: "NEEDS_ATTENTION",
    detected_issues: [
      {
        issue: "AI Bay Audit offline",
        severity: "MEDIUM",
        recommendation:
          "Set GEMINI_API_KEY for automated rubric scoring, or supervisor-verify manually",
      },
    ],
    summary: meta?.aisle
      ? `Local fallback audit for aisle ${meta.aisle} bay ${meta?.bay ?? "?"}`
      : "Local fallback audit — Gemini not configured",
  });

  return normalizeBayAuditVerdict({
    ...scan,
    verdict: "CONDITIONAL",
    rubric: {
      planogram_neatness: "UNKNOWN",
      shelf_tags: "UNKNOWN",
      topstock_banding: "NA",
      aisle_clearance: "UNKNOWN",
    },
    supervisor_override_required: false,
  });
}

export function formatBayNumber(meta?: {
  aisle?: string;
  bay?: number | string | null;
}): string {
  const aisle = String(meta?.aisle ?? "").trim();
  const bayRaw = meta?.bay;
  const bay =
    bayRaw != null && String(bayRaw).trim() !== ""
      ? String(Math.floor(Number(bayRaw)))
      : "";
  if (aisle && bay) return `${aisle.toUpperCase()}-${bay}`;
  if (bay) return bay;
  if (aisle) return aisle.toUpperCase();
  return "unknown";
}
