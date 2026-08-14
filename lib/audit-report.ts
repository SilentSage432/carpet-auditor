/**
 * Audit report composition — formats shift / department audit rows into
 * printable, emailable, and clipboard-ready summaries.
 * Presentation (AuditReportModal) renders; this module owns report text math only.
 */

import { formatClf, formatSqFt } from "./calc";
import { formatAuditLocationBadge } from "./store-ops/audit-location-mode";
import type { CarpetAudit, StoreSpecialist } from "./types";
import { classifyVariance, formatVariance, isDiscrepancy } from "./variance";
import { roleBadge } from "./specialists";

export type AuditReportKind = "flooring" | "appliances" | "department";

export type AuditReportMetrics = {
  totalEntries: number;
  totalUnits: number;
  simsBayCount: number;
  totalClf: number;
  totalSqFt: number;
  shortageCount: number;
  overageCount: number;
  matchCount: number;
  shortageSum: number;
  overageSum: number;
};

export type AuditReportContext = {
  kind: AuditReportKind;
  departmentLabel: string;
  storeNumber: string;
  audits: CarpetAudit[];
  specialist: StoreSpecialist | null;
  auditedBy: string;
  networkLabel: string;
  generatedAt: Date;
};

function locationLabel(location: CarpetAudit["location_type"]): string {
  return formatAuditLocationBadge(location);
}

function qtyDisplay(audit: CarpetAudit): string {
  if (audit.box_count != null && audit.box_count > 0) {
    if (audit.calculated_sqft != null && audit.calculated_sqft > 0) {
      return `${audit.box_count} units / ${formatSqFt(audit.calculated_sqft)} sq ft`;
    }
    return `${audit.box_count} units`;
  }
  if (audit.calculated_clf > 0) {
    return `${formatClf(audit.calculated_clf)} CLF`;
  }
  return "—";
}

export function computeReportMetrics(audits: CarpetAudit[]): AuditReportMetrics {
  const bays = new Set(
    audits.map((a) => a.sims_location.trim()).filter(Boolean)
  );
  let totalUnits = 0;
  let totalClf = 0;
  let totalSqFt = 0;
  let shortageCount = 0;
  let overageCount = 0;
  let matchCount = 0;
  let shortageSum = 0;
  let overageSum = 0;

  for (const a of audits) {
    totalUnits += a.box_count ?? 0;
    totalClf += a.calculated_clf;
    totalSqFt += a.calculated_sqft ?? 0;
    const kind = classifyVariance(a.variance_clf);
    if (kind === "shortage" && a.variance_clf != null) {
      shortageCount += 1;
      shortageSum += a.variance_clf;
    } else if (kind === "overage" && a.variance_clf != null) {
      overageCount += 1;
      overageSum += a.variance_clf;
    } else if (kind === "match") {
      matchCount += 1;
    }
  }

  return {
    totalEntries: audits.length,
    totalUnits,
    simsBayCount: bays.size,
    totalClf,
    totalSqFt,
    shortageCount,
    overageCount,
    matchCount,
    shortageSum,
    overageSum,
  };
}

/** Sort by SIMS bay, then category, sub-category, then SKU. */
export function sortAuditsForReport(audits: CarpetAudit[]): CarpetAudit[] {
  return [...audits].sort((a, b) => {
    const bay = (a.sims_location || "zzz").localeCompare(
      b.sims_location || "zzz"
    );
    if (bay !== 0) return bay;
    const cat = a.category.localeCompare(b.category);
    if (cat !== 0) return cat;
    const sub = (a.sub_category || "").localeCompare(b.sub_category || "");
    if (sub !== 0) return sub;
    return a.sku.localeCompare(b.sku);
  });
}

function categoryDisplay(a: CarpetAudit): string {
  if (a.sub_category?.trim()) {
    return `${a.category} · ${a.sub_category}`;
  }
  return a.category;
}

export function reportTitle(ctx: AuditReportContext): string {
  return `${ctx.departmentLabel} SIMS & Cycle Audit Summary Report`;
}

export function reportSubject(ctx: AuditReportContext): string {
  const date = ctx.generatedAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `[DeptSync] ${ctx.departmentLabel} SIMS Audit Report - Store #${ctx.storeNumber} - ${date}`;
}

export function specialistDisplay(ctx: AuditReportContext): string {
  if (ctx.specialist) {
    return `${ctx.specialist.name} · ${roleBadge(ctx.specialist)}`;
  }
  return ctx.auditedBy || "—";
}

export function formatReportTimestamp(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function discrepancyLines(metrics: AuditReportMetrics): string[] {
  const hasVariance =
    metrics.shortageCount + metrics.overageCount + metrics.matchCount > 0;
  if (!hasVariance) {
    return ["Discrepancies: (no system on-hand values entered)"];
  }
  return [
    `Discrepancies: ${metrics.shortageCount} shortage · ${metrics.overageCount} overage · ${metrics.matchCount} match`,
    metrics.shortageCount > 0
      ? `  Shortage total: ${formatVariance(metrics.shortageSum)}`
      : null,
    metrics.overageCount > 0
      ? `  Overage total: ${formatVariance(metrics.overageSum)}`
      : null,
  ].filter((line): line is string => line != null);
}

/** Plain-text body for mailto / Web Share. */
export function buildEmailBody(ctx: AuditReportContext): string {
  const metrics = computeReportMetrics(ctx.audits);
  const sorted = sortAuditsForReport(ctx.audits);
  const lines = [
    `DeptSync Hub · Lowe's Store #${ctx.storeNumber}`,
    reportTitle(ctx),
    `Generated: ${formatReportTimestamp(ctx.generatedAt)}`,
    `Audited By: ${specialistDisplay(ctx)}`,
    `Network: ${ctx.networkLabel}`,
    "",
    "— EXECUTIVE SUMMARY —",
    `Total Items Audited: ${metrics.totalEntries}`,
    `Total Units: ${metrics.totalUnits}`,
    `SIMS Bays Audited: ${metrics.simsBayCount}`,
  ];

  if (ctx.kind === "flooring") {
    lines.push(
      `Cumulative CLF: ${formatClf(metrics.totalClf)}`,
      `Cumulative Sq Ft: ${formatSqFt(metrics.totalSqFt)}`
    );
  } else {
    lines.push(`Unit Count: ${metrics.totalUnits}`);
  }

  lines.push(...discrepancyLines(metrics), "", "— ITEMIZED BREAKDOWN —");

  if (sorted.length === 0) {
    lines.push("(No audit entries for this report.)");
  } else {
    for (const a of sorted) {
      const variance =
        a.variance_clf != null && isDiscrepancy(a.variance_clf)
          ? ` | Var ${formatVariance(a.variance_clf)}`
          : "";
      lines.push(
        `${a.sims_location || "—"} | SKU ${a.sku} | ${a.carpet_name || "—"} | ${categoryDisplay(a)} | ${locationLabel(a.location_type)} | ${qtyDisplay(a)} | ${a.audited_by || "—"}${variance}`
      );
    }
  }

  lines.push("", "— Sent from DeptSync Hub —");
  return lines.join("\n");
}

/** Markdown / table-friendly clipboard summary for Teams / Outlook paste. */
export function buildClipboardSummary(ctx: AuditReportContext): string {
  const metrics = computeReportMetrics(ctx.audits);
  const sorted = sortAuditsForReport(ctx.audits);
  const lines = [
    `# ${reportTitle(ctx)}`,
    "",
    `**DeptSync Hub · Lowe's Store #${ctx.storeNumber}**`,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Generated | ${formatReportTimestamp(ctx.generatedAt)} |`,
    `| Audited By | ${specialistDisplay(ctx)} |`,
    `| Network | ${ctx.networkLabel} |`,
    `| Items | ${metrics.totalEntries} |`,
    `| Units | ${metrics.totalUnits} |`,
    `| SIMS Bays | ${metrics.simsBayCount} |`,
  ];

  if (ctx.kind === "flooring") {
    lines.push(
      `| Cumulative CLF | ${formatClf(metrics.totalClf)} |`,
      `| Cumulative Sq Ft | ${formatSqFt(metrics.totalSqFt)} |`
    );
  }

  lines.push(
    "",
    "### Discrepancy Summary",
    ...discrepancyLines(metrics).map((l) => `- ${l}`),
    "",
    "### Itemized Audit Breakdown",
    "",
    "| SIMS Bay | Item # / SKU | Description | Category | Sub-category | Location | Qty / CLF | Audited By |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  );

  if (sorted.length === 0) {
    lines.push("| — | — | No entries | — | — | — | — | — |");
  } else {
    for (const a of sorted) {
      lines.push(
        `| ${a.sims_location || "—"} | ${a.sku} | ${a.carpet_name || "—"} | ${a.category} | ${a.sub_category || "—"} | ${locationLabel(a.location_type)} | ${qtyDisplay(a)} | ${a.audited_by || "—"} |`
      );
    }
  }

  return lines.join("\n");
}

export async function shareOrEmailReport(
  ctx: AuditReportContext
): Promise<"shared" | "mailto" | "failed"> {
  const subject = reportSubject(ctx);
  const body = buildEmailBody(ctx);

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({ title: subject, text: body });
      return "shared";
    } catch (err) {
      // User cancel — don't fall through to mailto
      if (err instanceof DOMException && err.name === "AbortError") {
        return "failed";
      }
    }
  }

  try {
    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    return "mailto";
  } catch {
    return "failed";
  }
}
