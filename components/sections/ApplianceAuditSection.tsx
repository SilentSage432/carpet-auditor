"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApplianceAnomalyWidget } from "@/components/appliances/ApplianceAnomalyWidget";
import { ApplianceScanEditModal } from "@/components/appliances/ApplianceScanEditModal";
import { ConfirmModal } from "@/components/hub/ConfirmModal";
import { ApplianceScanForm } from "@/components/sections/ApplianceScanForm";
import {
  aggregateApplianceScans,
  applianceCategoryEmoji,
  APPLIANCE_SCAN_LOG_FILTERS,
  APPLIANCE_SCAN_LOG_PAGE_SIZE,
  applyApplianceGroupEdit,
  applianceScansToCsv,
  deleteApplianceScan,
  fetchApplianceScans,
  groupApplianceScansByCategory,
  isApplianceScanToday,
  matchesApplianceScanLogFilter,
  type AggregatedApplianceScan,
  type ApplianceScanLogFilterId,
} from "@/lib/appliance-scans";
import {
  type ApplianceCatalogItem,
  type ApplianceScan,
  type StoreSpecialist,
} from "@/lib/types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Props = {
  catalog: ApplianceCatalogItem[];
  onCatalogChange: (items: ApplianceCatalogItem[]) => void;
  scannedBy: string;
  activeSpecialist: StoreSpecialist | null;
  /** Disable wedge scanner while this hub section is hidden. */
  scannerEnabled?: boolean;
};

export function ApplianceAuditSection({
  catalog,
  onCatalogChange,
  scannedBy,
  activeSpecialist,
  scannerEnabled = true,
}: Props) {
  const [scans, setScans] = useState<ApplianceScan[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "error">("ok");
  const [loaded, setLoaded] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [logFilter, setLogFilter] =
    useState<ApplianceScanLogFilterId>("all");
  const [logQuery, setLogQuery] = useState("");
  /** SKU cards with unit-detail expand (nested under category accordion). */
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    () => new Set()
  );
  /** Main category accordions — default all collapsed. */
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set()
  );
  /** Per-category page index for SKU pagination (0-based). */
  const [categoryPages, setCategoryPages] = useState<Record<string, number>>(
    {}
  );
  const [editingGroup, setEditingGroup] =
    useState<AggregatedApplianceScan | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    useState<AggregatedApplianceScan | null>(null);

  const catalogDescriptions = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of catalog) {
      map[item.item_number] = item.description;
    }
    return map;
  }, [catalog]);

  const shiftScans = useMemo(
    () => scans.filter((s) => isApplianceScanToday(s.scanned_at)),
    [scans]
  );

  const filteredScans = useMemo(() => {
    const q = logQuery.trim().toLowerCase();
    return scans.filter((scan) => {
      if (!matchesApplianceScanLogFilter(scan, logFilter)) return false;
      if (!q) return true;
      const description =
        catalogDescriptions[scan.item_number]?.toLowerCase() ?? "";
      return (
        scan.item_number.toLowerCase().includes(q) ||
        scan.location.toLowerCase().includes(q) ||
        scan.serial_number.toLowerCase().includes(q) ||
        scan.category.toLowerCase().includes(q) ||
        String(scan.sub_category ?? "")
          .toLowerCase()
          .includes(q) ||
        description.includes(q)
      );
    });
  }, [scans, logFilter, logQuery, catalogDescriptions]);

  const aggregated = useMemo(
    () => aggregateApplianceScans(filteredScans, catalogDescriptions),
    [filteredScans, catalogDescriptions]
  );

  const categoryAccordions = useMemo(
    () => groupApplianceScansByCategory(aggregated),
    [aggregated]
  );

  const searchActive = logQuery.trim().length > 0;

  // Clearing search restores default: all category accordions collapsed.
  useEffect(() => {
    if (searchActive) return;
    setExpandedCategories(new Set());
    setCategoryPages({});
  }, [searchActive]);

  // Search / barcode filter → expand only matching category accordions.
  useEffect(() => {
    if (!searchActive) return;
    setExpandedCategories(
      new Set(categoryAccordions.map((accordion) => accordion.category))
    );
    setCategoryPages({});
  }, [searchActive, logQuery, categoryAccordions]);

  useEffect(() => {
    let cancelled = false;
    void fetchApplianceScans().then((rows) => {
      if (!cancelled) {
        setScans(rows);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flashStatus = useCallback((msg: string, tone: "ok" | "error" = "ok") => {
    setStatusTone(tone);
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), tone === "error" ? 5000 : 2800);
  }, []);

  const handleLogged = useCallback(
    (record: ApplianceScan, _offline: boolean) => {
      setScans((prev) => [record, ...prev.filter((s) => s.id !== record.id)]);
      void fetchApplianceScans()
        .then((refreshed) => setScans(refreshed))
        .catch((refreshErr) => {
          console.error(
            "[ApplianceAudit] re-fetch after save failed",
            refreshErr
          );
        });
    },
    []
  );

  async function handleDeleteScan(id: string) {
    await deleteApplianceScan(id);
    setScans((prev) => prev.filter((s) => s.id !== id));
    flashStatus("Entry removed");
  }

  async function confirmDeleteGroup() {
    const group = pendingDeleteGroup;
    setPendingDeleteGroup(null);
    if (!group) return;
    try {
      for (const scan of group.scans) {
        await deleteApplianceScan(scan.id);
      }
      setScans((prev) =>
        prev.filter((s) => s.item_number !== group.item_number)
      );
      flashStatus(`Removed Item ${group.item_number} (${group.quantity})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      flashStatus(`Failed to delete: ${message}`, "error");
      void fetchApplianceScans().then(setScans);
    }
  }

  async function handleSaveGroupEdit(input: {
    targetQuantity: number;
    location: string;
    serials: string[];
  }) {
    if (!editingGroup) return;
    setEditSaving(true);
    try {
      await applyApplianceGroupEdit({
        item_number: editingGroup.item_number,
        category: editingGroup.category,
        sub_category: editingGroup.sub_category,
        targetQuantity: input.targetQuantity,
        location: input.location,
        serials: input.serials,
        scanned_by: scannedBy || activeSpecialist?.name || "",
        existingScans: editingGroup.scans,
      });
      const refreshed = await fetchApplianceScans();
      setScans(refreshed);
      setEditingGroup(null);
      flashStatus(`Updated Item ${editingGroup.item_number}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      flashStatus(`Failed to update: ${message}`, "error");
    } finally {
      setEditSaving(false);
    }
  }

  function toggleExpanded(itemNumber: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemNumber)) next.delete(itemNumber);
      else next.add(itemNumber);
      return next;
    });
  }

  function toggleCategory(category: string) {
    // While searching, expansion is driven by matches — allow manual toggle too.
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
    setCategoryPages((prev) => ({ ...prev, [category]: 0 }));
  }

  function setCategoryPage(category: string, page: number) {
    setCategoryPages((prev) => ({ ...prev, [category]: Math.max(0, page) }));
  }

  function handleDownloadCsv() {
    const rows = shiftScans.length > 0 ? shiftScans : scans;
    const csv = applianceScansToCsv(rows, {
      descriptions: catalogDescriptions,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `appliance-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 overflow-x-hidden pb-4">
      <ApplianceScanEditModal
        open={editingGroup != null}
        group={editingGroup}
        saving={editSaving}
        onClose={() => {
          if (!editSaving) setEditingGroup(null);
        }}
        onSave={(input) => void handleSaveGroupEdit(input)}
      />

      <ConfirmModal
        open={pendingDeleteGroup != null}
        title={`Delete Item ${pendingDeleteGroup?.item_number ?? ""}?`}
        message={`This removes all ${pendingDeleteGroup?.quantity ?? 0} scanned unit(s) for this SKU from the log.`}
        confirmLabel="Delete all"
        danger
        onClose={() => setPendingDeleteGroup(null)}
        onConfirm={() => void confirmDeleteGroup()}
      />

      <ApplianceScanForm
        catalog={catalog}
        onCatalogChange={onCatalogChange}
        scannedBy={scannedBy}
        activeSpecialist={activeSpecialist}
        scannerEnabled={scannerEnabled}
        onLogged={handleLogged}
      />

      <ApplianceAnomalyWidget
        scans={loaded ? (shiftScans.length > 0 ? shiftScans : scans) : []}
        catalog={catalog}
        onFocusSku={(sku) => {
          setLogQuery(sku);
          setLogFilter("all");
          setSummaryExpanded(false);
        }}
      />

      <section
        aria-label="Appliance shift summary"
        className="overflow-x-auto glass-card shadow-lg shadow-black/20"
      >
        <button
          type="button"
          onClick={() => setSummaryExpanded((v) => !v)}
          aria-expanded={summaryExpanded}
          className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tabular-nums text-slate-200 sm:text-sm">
            🔌 {loaded ? shiftScans.length : "—"} Scanned today
          </span>
          <span className="shrink-0 text-xs font-semibold text-emerald-400">
            {summaryExpanded ? "Collapse ▴" : "Expand ▾"}
          </span>
        </button>
        {summaryExpanded ? (
          <div className="space-y-3 border-t border-slate-800 p-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Entries today
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-50">
                {loaded ? shiftScans.length : "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={!loaded || scans.length === 0}
              className="flex h-12 w-full items-center justify-center rounded-xl border border-sky-500/40 bg-sky-950/40 px-3 text-sm font-bold text-sky-200 active:scale-[0.98] disabled:opacity-40"
            >
              Download CSV Inventory
            </button>
          </div>
        ) : null}
      </section>

      {statusMsg ? (
        <p
          role="status"
          className={`rounded-xl border px-3 py-2 text-center text-sm font-medium ${
            statusTone === "error"
              ? "border-red-500/40 bg-red-950/50 text-red-200"
              : "border-emerald-500/30 bg-emerald-950/50 text-emerald-200"
          }`}
        >
          {statusMsg}
        </p>
      ) : null}

      <section className="overflow-x-hidden" aria-label="Appliance scan log">
        <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
          <h2 className="glass-subtitle">
            Scan log
          </h2>
          {logFilter === "all" ? (
            <span className="font-mono text-xs text-slate-500">
              Showing All · {aggregated.length} SKU
              {aggregated.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="font-mono text-xs text-slate-500">
              {aggregated.length} SKU · {filteredScans.length} units
            </span>
          )}
        </div>

        {/* Static filter header — no sticky/absolute overlap with cards */}
        <div className="relative z-10 mb-4 flex w-full flex-col gap-3">
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {APPLIANCE_SCAN_LOG_FILTERS.map((chip) => {
              const active = logFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setLogFilter(chip.id)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${
                    active
                      ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "border-slate-700 bg-slate-900 text-slate-400 active:bg-slate-800"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          <label className="block w-full">
            <span className="sr-only">Quick search</span>
            <input
              type="search"
              value={logQuery}
              onChange={(e) => setLogQuery(e.target.value)}
              placeholder="Filter by SKU or Location..."
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-500"
            />
          </label>
        </div>

        <div className="mt-2 space-y-2">
        {!loaded ? (
          <p className="glass-card border-dashed px-4 py-6 text-center text-sm text-zinc-400">
            Loading scans…
          </p>
        ) : null}

        {loaded && scans.length === 0 ? (
          <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
            No appliance scans yet — scan a barcode to start.
          </p>
        ) : null}

        {loaded && scans.length > 0 && categoryAccordions.length === 0 ? (
          <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
            No scans match this filter.
          </p>
        ) : null}

        <ul className="space-y-2">
          {categoryAccordions.map((accordion) => {
            const categoryOpen = expandedCategories.has(accordion.category);
            const page = categoryPages[accordion.category] ?? 0;
            const pageCount = Math.max(
              1,
              Math.ceil(accordion.items.length / APPLIANCE_SCAN_LOG_PAGE_SIZE)
            );
            const safePage = Math.min(page, pageCount - 1);
            const pageStart = safePage * APPLIANCE_SCAN_LOG_PAGE_SIZE;
            const pageItems = accordion.items.slice(
              pageStart,
              pageStart + APPLIANCE_SCAN_LOG_PAGE_SIZE
            );
            const subSummary = accordion.subGroups
              .map((g) => g.sub_category)
              .slice(0, 3)
              .join(" · ");

            return (
              <li
                key={accordion.category}
                className="glass-card rounded-2xl"
              >
                <button
                  type="button"
                  aria-expanded={categoryOpen}
                  onClick={() => toggleCategory(accordion.category)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-slate-50">
                      {applianceCategoryEmoji(accordion.category)}{" "}
                      {accordion.category}{" "}
                      <span className="font-semibold text-emerald-300">
                        — {accordion.unitCount} unit
                        {accordion.unitCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {accordion.skuCount} SKU
                      {accordion.skuCount === 1 ? "" : "s"}
                      {subSummary ? ` · ${subSummary}` : ""}
                      {accordion.subGroups.length > 3
                        ? ` +${accordion.subGroups.length - 3}`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-emerald-400">
                    {categoryOpen ? "Collapse ▴" : "Expand ▾"}
                  </span>
                </button>

                {categoryOpen ? (
                  <div className="space-y-3 border-t border-slate-800 px-3 pb-3 pt-2">
                    {accordion.subGroups.map((sub) => {
                      const subItems = pageItems.filter(
                        (item) =>
                          (String(item.sub_category ?? "").trim() ||
                            "Unspecified") === sub.sub_category
                      );
                      if (subItems.length === 0) return null;
                      return (
                        <div key={sub.sub_category} className="space-y-2">
                          <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            {sub.sub_category}{" "}
                            <span className="font-mono normal-case text-slate-500">
                              · {sub.unitCount} unit
                              {sub.unitCount === 1 ? "" : "s"}
                            </span>
                          </p>
                          <ul className="space-y-2">
                            {subItems.map((group) => {
                              const expanded = expandedItems.has(
                                group.item_number
                              );
                              return (
                                <li
                                  key={group.item_number}
                                  className="rounded-xl border border-slate-800 bg-slate-950/70"
                                >
                                  <div className="flex gap-2 p-3">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleExpanded(group.item_number)
                                      }
                                      aria-expanded={expanded}
                                      className="min-w-0 flex-1 space-y-1 text-left"
                                    >
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-base font-bold text-slate-50">
                                          Item {group.item_number}{" "}
                                          <span className="text-emerald-300">
                                            | Qty: {group.quantity}
                                          </span>
                                        </span>
                                        {group.hasOffline ? (
                                          <span className="rounded bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-300">
                                            Offline
                                          </span>
                                        ) : null}
                                      </div>
                                      {group.description ? (
                                        <p className="truncate text-xs text-slate-400">
                                          {group.description}
                                        </p>
                                      ) : null}
                                      {group.locations.length > 0 ? (
                                        <p className="font-mono text-xs text-emerald-400/90">
                                          📍 {group.locations.join(" · ")}
                                        </p>
                                      ) : null}
                                      <p className="text-[11px] font-medium text-slate-500">
                                        {expanded
                                          ? "Hide unit details ▴"
                                          : `Show ${group.quantity} unit detail${
                                              group.quantity === 1 ? "" : "s"
                                            } ▾`}
                                      </p>
                                    </button>
                                    <div className="flex shrink-0 flex-col gap-1.5 self-center">
                                      <button
                                        type="button"
                                        aria-label={`Edit item ${group.item_number}`}
                                        onClick={() => setEditingGroup(group)}
                                        className="flex h-11 w-12 items-center justify-center rounded-xl border border-sky-500/40 text-sm font-semibold text-sky-300"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`Delete item ${group.item_number}`}
                                        onClick={() =>
                                          setPendingDeleteGroup(group)
                                        }
                                        className="flex h-11 w-12 items-center justify-center rounded-xl border border-red-500/40 text-sm font-semibold text-red-400"
                                      >
                                        Del
                                      </button>
                                    </div>
                                  </div>

                                  {expanded ? (
                                    <ul className="space-y-2 border-t border-slate-800 px-3 pb-3 pt-2">
                                      {group.scans.map((scan) => (
                                        <li
                                          key={scan.id}
                                          className="flex gap-2 rounded-xl border border-slate-800/80 bg-slate-900/80 p-2.5"
                                        >
                                          <div className="min-w-0 flex-1 space-y-0.5">
                                            {scan.serial_number ? (
                                              <p className="font-mono text-xs text-sky-300">
                                                Serial {scan.serial_number}
                                              </p>
                                            ) : (
                                              <p className="text-xs text-slate-500">
                                                No serial
                                              </p>
                                            )}
                                            {scan.location ? (
                                              <p className="font-mono text-xs text-emerald-400/90">
                                                📍 {scan.location}
                                              </p>
                                            ) : null}
                                            <time
                                              dateTime={scan.scanned_at}
                                              className="block font-mono text-xs text-slate-500"
                                            >
                                              {formatTime(scan.scanned_at)}
                                            </time>
                                            {scan.scanned_by ? (
                                              <p className="text-xs text-slate-500">
                                                Logged by {scan.scanned_by}
                                              </p>
                                            ) : null}
                                          </div>
                                          <button
                                            type="button"
                                            aria-label={`Delete scan at ${formatTime(scan.scanned_at)}`}
                                            onClick={() =>
                                              void handleDeleteScan(scan.id)
                                            }
                                            className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-lg border border-red-500/30 text-xs font-semibold text-red-400"
                                          >
                                            Del
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}

                    {accordion.items.length > APPLIANCE_SCAN_LOG_PAGE_SIZE ? (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          disabled={safePage <= 0}
                          onClick={() =>
                            setCategoryPage(
                              accordion.category,
                              safePage - 1
                            )
                          }
                          className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-200 disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
                          {safePage + 1} / {pageCount}
                        </span>
                        <button
                          type="button"
                          disabled={safePage >= pageCount - 1}
                          onClick={() =>
                            setCategoryPage(
                              accordion.category,
                              safePage + 1
                            )
                          }
                          className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-200 disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        </div>
      </section>
    </div>
  );
}
