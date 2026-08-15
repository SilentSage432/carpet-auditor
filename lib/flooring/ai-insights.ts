/**
 * Flooring AI Remnant Aging & Variance Intelligence.
 * Owns: insight payload shaping, prompt composition, post-Gemini normalization.
 * Composes: lib/aging (bands), lib/variance (kinds), lib/ai/gemini (transport).
 * Does not own markdown math (lib/markdown) or remnant persistence (lib/remnants).
 */

import {
  agingBand,
  classifyAging,
  daysOld,
  type AgingBand,
  type AgingTier,
} from "@/lib/aging";
import { asGeminiSchema } from "@/lib/ai/gemini-schema";
import {
  classifyVariance,
  type VarianceKind,
} from "@/lib/variance";
import type { CarpetAudit, Remnant } from "@/lib/types";

export type FlooringMarkdownCandidate = {
  remnant_id: string;
  sku: string;
  tag_number: string;
  carpet_name: string;
  days_old: number;
  aging_tier: AgingTier;
  aging_band: AgingBand;
  estimated_value: number | null;
  recommended_percent: number;
  rationale: string;
  priority: "high" | "medium" | "low";
};

export type FlooringVarianceFinding = {
  audit_id: string;
  sku: string;
  carpet_name: string;
  kind: VarianceKind;
  variance_clf: number | null;
  location_type: string;
  rationale: string;
};

export type FlooringAiInsights = {
  summary_markdown: string;
  markdown_candidates: FlooringMarkdownCandidate[];
  variance_findings: FlooringVarianceFinding[];
  actions: string[];
};

export type FlooringAiInsightsRequest = {
  audits: CarpetAudit[];
  remnants: Remnant[];
  store_number?: string;
};

export type FlooringInsightPacket = {
  markdown_candidates: Array<{
    remnant_id: string;
    sku: string;
    tag_number: string;
    carpet_name: string;
    days_old: number;
    aging_band: AgingBand;
    estimated_value: number | null;
    recommended_percent: number;
    priority: "high" | "medium" | "low";
    rationale: string;
  }>;
  variance_findings: Array<{
    audit_id: string;
    sku: string;
    carpet_name: string;
    kind: VarianceKind;
    variance_clf: number | null;
    location_type: string;
    rationale: string;
  }>;
  candidate_count: number;
  finding_count: number;
};

const markdownCandidateSchema = asGeminiSchema({
  type: "object",
  properties: {
    remnant_id: { type: "string" },
    sku: { type: "string" },
    tag_number: { type: "string" },
    carpet_name: { type: "string" },
    days_old: { type: "integer" },
    aging_tier: {
      type: "string",
      format: "enum",
      enum: ["new", "promote", "clearance"],
    },
    aging_band: {
      type: "string",
      format: "enum",
      enum: ["0-29", "30-59", "60-89", "90+"],
    },
    estimated_value: { type: "number", nullable: true },
    recommended_percent: { type: "integer" },
    rationale: { type: "string" },
    priority: {
      type: "string",
      format: "enum",
      enum: ["high", "medium", "low"],
    },
  },
  required: [
    "remnant_id",
    "sku",
    "tag_number",
    "carpet_name",
    "days_old",
    "aging_tier",
    "aging_band",
    "recommended_percent",
    "rationale",
    "priority",
  ],
});

const varianceFindingSchema = asGeminiSchema({
  type: "object",
  properties: {
    audit_id: { type: "string" },
    sku: { type: "string" },
    carpet_name: { type: "string" },
    kind: {
      type: "string",
      format: "enum",
      enum: ["match", "shortage", "overage", "none"],
    },
    variance_clf: { type: "number", nullable: true },
    location_type: { type: "string" },
    rationale: { type: "string" },
  },
  required: [
    "audit_id",
    "sku",
    "carpet_name",
    "kind",
    "location_type",
    "rationale",
  ],
});

/** Structured output for Flooring remnant + variance narration. */
export const FLOORING_INSIGHTS_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    summary_markdown: { type: "string" },
    markdown_candidates: {
      type: "array",
      items: markdownCandidateSchema,
    },
    variance_findings: {
      type: "array",
      items: varianceFindingSchema,
    },
    actions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "summary_markdown",
    "markdown_candidates",
    "variance_findings",
    "actions",
  ],
});

const MARKDOWN_TIERS = [15, 25, 50] as const;

export function snapMarkdownPercent(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 25;
  const clamped = Math.min(100, Math.max(0, Math.round(n)));
  let best: number = MARKDOWN_TIERS[1];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const tier of MARKDOWN_TIERS) {
    const dist = Math.abs(tier - clamped);
    if (dist < bestDist) {
      best = tier;
      bestDist = dist;
    }
  }
  // Prefer exact AI value when already a sensible percent (not only chips).
  if (clamped >= 10 && clamped <= 75 && bestDist > 5) return clamped;
  return best;
}

/** Compact local findings for Gemini — IDs already bound; no raw remnant/audit dumps. */
export function compactFlooringInsightsForPrompt(
  local: FlooringAiInsights
): FlooringInsightPacket {
  return {
    markdown_candidates: local.markdown_candidates.slice(0, 12).map((c) => ({
      remnant_id: c.remnant_id,
      sku: c.sku,
      tag_number: c.tag_number,
      carpet_name: c.carpet_name,
      days_old: c.days_old,
      aging_band: c.aging_band,
      estimated_value: c.estimated_value,
      recommended_percent: c.recommended_percent,
      priority: c.priority,
      rationale: c.rationale,
    })),
    variance_findings: local.variance_findings.slice(0, 12).map((f) => ({
      audit_id: f.audit_id,
      sku: f.sku,
      carpet_name: f.carpet_name,
      kind: f.kind,
      variance_clf: f.variance_clf,
      location_type: f.location_type,
      rationale: f.rationale,
    })),
    candidate_count: local.markdown_candidates.length,
    finding_count: local.variance_findings.length,
  };
}

export function buildFlooringInsightsPrompt(input: {
  packet: FlooringInsightPacket;
  storeNumber?: string;
}): string {
  return `You are DeptSync Hub's Flooring Remnant Aging & Variance Intelligence analyst for a Lowe's store.

Institutional aging and ±2 CLF variance are already applied. Narrate the compact packet — teach the floor team what the numbers mean. Do not invent remnant_id, audit_id, SKU, or values not in the packet. Do not recompute age bands.

Age bands (already applied): 0-29 New · 30-59 Promote · 60-89 Clearance · 90+ high-priority markdown.
Markdown percent tiers: 15, 25, 50.

Write:
1. summary_markdown — 2–5 bullet briefing.
2. Echo markdown_candidates / variance_findings with tighter rationale and priority when evidenced.
3. actions — short next steps.

Store: ${input.storeNumber ?? "unknown"}

FINDINGS PACKET:
${JSON.stringify(input.packet)}`;
}

/**
 * Overlay Gemini narration onto local findings. Local IDs stay authoritative.
 */
export function mergeNarratedFlooringInsights(
  local: FlooringAiInsights,
  raw: unknown,
  remnants: Remnant[]
): FlooringAiInsights {
  const narrated = normalizeFlooringInsights(raw, remnants);
  const byRemnant = new Map(
    narrated.markdown_candidates.map((c) => [c.remnant_id, c] as const)
  );
  const byAudit = new Map(
    narrated.variance_findings.map((f) => [f.audit_id, f] as const)
  );

  return {
    summary_markdown: narrated.summary_markdown || local.summary_markdown,
    markdown_candidates: local.markdown_candidates.map((c) => {
      const overlay = byRemnant.get(c.remnant_id);
      if (!overlay) return c;
      return {
        ...c,
        rationale: overlay.rationale || c.rationale,
        priority: overlay.priority || c.priority,
        recommended_percent: overlay.recommended_percent || c.recommended_percent,
      };
    }),
    variance_findings: local.variance_findings.map((f) => {
      const overlay = byAudit.get(f.audit_id);
      if (!overlay) return f;
      return {
        ...f,
        rationale: overlay.rationale || f.rationale,
      };
    }),
    actions: narrated.actions.length > 0 ? narrated.actions : local.actions,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizePriority(raw: unknown): "high" | "medium" | "low" {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

function normalizeVarianceKind(raw: unknown): VarianceKind {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "match" || v === "shortage" || v === "overage" || v === "none") {
    return v;
  }
  return "none";
}

function normalizeAgingTier(raw: unknown, days: number): AgingTier {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "new" || v === "promote" || v === "clearance") return v;
  return classifyAging(days);
}

function normalizeAgingBand(raw: unknown, days: number): AgingBand {
  const v = String(raw ?? "").trim();
  if (v === "0-29" || v === "30-59" || v === "60-89" || v === "90+") return v;
  return agingBand(days);
}

/**
 * Normalize Gemini JSON + re-attach institutional aging from remnant records.
 */
export function normalizeFlooringInsights(
  raw: unknown,
  remnants: Remnant[]
): FlooringAiInsights {
  const root = asRecord(raw) ?? {};
  const byId = new Map(remnants.map((r) => [r.id, r] as const));
  const now = new Date();

  const summary_markdown = String(
    root.summary_markdown ?? root.summary ?? ""
  ).trim();

  const markdown_candidates: FlooringMarkdownCandidate[] = [];
  const candidateList = Array.isArray(root.markdown_candidates)
    ? root.markdown_candidates
    : [];

  for (const item of candidateList) {
    const row = asRecord(item);
    if (!row) continue;
    const remnant_id = String(row.remnant_id ?? row.id ?? "").trim();
    const remnant = byId.get(remnant_id);
    if (!remnant) continue;
    if (remnant.status === "sold") continue;
    if (remnant.markdown_price != null) continue;

    const days = daysOld(remnant.created_at, now);
    const estimated =
      remnant.estimated_value != null && Number.isFinite(remnant.estimated_value)
        ? remnant.estimated_value
        : (() => {
            const n = Number(row.estimated_value);
            return Number.isFinite(n) ? n : null;
          })();

    markdown_candidates.push({
      remnant_id: remnant.id,
      sku: remnant.sku,
      tag_number: remnant.tag_number,
      carpet_name: remnant.carpet_name,
      days_old: days,
      aging_tier: normalizeAgingTier(row.aging_tier, days),
      aging_band: normalizeAgingBand(row.aging_band, days),
      estimated_value: estimated,
      recommended_percent: snapMarkdownPercent(row.recommended_percent),
      rationale: String(row.rationale ?? "").trim() || "Aged remnant clearance candidate",
      priority: normalizePriority(row.priority),
    });
  }

  markdown_candidates.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    if (rank[a.priority] !== rank[b.priority]) {
      return rank[a.priority] - rank[b.priority];
    }
    return b.days_old - a.days_old;
  });

  const variance_findings: FlooringVarianceFinding[] = [];
  const findingList = Array.isArray(root.variance_findings)
    ? root.variance_findings
    : [];
  for (const item of findingList) {
    const row = asRecord(item);
    if (!row) continue;
    const varianceRaw = row.variance_clf;
    const variance_clf =
      varianceRaw == null || varianceRaw === ""
        ? null
        : Number(varianceRaw);
    variance_findings.push({
      audit_id: String(row.audit_id ?? "").trim(),
      sku: String(row.sku ?? "").trim(),
      carpet_name: String(row.carpet_name ?? "").trim(),
      kind: normalizeVarianceKind(row.kind),
      variance_clf:
        variance_clf != null && Number.isFinite(variance_clf)
          ? variance_clf
          : null,
      location_type: String(row.location_type ?? "").trim(),
      rationale: String(row.rationale ?? "").trim(),
    });
  }

  const actions = Array.isArray(root.actions)
    ? root.actions.map((a) => String(a ?? "").trim()).filter(Boolean)
    : [];

  return {
    summary_markdown:
      summary_markdown ||
      "## Flooring Intelligence\n\nNo summary returned — review candidates and variance findings below.",
    markdown_candidates,
    variance_findings,
    actions,
  };
}

/** Heuristic fallback when Gemini is unavailable — still uses aging ownership. */
export function buildLocalFlooringInsights(
  remnants: Remnant[],
  audits: CarpetAudit[]
): FlooringAiInsights {
  const now = new Date();
  const markdown_candidates: FlooringMarkdownCandidate[] = [];
  for (const r of remnants) {
    if (r.status === "sold" || r.markdown_price != null) continue;
    const days = daysOld(r.created_at, now);
    const tier = classifyAging(days);
    const band = agingBand(days);
    if (tier !== "clearance") continue;
    const recommended_percent = band === "90+" ? 50 : 25;
    markdown_candidates.push({
      remnant_id: r.id,
      sku: r.sku,
      tag_number: r.tag_number,
      carpet_name: r.carpet_name,
      days_old: days,
      aging_tier: tier,
      aging_band: band,
      estimated_value: r.estimated_value,
      recommended_percent,
      rationale:
        band === "90+"
          ? "90+ day remnant — high-priority Manager Markdown tier"
          : "60+ day remnant — clearance markdown candidate",
      priority: band === "90+" ? "high" : "medium",
    });
  }
  markdown_candidates.sort((a, b) => b.days_old - a.days_old);
  const topCandidates = markdown_candidates.slice(0, 8);

  const variance_findings: FlooringVarianceFinding[] = audits
    .filter((a) => {
      const kind = classifyVariance(a.variance_clf);
      return kind === "shortage" || kind === "overage";
    })
    .slice(0, 8)
    .map((a) => {
      const kind = classifyVariance(a.variance_clf);
      return {
        audit_id: a.id,
        sku: a.sku,
        carpet_name: a.carpet_name,
        kind,
        variance_clf: a.variance_clf,
        location_type: a.location_type,
        rationale:
          kind === "shortage"
            ? "Physical CLF below system — review cutting room / shrink"
            : "Physical CLF above system — verify system on-hand / mis-cut credits",
      };
    });

  const lines = [
    "## Flooring Intelligence (local)",
    "",
    `- ${topCandidates.length} remnant markdown candidate(s) in 60+/90+ bands`,
    `- ${variance_findings.length} cycle variance discrepancy(ies)`,
    "",
    "_Gemini unavailable — institutional aging rules applied locally._",
  ];

  return {
    summary_markdown: lines.join("\n"),
    markdown_candidates: topCandidates,
    variance_findings,
    actions: [
      topCandidates.length > 0
        ? "Review high-priority remnants and apply Manager Markdown tiers"
        : "No clearance remnants pending markdown",
      variance_findings.length > 0
        ? "Investigate shortage/overage SKUs in the cutting room"
        : "No variance discrepancies in the provided audits",
    ],
  };
}
