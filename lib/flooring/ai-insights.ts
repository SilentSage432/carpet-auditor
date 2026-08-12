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

function remnantSnapshot(remnant: Remnant, now = new Date()) {
  const days = daysOld(remnant.created_at, now);
  return {
    id: remnant.id,
    sku: remnant.sku,
    carpet_name: remnant.carpet_name,
    tag_number: remnant.tag_number,
    status: remnant.status,
    location: remnant.location,
    square_yards: remnant.square_yards,
    estimated_value: remnant.estimated_value,
    markdown_percent: remnant.markdown_percent,
    markdown_price: remnant.markdown_price,
    days_old: days,
    aging_tier: classifyAging(days),
    aging_band: agingBand(days),
  };
}

function auditSnapshot(audit: CarpetAudit) {
  const kind = classifyVariance(audit.variance_clf);
  return {
    id: audit.id,
    sku: audit.sku,
    carpet_name: audit.carpet_name,
    category: audit.category,
    location_type: audit.location_type,
    sims_location: audit.sims_location,
    calculated_clf: audit.calculated_clf,
    system_clf: audit.system_clf,
    variance_clf: audit.variance_clf,
    variance_kind: kind,
    box_count: audit.box_count,
    calculated_sqft: audit.calculated_sqft,
    audited_by: audit.audited_by,
    created_at: audit.created_at,
  };
}

export function buildFlooringInsightsPrompt(input: {
  audits: CarpetAudit[];
  remnants: Remnant[];
  storeNumber?: string;
}): string {
  const now = new Date();
  const remnantRows = input.remnants
    .filter((r) => r.status !== "sold")
    .slice(0, 80)
    .map((r) => remnantSnapshot(r, now));
  const auditRows = input.audits
    .filter((a) => a.variance_clf != null || a.system_clf != null)
    .slice(0, 80)
    .map(auditSnapshot);

  return `You are DeptSync Hub's Flooring Remnant Aging & Variance Intelligence analyst for a Lowe's store.

Analyze cycle-audit CLF variance against remnant age bands. Teach the floor team what the numbers mean before prescribing — be concrete, store-ops practical, never invent SKUs or values not in the data.

Age bands (from institutional aging rules):
- 0-29 days: New
- 30-59 days: Promote on sales floor
- 60-89 days: Clearance / Manager Markdown candidate
- 90+ days: High-priority Manager Markdown tier

Markdown percent tiers typically used: 15%, 25%, 50%.

Focus on:
1. High-priority remnant candidates for Manager Markdown (especially 60+ / 90+ without markdown_price).
2. Roll cutting-room discrepancies and inventory shrink patterns (shortages/overages on roll goods).
3. Links between remnant aging and variance SKUs when the same SKU appears in both sets.

Return ONLY valid JSON (no markdown fences) matching:
{
  "summary_markdown": "## Flooring Intelligence\\n\\nShort markdown briefing (2-5 bullets).",
  "markdown_candidates": [
    {
      "remnant_id": "<id from data>",
      "sku": "...",
      "tag_number": "...",
      "carpet_name": "...",
      "days_old": 72,
      "aging_tier": "clearance",
      "aging_band": "60-89",
      "estimated_value": 199.99,
      "recommended_percent": 50,
      "rationale": "Why this remnant should be marked down",
      "priority": "high"
    }
  ],
  "variance_findings": [
    {
      "audit_id": "<id from data>",
      "sku": "...",
      "carpet_name": "...",
      "kind": "shortage",
      "variance_clf": -12.4,
      "location_type": "sales_floor",
      "rationale": "Cutting room / shrink pattern explanation"
    }
  ],
  "actions": ["Short next-step for the specialist"]
}

Store: ${input.storeNumber ?? "unknown"}

REMNANTS (${remnantRows.length}):
${JSON.stringify(remnantRows)}

CYCLE AUDITS WITH SYSTEM/VARIANCE (${auditRows.length}):
${JSON.stringify(auditRows)}`;
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
