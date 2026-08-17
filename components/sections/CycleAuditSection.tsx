"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FlooringAIInsightBanner } from "@/components/flooring/FlooringAIInsightBanner";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { CycleAuditScanForm } from "@/components/sections/CycleAuditScanForm";
import { HubIcon } from "@/components/hub/NavIcons";
import { VarianceStatusIcon } from "@/components/hub/StatusPills";
import { ApplyMarkdownModal } from "@/components/hub/ApplyMarkdownModal";

const SimsLocationFinder = dynamic(
  () =>
    import("@/components/catalog/SimsLocationFinder").then(
      (m) => m.SimsLocationFinder
    ),
  { ssr: false }
);
const AuditReportModal = dynamic(
  () =>
    import("@/components/hub/AuditReportModal").then((m) => m.AuditReportModal),
  { ssr: false }
);
const VisualBayScannerModal = dynamic(
  () =>
    import("@/components/store-ops/VisualBayScannerModal").then(
      (m) => m.VisualBayScannerModal
    ),
  { ssr: false }
);
import { isSupervisor } from "@/lib/specialists";
import { isMasterAdmin } from "@/lib/rbac";
import {
  formatClf,
  formatMeasurementDisplay,
  formatSqFt,
} from "@/lib/calc";
import { blurActiveInput } from "@/lib/focus-input";
import { getStoreNumber } from "@/lib/store";
import {
  auditsToCsv,
  deleteAudit,
  fetchAudits,
  isToday,
} from "@/lib/storage";
import {
  type CarpetAudit,
  type CatalogItem,
  type LocationType,
  type Remnant,
  type StoreSpecialist,
} from "@/lib/types";
import {
  classifyVariance,
  formatVariance,
  isDiscrepancy,
  varianceBadgeClass,
  varianceLabel,
} from "@/lib/variance";

import { formatAuditLocationBadge } from "@/lib/store-ops/audit-location-mode";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Props = {
  catalog: CatalogItem[];
  onCatalogChange: (items: CatalogItem[]) => void;
  auditedBy: string;
  specialists: StoreSpecialist[];
  activeSpecialist: StoreSpecialist | null;
  remnants: Remnant[];
  onRemnantsChange: (items: Remnant[]) => void;
  /** Disable wedge scanner while this hub section is hidden. */
  scannerEnabled?: boolean;
};

export function CycleAuditSection({
  catalog,
  onCatalogChange,
  auditedBy,
  specialists,
  activeSpecialist,
  remnants,
  onRemnantsChange,
  scannerEnabled = true,
}: Props) {
  const [audits, setAudits] = useState<CarpetAudit[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filterSpecialist, setFilterSpecialist] = useState("all");
  const [filterLocation, setFilterLocation] = useState<"all" | LocationType>("all");
  const [filterDiscrepancies, setFilterDiscrepancies] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [markdownTarget, setMarkdownTarget] = useState<Remnant | null>(null);
  const [simsFinderOpen, setSimsFinderOpen] = useState(false);
  const [bayScanOpen, setBayScanOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [undoToast, setUndoToast] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const canViewDiscrepancies =
    isSupervisor(activeSpecialist) || isMasterAdmin(activeSpecialist);

  const shiftAudits = useMemo(() => audits.filter((a) => isToday(a.created_at)), [audits]);
  const floorCount = useMemo(
    () => shiftAudits.filter((a) => a.location_type === "sales_floor").length,
    [shiftAudits]
  );
  const topStockCount = useMemo(
    () => shiftAudits.filter((a) => a.location_type === "top_stock").length,
    [shiftAudits]
  );
  const totalRolls = floorCount + topStockCount;
  const cumulativeClf = useMemo(
    () => audits.reduce((sum, a) => sum + a.calculated_clf, 0),
    [audits]
  );
  const shiftClf = useMemo(
    () => shiftAudits.reduce((sum, a) => sum + a.calculated_clf, 0),
    [shiftAudits]
  );
  const shiftSqFt = useMemo(
    () =>
      shiftAudits.reduce((sum, a) => sum + (a.calculated_sqft ?? 0), 0),
    [shiftAudits]
  );
  const shiftCartons = useMemo(
    () => shiftAudits.reduce((sum, a) => sum + (a.box_count ?? 0), 0),
    [shiftAudits]
  );

  const filteredAudits = useMemo(() => {
    return audits.filter((a) => {
      if (filterSpecialist !== "all" && a.audited_by !== filterSpecialist) {
        return false;
      }
      if (filterLocation !== "all" && a.location_type !== filterLocation) {
        return false;
      }
      if (filterDiscrepancies && canViewDiscrepancies && !isDiscrepancy(a.variance_clf)) {
        return false;
      }
      return true;
    });
  }, [audits, filterSpecialist, filterLocation, filterDiscrepancies, canViewDiscrepancies]);

  const visibleAudits = showAll ? filteredAudits : filteredAudits.slice(0, 5);

  const specialistOptions = useMemo(() => {
    const names = new Set<string>([
      ...specialists.map((s) => s.name),
      ...audits.map((a) => a.audited_by).filter(Boolean),
    ]);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [specialists, audits]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchAudits();
      if (!cancelled) {
        setAudits(rows);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissKeyboard = useCallback(() => {
    blurActiveInput();
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current != null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const flashStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2800);
  }, []);

  function showUndoToast(record: CarpetAudit) {
    if (undoTimerRef.current != null) {
      window.clearTimeout(undoTimerRef.current);
    }
    const qty =
      record.box_count != null && record.box_count > 0
        ? `${formatSqFt(record.calculated_sqft ?? 0)} sq ft`
        : `${formatClf(record.calculated_clf)} CLF`;
    const name = record.carpet_name.trim() || `SKU ${record.sku}`;
    setUndoToast({ id: record.id, label: `Logged ${qty} — ${name}` });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoToast(null);
      undoTimerRef.current = null;
    }, 6000);
  }

  async function handleUndoLast() {
    if (!undoToast) return;
    const id = undoToast.id;
    if (undoTimerRef.current != null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoToast(null);
    await deleteAudit(id);
    setAudits((prev) => prev.filter((a) => a.id !== id));
    flashStatus("Last audit undone");
    dismissKeyboard();
  }

  async function handleDelete(id: string) {
    await deleteAudit(id);
    setAudits((prev) => prev.filter((a) => a.id !== id));
    flashStatus("Entry removed");
  }

  async function handleCopySummary() {
    const lines = [
      "Flooring Cycle Count — Shift Summary",
      `Store: Lowe's #${getStoreNumber()}`,
      `Date: ${new Date().toLocaleDateString()}`,
      `Total entries: ${totalRolls} (SELLING ${floorCount} / TOPSTOCK ${topStockCount})`,
      `Shift CLF: ${formatClf(shiftClf)}`,
      `Shift SqFt: ${formatSqFt(shiftSqFt)}`,
      `Cumulative CLF: ${formatClf(cumulativeClf)}`,
      "",
      ...shiftAudits.map((a) => {
        const qty =
          a.box_count != null && a.box_count > 0
            ? `${a.box_count} units / ${formatSqFt(a.calculated_sqft ?? 0)} sq ft`
            : `${formatMeasurementDisplay(a.measurement_inches, a.measurement_fraction)} × ${a.rounds} = ${formatClf(a.calculated_clf)} CLF`;
        return `${formatTime(a.created_at)} | SKU ${a.sku} | ${a.carpet_name || "—"} | ${a.category} | ${a.sims_location || "—"} | ${formatAuditLocationBadge(a.location_type)} | ${qty}`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      flashStatus("Clipboard unavailable");
    }
  }

  function handleExportCsv() {
    const csv = auditsToCsv(shiftAudits.length > 0 ? shiftAudits : audits);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flooring-cycle-count-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flashStatus("CSV exported");
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      {simsFinderOpen ? (
        <SimsLocationFinder
          open={simsFinderOpen}
          onClose={() => {
            setSimsFinderOpen(false);
            dismissKeyboard();
          }}
          catalog={catalog}
          audits={audits}
        />
      ) : null}
      {reportOpen ? (
        <AuditReportModal
          open={reportOpen}
          onClose={() => {
            setReportOpen(false);
            dismissKeyboard();
          }}
          kind="flooring"
          departmentLabel="Flooring"
          audits={shiftAudits.length > 0 ? shiftAudits : audits}
          specialist={activeSpecialist}
          auditedBy={auditedBy}
        />
      ) : null}
      <ApplyMarkdownModal
        key={markdownTarget?.id ?? "cycle-markdown-closed"}
        open={markdownTarget != null}
        remnant={markdownTarget}
        specialists={specialists}
        activeSpecialist={activeSpecialist}
        onClose={() => setMarkdownTarget(null)}
        onApplied={(record) => {
          onRemnantsChange([
            record,
            ...remnants.filter((r) => r.id !== record.id),
          ]);
          setMarkdownTarget(null);
        }}
      />

      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <FlooringAIInsightBanner
            remnants={remnants}
            audits={shiftAudits.length > 0 ? shiftAudits : audits}
            specialists={specialists}
            activeSpecialist={activeSpecialist}
            onRemnantsChange={onRemnantsChange}
            onRequestMarkdown={setMarkdownTarget}
            compact
          />
        </div>
        {activeSpecialist ? (
          <button
            type="button"
            onClick={() => setBayScanOpen(true)}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-zinc-950/70 px-3 font-mono text-[11px] font-bold uppercase tracking-wide text-accent"
          >
            <HubIcon id="camera" className="h-4 w-4" />
            Snap Bay
          </button>
        ) : null}
      </div>

      {activeSpecialist && bayScanOpen ? (
        <VisualBayScannerModal
          open={bayScanOpen}
          onClose={() => setBayScanOpen(false)}
          specialist={activeSpecialist}
          meta={{ department_code: "flooring" }}
        />
      ) : null}

      {undoToast ? (
        <div
          role="status"
          className="hub-toast-dock flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-zinc-900/90 px-3 py-3 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
            {undoToast.label}
          </p>
          <button
            type="button"
            onClick={() => void handleUndoLast()}
            className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-400/50 bg-amber-950/50 px-3 text-sm font-bold text-amber-200 active:scale-95"
          >
            <HubIcon id="undo" className="h-4 w-4" strokeWidth={1.75} />
            Undo
          </button>
        </div>
      ) : null}

      {statusMsg && (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-center text-sm font-medium text-emerald-200"
        >
          {statusMsg}
        </p>
      )}

      <CycleAuditScanForm
        catalog={catalog}
        onCatalogChange={onCatalogChange}
        auditedBy={auditedBy}
        scannerEnabled={scannerEnabled}
        onOpenSimsFinder={() => setSimsFinderOpen(true)}
        onLogged={(record, offline) => {
          setAudits((prev) => [record, ...prev.filter((a) => a.id !== record.id)]);
          showUndoToast(record);
          flashStatus(
            offline
              ? "Saved offline — form reset"
              : record.box_count != null && record.box_count > 0
                ? "Units logged — form reset"
                : "Roll logged — form reset"
          );
        }}
      />

      <section
        aria-label="Shift summary"
        className="overflow-x-auto glass-card shadow-lg shadow-black/20"
      >
        <button
          type="button"
          onClick={() => setSummaryExpanded((v) => !v)}
          aria-expanded={summaryExpanded}
          className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tabular-nums text-slate-200 sm:text-sm">
            📊 {loaded ? totalRolls : "—"} Audited
            <span className="text-slate-500"> | </span>
            {loaded ? formatClf(shiftClf) : "—"} CLF
            <span className="text-slate-500"> | </span>
            {loaded ? shiftCartons : "—"} Cartons
          </span>
          <span className="shrink-0 text-xs font-semibold text-emerald-400">
            {summaryExpanded ? "Collapse ▴" : "Expand ▾"}
          </span>
        </button>
        {summaryExpanded ? (
          <div className="space-y-3 border-t border-slate-800 p-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Entries
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-50">
                  {loaded ? totalRolls : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-400/80">
                  SELLING
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
                  {loaded ? floorCount : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-cyan-400/80">
                  TOPSTOCK
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-300">
                  {loaded ? topStockCount : "—"}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              Cumulative CLF:{" "}
              <span className="font-mono text-lg font-semibold text-emerald-400">
                {loaded ? formatClf(cumulativeClf) : "—"}
              </span>
              <span className="ml-2 font-mono text-xs text-slate-500">
                (shift {loaded ? formatClf(shiftClf) : "—"}
                {shiftSqFt > 0 ? ` · ${formatSqFt(shiftSqFt)} sq ft` : ""})
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleCopySummary()}
                className="flex h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-slate-100"
              >
                {copied ? "Copied ✓" : "Copy Shift Summary"}
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="flex h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-slate-100"
              >
                Export CSV
              </button>
            </div>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="flex h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 text-sm font-bold text-emerald-200 active:scale-[0.98]"
            >
              📊 Export / Print Report
            </button>
          </div>
        ) : null}
      </section>

      {activeSpecialist ? (
        <SundayAuditStagingCard
          specialist={activeSpecialist}
          forceShow
        />
      ) : null}

      <section className="space-y-3 overflow-x-hidden" aria-label="Shift audit log">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="glass-subtitle">
            Shift log
          </h2>
          <span className="font-mono text-xs text-zinc-500">
            {filteredAudits.length}/{audits.length}
          </span>
        </div>

        <div className="glass-card overflow-hidden !rounded-xl">
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
            className="flex min-h-11 w-full items-center justify-between px-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500"
          >
            Filters
            <span aria-hidden>{filtersOpen ? "▲" : "▼"}</span>
          </button>
          {filtersOpen ? (
            <div className="space-y-2 border-t border-zinc-800/80 p-3">
          <label className="block space-y-1">
            <span className="text-xs text-zinc-400">Specialist</span>
            <select
              value={filterSpecialist}
              onChange={(e) => setFilterSpecialist(e.target.value)}
              className="glass-input min-h-12 text-base"
            >
              <option value="all">All</option>
              {specialistOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-slate-400">Location</span>
            <select
              value={filterLocation}
              onChange={(e) =>
                setFilterLocation(e.target.value as "all" | LocationType)
              }
              className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
            >
              <option value="all">All</option>
              <option value="sales_floor">SELLING · lower floor</option>
              <option value="top_stock">TOPSTOCK · overheads</option>
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3">
            <input
              type="checkbox"
              checked={filterDiscrepancies && canViewDiscrepancies}
              disabled={!canViewDiscrepancies}
              onChange={(e) => {
                if (!canViewDiscrepancies) return;
                setFilterDiscrepancies(e.target.checked);
              }}
              className="h-5 w-5 accent-emerald-500 disabled:opacity-40"
            />
            <span className="min-w-0 text-sm text-slate-200">
              Discrepancies only
              {!canViewDiscrepancies ? (
                <span className="mt-0.5 block text-xs text-slate-500">
                  Supervisor / Master Admin session required
                </span>
              ) : null}
            </span>
          </label>
            </div>
          ) : null}
        </div>

        {!loaded && (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
            Loading audits…
          </p>
        )}

        {loaded && filteredAudits.length === 0 && (
          <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
            {audits.length === 0
              ? "No audits logged yet — scan a barcode to start."
              : "No entries match the current filters."}
          </p>
        )}

        <ul className="glass-card divide-y divide-zinc-800/80 overflow-hidden !rounded-xl !p-0">
          {visibleAudits.map((audit) => {
            const kind = classifyVariance(audit.variance_clf);
            const isCarton =
              audit.box_count != null && audit.box_count > 0;
            return (
              <li
                key={audit.id}
                className="flex min-h-11 items-center gap-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-semibold tracking-tight tabular-nums text-white">
                    {audit.sku}
                    <span className="ml-2 font-sans text-[10px] font-bold uppercase text-zinc-500">
                      {formatAuditLocationBadge(audit.location_type)}
                    </span>
                    {kind !== "none" ? (
                      <span
                        className={`ml-2 inline-flex items-center gap-1 align-middle ${
                          kind === "match"
                            ? "glass-pill-emerald"
                            : kind === "shortage"
                              ? "glass-pill-rose"
                              : "glass-pill-amber"
                        }`}
                      >
                        <VarianceStatusIcon kind={kind} className="h-3 w-3" />
                        {varianceLabel(kind)}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {isCarton
                      ? `${audit.box_count} units · ${formatSqFt(audit.calculated_sqft ?? 0)} sq ft`
                      : `${formatClf(audit.calculated_clf)} CLF`}
                    {audit.variance_clf != null
                      ? ` · ${formatVariance(audit.variance_clf)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Delete SKU ${audit.sku}`}
                  onClick={() => void handleDelete(audit.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-xs font-bold text-rose-300"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>

        {filteredAudits.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-sm font-semibold text-slate-200"
          >
            {showAll
              ? "Show Fewer Entries"
              : `Show All Logged Entries (${filteredAudits.length})`}
          </button>
        )}
      </section>
    </div>
  );
}
