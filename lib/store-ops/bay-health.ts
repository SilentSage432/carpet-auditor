/**
 * Floor discrepancy & bay health diagnostics.
 * Composes store_locations cycle timestamps + hub audit rows (SIMS / variance).
 * Does not own persistence, scoring weights, scoring UI, or recommendations.
 * Flag penalty weights live in health.ts (`flagPenalty`) so Sunday risk and
 * bay finding scores cannot drift.
 */

import { isDiscrepancy } from "@/lib/variance";
import { flagPenalty } from "./health";
import type { CarpetAudit } from "@/lib/types";
import type {
  StoreLocationType,
  WeeklyRotationWithLocation,
} from "./types";

export const BAY_STALE_DAYS = 7;

export type BayHealthFlag =
  | "stale"
  | "never_audited"
  | "topstock_uninventoried"
  | "sims_mismatch";

export type BayHealthFinding = {
  rotationId: string;
  locationId: string;
  aisle: string;
  bay: number;
  type: StoreLocationType;
  flags: BayHealthFlag[];
  ageDays: number | null;
  score: number;
};

export type BayHealthScorecard = {
  findings: BayHealthFinding[];
  staleCount: number;
  neverAuditedCount: number;
  topstockGapCount: number;
  simsMismatchCount: number;
  troubleAisleCount: number;
  troubleAisles: string[];
  score: number;
  tone: "ok" | "watch" | "alert";
};

/** Compact scorecard for Gemini / local shift briefing — not a second diagnostic owner. */
export type BayHealthBriefingContext = {
  score: number;
  tone: BayHealthScorecard["tone"];
  stale_over_7d: number;
  never_audited: number;
  unworked_topstock: number;
  sims_mismatch: number;
  barrier_flag_count: number;
  trouble_aisles: string[];
  hotspot: {
    aisle: string;
    bay: number;
    type: StoreLocationType;
    flags: BayHealthFlag[];
    age_days: number | null;
    score: number;
  } | null;
};

export function compactBayHealthForPrompt(
  card: BayHealthScorecard
): BayHealthBriefingContext {
  const hotspot =
    [...card.findings].sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const ageA = a.ageDays ?? 999;
      const ageB = b.ageDays ?? 999;
      return ageB - ageA;
    })[0] ?? null;

  return {
    score: card.score,
    tone: card.tone,
    stale_over_7d: card.staleCount,
    never_audited: card.neverAuditedCount,
    unworked_topstock: card.topstockGapCount,
    sims_mismatch: card.simsMismatchCount,
    barrier_flag_count:
      card.staleCount +
      card.neverAuditedCount +
      card.topstockGapCount +
      card.simsMismatchCount,
    trouble_aisles: card.troubleAisles.slice(0, 8),
    hotspot: hotspot
      ? {
          aisle: hotspot.aisle,
          bay: hotspot.bay,
          type: hotspot.type,
          flags: hotspot.flags,
          age_days: hotspot.ageDays,
          score: hotspot.score,
        }
      : null,
  };
}

type SimsMatch = {
  aisle: string;
  bay: number;
};

export function daysSinceIso(
  iso: string | null | undefined,
  now = new Date()
): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Parse "Aisle 14 - Bay 012" / "A14 B12" style SIMS tags. */
export function parseSimsAisleBay(
  tag: string | null | undefined
): SimsMatch | null {
  const raw = String(tag ?? "").trim().toUpperCase();
  if (!raw) return null;
  const labeled =
    /(?:AISLE|A)\s*[:#-]?\s*([A-Z0-9]+)\s*[-,/]?\s*(?:BAY|B)\s*[:#-]?\s*0*(\d+)/i.exec(
      raw
    );
  if (labeled) {
    return { aisle: labeled[1], bay: Number(labeled[2]) };
  }
  const compact = /^([A-Z]{1,4}|[0-9]{1,3})\s*[-/]\s*0*(\d{1,3})$/.exec(raw);
  if (compact) {
    return { aisle: compact[1], bay: Number(compact[2]) };
  }
  return null;
}

function findingScore(flags: BayHealthFlag[]): number {
  const next = flags.reduce((sum, flag) => sum + flagPenalty(flag), 0);
  return Math.max(0, 100 - next);
}

function overallTone(score: number, findingCount: number): BayHealthScorecard["tone"] {
  if (findingCount === 0 || score >= 85) return "ok";
  if (score >= 60) return "watch";
  return "alert";
}

function auditMatchesBay(
  audit: CarpetAudit,
  aisle: string,
  bay: number
): boolean {
  const parsed = parseSimsAisleBay(audit.sims_location);
  if (!parsed) return false;
  return (
    parsed.aisle === aisle &&
    parsed.bay === bay
  );
}

/**
 * Diagnose assigned weekly bays: aging cycle gaps, missing topstock SIMS,
 * and scan/variance mismatches. Pure composition — callers fetch rows.
 */
export function diagnoseBayHealth(input: {
  rotations: WeeklyRotationWithLocation[];
  audits?: CarpetAudit[];
  now?: Date;
}): BayHealthScorecard {
  const now = input.now ?? new Date();
  const audits = input.audits ?? [];
  const findings: BayHealthFinding[] = [];

  for (const rotation of input.rotations) {
    const loc = rotation.store_locations;
    if (!loc) continue;
    const aisle = String(loc.aisle ?? "").trim().toUpperCase();
    const bay = Number(loc.bay) || 0;
    const type: StoreLocationType =
      loc.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING";
    const ageDays = daysSinceIso(loc.last_completed_at, now);
    const flags: BayHealthFlag[] = [];

    if (ageDays == null) {
      flags.push("never_audited");
    } else if (ageDays > BAY_STALE_DAYS) {
      flags.push("stale");
    }

    const matching = audits.filter((a) => auditMatchesBay(a, aisle, bay));
    if (type === "TOPSTOCK") {
      const inventoried = matching.some(
        (a) =>
          a.location_type === "top_stock" &&
          String(a.sims_location ?? "").trim().length > 0
      );
      if (!inventoried) flags.push("topstock_uninventoried");
    }

    const mismatch = matching.some(
      (a) =>
        !String(a.sims_location ?? "").trim() || isDiscrepancy(a.variance_clf)
    );
    if (mismatch) flags.push("sims_mismatch");

    if (flags.length === 0) continue;

    findings.push({
      rotationId: rotation.id,
      locationId: loc.id || rotation.location_id,
      aisle,
      bay,
      type,
      flags,
      ageDays,
      score: findingScore(flags),
    });
  }

  const troubleAisles = [
    ...new Set(findings.map((f) => f.aisle).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const staleCount = findings.filter((f) => f.flags.includes("stale")).length;
  const neverAuditedCount = findings.filter((f) =>
    f.flags.includes("never_audited")
  ).length;
  const topstockGapCount = findings.filter((f) =>
    f.flags.includes("topstock_uninventoried")
  ).length;
  const simsMismatchCount = findings.filter((f) =>
    f.flags.includes("sims_mismatch")
  ).length;

  const assigned = input.rotations.filter((r) => r.store_locations).length;
  const healthy = Math.max(0, assigned - findings.length);
  const score =
    assigned <= 0
      ? 100
      : Math.round(
          (healthy * 100 + findings.reduce((sum, f) => sum + f.score, 0)) /
            assigned
        );

  return {
    findings,
    staleCount,
    neverAuditedCount,
    topstockGapCount,
    simsMismatchCount,
    troubleAisleCount: troubleAisles.length,
    troubleAisles,
    score,
    tone: overallTone(score, findings.length),
  };
}
