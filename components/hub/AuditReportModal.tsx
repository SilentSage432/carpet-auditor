"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildClipboardSummary,
  computeReportMetrics,
  formatReportTimestamp,
  reportSubject,
  reportTitle,
  shareOrEmailReport,
  sortAuditsForReport,
  specialistDisplay,
  type AuditReportContext,
  type AuditReportKind,
} from "@/lib/audit-report";
import { formatClf, formatSqFt } from "@/lib/calc";
import { getStoreNumber } from "@/lib/store";
import { useNetworkBadge } from "@/lib/network";
import { formatAuditLocationBadge } from "@/lib/store-ops/audit-location-mode";
import type { CarpetAudit, StoreSpecialist } from "@/lib/types";
import { classifyVariance, formatVariance } from "@/lib/variance";

type Props = {
  open: boolean;
  onClose: () => void;
  kind: AuditReportKind;
  departmentLabel: string;
  audits: CarpetAudit[];
  specialist: StoreSpecialist | null;
  auditedBy: string;
};

function locationLabel(location: CarpetAudit["location_type"]): string {
  return formatAuditLocationBadge(location);
}

function qtyCell(audit: CarpetAudit): string {
  if (audit.box_count != null && audit.box_count > 0) {
    if (audit.calculated_sqft != null && audit.calculated_sqft > 0) {
      return `${audit.box_count} / ${formatSqFt(audit.calculated_sqft)} sqft`;
    }
    return `${audit.box_count}`;
  }
  if (audit.calculated_clf > 0) return `${formatClf(audit.calculated_clf)} CLF`;
  return "—";
}

export function AuditReportModal({
  open,
  onClose,
  kind,
  departmentLabel,
  audits,
  specialist,
  auditedBy,
}: Props) {
  const network = useNetworkBadge();
  const [copied, setCopied] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState(() => new Date());

  useEffect(() => {
    if (open) {
      setGeneratedAt(new Date());
      setCopied(false);
      setActionMsg(null);
    }
  }, [open]);

  const ctx: AuditReportContext = useMemo(
    () => ({
      kind,
      departmentLabel,
      storeNumber: getStoreNumber(),
      audits,
      specialist,
      auditedBy,
      networkLabel: network.label,
      generatedAt,
    }),
    [
      kind,
      departmentLabel,
      audits,
      specialist,
      auditedBy,
      network.label,
      generatedAt,
    ]
  );

  const metrics = useMemo(() => computeReportMetrics(audits), [audits]);
  const sorted = useMemo(() => sortAuditsForReport(audits), [audits]);
  const hasVarianceRows =
    metrics.shortageCount + metrics.overageCount + metrics.matchCount > 0;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function flash(msg: string) {
    setActionMsg(msg);
    window.setTimeout(() => setActionMsg(null), 2500);
  }

  function handlePrint() {
    window.print();
  }

  async function handleEmail() {
    const result = await shareOrEmailReport(ctx);
    if (result === "shared") flash("Shared via device share sheet");
    else if (result === "mailto") flash("Opening email client…");
    else flash("Share cancelled");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildClipboardSummary(ctx));
      setCopied(true);
      flash("Formatted summary copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      flash("Clipboard unavailable");
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center print:static print:inset-auto print:z-auto print:block">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-md print:hidden"
        aria-label="Close report"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-report-title"
        className="relative z-[71] glass-card theme-modal flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden !rounded-t-2xl !rounded-b-none sm:!rounded-2xl print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:bg-white print:shadow-none"
      >
        {/* Screen-only chrome */}
        <div className="no-print shrink-0 space-y-3 border-b border-zinc-800 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-accent">
                Export & Print
              </p>
              <h2
                id="audit-report-title"
                className="mt-0.5 truncate text-lg font-bold text-white"
              >
                📊 Audit Report
              </h2>
              <p className="mt-0.5 truncate text-xs text-zinc-400">
                {reportSubject(ctx)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-300"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={handlePrint}
              className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 text-sm font-bold text-emerald-200 active:scale-[0.98]"
            >
              🖨️ Print / Save PDF
            </button>
            <button
              type="button"
              onClick={() => void handleEmail()}
              className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-950/40 px-3 text-sm font-bold text-sky-200 active:scale-[0.98]"
            >
              ✉️ Send via Email
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-zinc-600 bg-zinc-800 px-3 text-sm font-bold text-zinc-100 active:scale-[0.98]"
            >
              {copied ? "✓ Copied" : "📋 Copy Summary"}
            </button>
          </div>

          {actionMsg ? (
            <p
              role="status"
              className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1.5 text-center text-xs font-medium text-emerald-200"
            >
              {actionMsg}
            </p>
          ) : null}
        </div>

        {/* Printable report body */}
        <div
          id="audit-report-print-area"
          className="audit-report-print min-h-0 flex-1 overflow-y-auto p-4 print:overflow-visible print:p-0"
        >
          <header className="report-header border-b border-zinc-700 pb-3 print:border-black print:pb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400 print:text-black">
              DeptSync Hub · Lowe&apos;s Store #{ctx.storeNumber}
            </p>
            <h3 className="mt-1 text-base font-bold text-white print:text-lg print:text-black">
              {reportTitle(ctx)}
            </h3>
            <dl className="mt-2 grid gap-1 text-xs text-zinc-300 print:text-black sm:grid-cols-2">
              <div>
                <dt className="inline text-zinc-500 print:text-black">
                  Audit Date:{" "}
                </dt>
                <dd className="inline font-mono">
                  {formatReportTimestamp(ctx.generatedAt)}
                </dd>
              </div>
              <div>
                <dt className="inline text-zinc-500 print:text-black">
                  Audited By:{" "}
                </dt>
                <dd className="inline font-semibold">
                  {specialistDisplay(ctx)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="inline text-zinc-500 print:text-black">
                  Network / Store Sync:{" "}
                </dt>
                <dd className="inline">{ctx.networkLabel}</dd>
              </div>
            </dl>
          </header>

          <section
            aria-label="Executive summary"
            className="report-metrics mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 print:mt-3 print:gap-1"
          >
            <MetricCard label="Items Audited" value={String(metrics.totalEntries)} />
            <MetricCard label="SIMS Bays" value={String(metrics.simsBayCount)} />
            {kind === "flooring" ? (
              <>
                <MetricCard
                  label="Cumulative CLF"
                  value={formatClf(metrics.totalClf)}
                />
                <MetricCard
                  label="Sq Ft / Units"
                  value={`${formatSqFt(metrics.totalSqFt)} / ${metrics.totalUnits}`}
                />
              </>
            ) : (
              <>
                <MetricCard label="Unit Count" value={String(metrics.totalUnits)} />
                <MetricCard
                  label="Entries Today"
                  value={String(metrics.totalEntries)}
                />
              </>
            )}
          </section>

          {hasVarianceRows ? (
            <section
              aria-label="Discrepancy summary"
              className="mt-3 rounded-xl border border-zinc-700 bg-zinc-950/60 p-3 text-xs text-zinc-200 print:rounded-none print:border print:border-black print:bg-white print:text-black"
            >
              <p className="font-bold uppercase tracking-wide text-zinc-400 print:text-black">
                Shortage / Overage Summary
              </p>
              <p className="mt-1 font-mono">
                {metrics.shortageCount} shortage
                {metrics.shortageCount > 0
                  ? ` (${formatVariance(metrics.shortageSum)})`
                  : ""}{" "}
                · {metrics.overageCount} overage
                {metrics.overageCount > 0
                  ? ` (${formatVariance(metrics.overageSum)})`
                  : ""}{" "}
                · {metrics.matchCount} match
              </p>
            </section>
          ) : (
            <p className="mt-3 text-xs text-zinc-500 print:text-black">
              Discrepancy summary unavailable — no system on-hand values entered.
            </p>
          )}

          <section aria-label="Itemized audit breakdown" className="mt-4 print:mt-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400 print:text-black">
              Itemized Audit Breakdown
            </h4>
            <div className="overflow-x-auto rounded-xl border border-zinc-700 print:overflow-visible print:rounded-none print:border print:border-black">
              <table className="audit-report-table w-full min-w-[640px] border-collapse text-left text-[11px] print:min-w-0 print:text-[9pt]">
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-950 text-zinc-400 print:border-black print:bg-white print:text-black">
                    <th className="px-2 py-2 font-bold">SIMS Bay</th>
                    <th className="px-2 py-2 font-bold">Item # / SKU</th>
                    <th className="px-2 py-2 font-bold">Description</th>
                    <th className="px-2 py-2 font-bold">Category</th>
                    <th className="px-2 py-2 font-bold">Sub-cat</th>
                    <th className="px-2 py-2 font-bold">Loc</th>
                    <th className="px-2 py-2 font-bold">Qty / CLF</th>
                    <th className="px-2 py-2 font-bold">Audited By</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-2 py-6 text-center text-zinc-500 print:text-black"
                      >
                        No audit entries to report.
                      </td>
                    </tr>
                  ) : (
                    sorted.map((a) => {
                      const kindVar = classifyVariance(a.variance_clf);
                      return (
                        <tr
                          key={a.id}
                          className="border-b border-zinc-800 text-zinc-200 print:border-black print:text-black"
                        >
                          <td className="px-2 py-1.5 font-mono">
                            {a.sims_location || "—"}
                          </td>
                          <td className="px-2 py-1.5 font-mono font-semibold">
                            {a.sku}
                          </td>
                          <td className="max-w-[10rem] truncate px-2 py-1.5">
                            {a.carpet_name || "—"}
                          </td>
                          <td className="px-2 py-1.5">{a.category}</td>
                          <td className="px-2 py-1.5">
                            {a.sub_category || "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            {locationLabel(a.location_type)}
                          </td>
                          <td className="px-2 py-1.5 font-mono">
                            {qtyCell(a)}
                            {a.variance_clf != null && kindVar !== "none" ? (
                              <span className="mt-0.5 block text-[10px] text-zinc-500 print:text-black">
                                {formatVariance(a.variance_clf)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5">{a.audited_by || "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="mt-4 text-[10px] text-zinc-500 print:mt-3 print:text-black">
            Generated by DeptSync Hub · {audits.length} row
            {audits.length === 1 ? "" : "s"} · Store #{ctx.storeNumber}
          </footer>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-950/70 p-2.5 print:rounded-none print:border print:border-black print:bg-white">
      <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-500 print:text-black">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-white print:text-black">
        {value}
      </p>
    </div>
  );
}
