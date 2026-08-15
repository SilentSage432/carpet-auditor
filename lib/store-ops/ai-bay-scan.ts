/**
 * AI Visual Bay Scan — owns prompt, schema, normalize, and local fallback.
 * Composes Gemini multimodal transport; does not own camera UI or location persistence.
 */

import { asGeminiSchema } from "@/lib/ai/gemini-schema";

export type BayCleanlinessScore = "EXCELLENT" | "NEEDS_ATTENTION" | "HAZARD";
export type BayIssueSeverity = "HIGH" | "MEDIUM" | "LOW";

export type BayScanIssue = {
  issue: string;
  severity: BayIssueSeverity;
  recommendation: string;
};

export type BayScanResult = {
  carton_count_estimate: number;
  pallet_count: number;
  cleanliness_score: BayCleanlinessScore;
  detected_issues: BayScanIssue[];
  summary: string;
};

export type BayScanMeta = {
  aisle?: string;
  bay?: number;
  department_code?: string;
};

const bayIssueSchema = asGeminiSchema({
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

/** Structured output for Snap Bay vision. */
export const BAY_SCAN_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    carton_count_estimate: { type: "integer" },
    pallet_count: { type: "integer" },
    cleanliness_score: {
      type: "string",
      format: "enum",
      enum: ["EXCELLENT", "NEEDS_ATTENTION", "HAZARD"],
    },
    detected_issues: {
      type: "array",
      items: bayIssueSchema,
    },
    summary: { type: "string" },
  },
  required: [
    "carton_count_estimate",
    "pallet_count",
    "cleanliness_score",
    "detected_issues",
    "summary",
  ],
});

export function buildBayScanPrompt(meta?: BayScanMeta): string {
  const aisle = String(meta?.aisle ?? "").trim() || "unknown";
  const bay =
    meta?.bay != null && Number.isFinite(Number(meta.bay))
      ? String(Math.floor(Number(meta.bay)))
      : "unknown";
  const dept = String(meta?.department_code ?? "").trim() || "unknown";

  return `You are DeptSync Hub's Visual Bay Scan analyst for a Lowe's retail store.

Analyze the attached bay photo for inventory compliance and safety.
Bay context: aisle=${aisle}, bay=${bay}, department_code=${dept}.

Assess:
1. Approximate carton/case count visible on the selling face vs topstock (if both are visible).
2. Pallet count visible in the bay / staging area.
3. Untagged merchandise, missing bin tags, leaning stacks, blocked aisle paths, or other safety hazards.
4. Overall cleanliness / presentation readiness.

Be observational and evidence-based from the image. Do not invent SKUs or barcodes.
If the image is blurry or the bay is not visible, say so in summary and lower confidence via issues.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeScore(raw: unknown): BayCleanlinessScore {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (v === "EXCELLENT" || v === "GOOD" || v === "CLEAN") return "EXCELLENT";
  if (v === "HAZARD" || v === "UNSAFE" || v === "CRITICAL") return "HAZARD";
  if (
    v === "NEEDS_ATTENTION" ||
    v === "NEEDS-ATTENTION" ||
    v === "ATTENTION" ||
    v === "FAIR" ||
    v === "POOR"
  ) {
    return "NEEDS_ATTENTION";
  }
  return "NEEDS_ATTENTION";
}

function normalizeSeverity(raw: unknown): BayIssueSeverity {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW") return v;
  return "MEDIUM";
}

function toCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(999, Math.round(n));
}

export function normalizeBayScanResult(raw: unknown): BayScanResult {
  const root = asRecord(raw) ?? {};
  const list = Array.isArray(root.detected_issues)
    ? root.detected_issues
    : Array.isArray(root.issues)
      ? root.issues
      : [];

  const detected_issues: BayScanIssue[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const issue = String(row.issue ?? row.title ?? row.label ?? "").trim();
    const recommendation = String(
      row.recommendation ?? row.action ?? row.action_suggested ?? ""
    ).trim();
    if (!issue && !recommendation) continue;
    detected_issues.push({
      issue: issue || "Bay observation",
      severity: normalizeSeverity(row.severity),
      recommendation:
        recommendation || "Walk the bay and verify presentation on the floor",
    });
  }

  const rank: Record<BayIssueSeverity, number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  detected_issues.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const cleanliness_score = normalizeScore(root.cleanliness_score);
  const summary = String(root.summary ?? root.notes ?? "").trim();

  return {
    carton_count_estimate: toCount(
      root.carton_count_estimate ?? root.cartons ?? root.carton_count
    ),
    pallet_count: toCount(root.pallet_count ?? root.pallets),
    cleanliness_score,
    detected_issues: detected_issues.slice(0, 12),
    summary:
      summary ||
      (cleanliness_score === "EXCELLENT"
        ? "Bay appears presentation-ready from the captured angle."
        : cleanliness_score === "HAZARD"
          ? "Potential safety or compliance hazard flagged — walk the bay now."
          : "Bay needs a closer walk — review detected issues before closing the aisle."),
  };
}

/** Deterministic fallback when Gemini is unavailable. */
export function buildLocalBayScanResult(meta?: BayScanMeta): BayScanResult {
  const aisle = String(meta?.aisle ?? "").trim();
  const bay =
    meta?.bay != null && Number.isFinite(Number(meta.bay))
      ? Math.floor(Number(meta.bay))
      : null;
  const loc =
    aisle && bay != null
      ? `Aisle ${aisle} · Bay ${bay}`
      : aisle
        ? `Aisle ${aisle}`
        : "this bay";

  return {
    carton_count_estimate: 0,
    pallet_count: 0,
    cleanliness_score: "NEEDS_ATTENTION",
    detected_issues: [
      {
        issue: "AI Visual Scan offline",
        severity: "MEDIUM",
        recommendation:
          "Set GEMINI_API_KEY in .env.local, then re-snap the bay for automated counts and hazard detection",
      },
      {
        issue: "Manual walk required",
        severity: "LOW",
        recommendation: `Physically verify carton facing, bin tags, and lean stacks at ${loc}`,
      },
    ],
    summary: `Local fallback for ${loc} — Gemini is not configured, so counts were not estimated from the photo.`,
  };
}

export function resolveImageMimeType(
  image: string,
  explicitMime?: string
): string {
  const fromExplicit = String(explicitMime ?? "").trim();
  if (fromExplicit.startsWith("image/")) return fromExplicit;
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  if (match?.[1]) return match[1].toLowerCase();
  return "image/jpeg";
}
