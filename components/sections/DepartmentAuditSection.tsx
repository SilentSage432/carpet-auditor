"use client";

/**
 * Generic department unit-count audit workspace.
 * Used for plumbing, electrical, paint, etc. — not flooring (CLF) or appliances.
 * Catalog / audit persistence still owned by lib/catalog + lib/storage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickAddCatalogModal } from "@/components/barcode/QuickAddCatalogModal";
import {
  TaxonomyDrillDown,
  type TaxonomySelection,
} from "@/components/catalog/TaxonomyDrillDown";
import { SimsLocationFinder } from "@/components/catalog/SimsLocationFinder";
import { NumberField, TextField } from "@/components/ui/NumberField";
import { AuditReportModal } from "@/components/hub/AuditReportModal";
import { resolveScan, sanitizeBarcodeScan } from "@/lib/barcode";
import { findCatalogBySkuOrBarcode } from "@/lib/catalog";
import {
  getTaxonomyForHubDepartment,
  type DepartmentTaxonomy,
} from "@/lib/catalog/taxonomies";
import { blurActiveInput } from "@/lib/focus-input";
import { useGlobalBarcodeScanner } from "@/lib/hardware-scanner";
import { toNumber } from "@/lib/number-input";
import { playSuccessChime } from "@/lib/scan-feedback";
import { deleteAudit, fetchAudits, isToday, saveAudit } from "@/lib/storage";
import {
  departmentMeta,
  type CarpetAudit,
  type CatalogItem,
  type LocationType,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";

function loadTaxonomy(
  department: OperationalDepartment
): DepartmentTaxonomy | null {
  return getTaxonomyForHubDepartment(department, { includeOverrides: true });
}

type Props = {
  department: OperationalDepartment;
  catalog: CatalogItem[];
  onCatalogChange: (items: CatalogItem[]) => void;
  auditedBy: string;
  activeSpecialist: StoreSpecialist | null;
  /** Disable wedge scanner while this hub section is hidden. */
  scannerEnabled?: boolean;
};

const cardClass = "glass-card p-4";

function locationLabel(location: LocationType): string {
  return location === "sales_floor" ? "Sales Floor" : "Top Stock";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DepartmentAuditSection({
  department,
  catalog,
  onCatalogChange,
  auditedBy,
  activeSpecialist,
  scannerEnabled = true,
}: Props) {
  const meta = departmentMeta(department);
  const skuInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [simsLocation, setSimsLocation] = useState("");
  const [location, setLocation] = useState<LocationType>("sales_floor");
  const [unitCount, setUnitCount] = useState("1");
  const [audits, setAudits] = useState<CarpetAudit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scanFlash, setScanFlash] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [simsFinderOpen, setSimsFinderOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [taxonomy, setTaxonomy] = useState<DepartmentTaxonomy | null>(() =>
    loadTaxonomy(department)
  );
  const [taxonomySelection, setTaxonomySelection] =
    useState<TaxonomySelection | null>(null);

  const simsSuggestions = useMemo(
    () => [
      `${meta.label} Bay 01`,
      `${meta.label} Aisle End`,
      "Top Stock Overflow",
      "Receiving Holding",
    ],
    [meta.label]
  );

  const dismissKeyboard = useCallback(() => {
    blurActiveInput(skuInputRef);
  }, []);

  useEffect(() => {
    setTaxonomy(loadTaxonomy(department));
    setTaxonomySelection(null);
  }, [department]);

  useEffect(() => {
    function onTaxonomyChange() {
      setTaxonomy(loadTaxonomy(department));
    }
    window.addEventListener("deptsync:taxonomies-changed", onTaxonomyChange);
    window.addEventListener("storage", onTaxonomyChange);
    return () => {
      window.removeEventListener(
        "deptsync:taxonomies-changed",
        onTaxonomyChange
      );
      window.removeEventListener("storage", onTaxonomyChange);
    };
  }, [department]);

  useEffect(() => {
    let cancelled = false;
    void fetchAudits().then((rows) => {
      if (cancelled) return;
      setAudits(rows);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const shiftAudits = useMemo(
    () => audits.filter((a) => isToday(a.created_at)),
    [audits]
  );

  const displayShift = useMemo(() => {
    const needles = [
      meta.label.toLowerCase(),
      meta.shortLabel.toLowerCase(),
      department.replace(/_/g, " "),
      department,
    ];
    let rows = shiftAudits.filter((a) => {
      const hay = `${a.sims_location} ${a.carpet_name}`.toLowerCase();
      return needles.some((n) => n && hay.includes(n));
    });
    if (taxonomySelection?.subcategory) {
      const sub = taxonomySelection.subcategory.toLowerCase();
      const cat = taxonomySelection.category.name.toLowerCase();
      rows = rows.filter((a) => {
        const hay =
          `${a.sub_category} ${a.carpet_name} ${a.sims_location}`.toLowerCase();
        return hay.includes(sub) || hay.includes(cat);
      });
    }
    return rows;
  }, [shiftAudits, meta, department, taxonomySelection]);

  const shiftUnits = displayShift.reduce(
    (sum, a) => sum + (a.box_count ?? 0),
    0
  );
  const visibleShift = showAll ? displayShift : displayShift.slice(0, 5);
  const unitNum = toNumber(unitCount, 0);

  function flashStatus(msg: string) {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2500);
  }

  function applyCatalogItem(item: CatalogItem) {
    setSku(item.sku);
    setName(item.carpet_name);
    setSimsLocation(item.default_sims_location || simsLocation);
    setScanFlash(true);
    window.setTimeout(() => setScanFlash(false), 600);
    blurActiveInput(skuInputRef);
  }

  async function handleSkuLookup(raw: string) {
    const cleaned = sanitizeBarcodeScan(raw);
    if (!cleaned) return;
    setSku(cleaned);
    const local = findCatalogBySkuOrBarcode(catalog, cleaned);
    if (local) {
      applyCatalogItem(local);
      playSuccessChime();
      return;
    }
    const resolution = resolveScan(catalog, cleaned);
    if (resolution.kind === "matched") {
      applyCatalogItem(resolution.item);
      playSuccessChime();
      return;
    }
    if (resolution.kind === "empty") return;
    setQuickAddBarcode(resolution.scanned);
  }

  useGlobalBarcodeScanner(handleSkuLookup, scannerEnabled);

  function handleSkuChange(value: string) {
    setSku(value);
  }

  function handleQuickAdded(item: CatalogItem) {
    const next = [item, ...catalog.filter((c) => c.id !== item.id)];
    onCatalogChange(next);
    setQuickAddBarcode(null);
    setUnitCount("1");
    applyCatalogItem(item);
    flashStatus(`Added ${item.sku} to catalog`);
  }

  function closeQuickAdd() {
    setQuickAddBarcode(null);
    setSku("");
    setName("");
    dismissKeyboard();
  }

  function resetForm() {
    setSku("");
    setName("");
    setSimsLocation("");
    setLocation("sales_floor");
    setUnitCount("1");
    dismissKeyboard();
  }

  function bumpUnits(delta: number) {
    setUnitCount((v) => String(Math.max(0, toNumber(v, 0) + delta)));
  }

  const canLog = sku.trim().length > 0 && unitNum > 0 && !saving;

  async function handleLog() {
    if (!canLog) return;
    setSaving(true);
    try {
      const tag =
        simsLocation.trim() ||
        `${meta.label} Bay`;
      const sub =
        taxonomySelection?.subcategory?.trim() ||
        taxonomySelection?.category.name ||
        "";
      const { record, offline } = await saveAudit({
        sku: sku.trim(),
        carpet_name: name.trim() || `${meta.label} Item`,
        category: "Accessories",
        sub_category: sub,
        sims_location: tag,
        location_type: location,
        measurement_inches: 0,
        measurement_fraction: 0,
        rounds: 0,
        calculated_clf: 0,
        box_count: unitNum,
        calculated_sqft: null,
        system_clf: null,
        variance_clf: null,
        audited_by: auditedBy,
      });
      setAudits((prev) => [record, ...prev.filter((a) => a.id !== record.id)]);
      playSuccessChime();
      resetForm();
      flashStatus(
        offline
          ? `Saved ${unitNum} offline — form reset`
          : `Logged ${unitNum} unit${unitNum === 1 ? "" : "s"} — form reset`
      );
    } catch {
      flashStatus("Could not save department audit");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteAudit(id);
    setAudits((prev) => prev.filter((a) => a.id !== id));
    flashStatus("Entry removed");
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <QuickAddCatalogModal
        open={quickAddBarcode != null}
        scannedBarcode={quickAddBarcode ?? ""}
        onClose={closeQuickAdd}
        onSaved={handleQuickAdded}
      />
      <SimsLocationFinder
        open={simsFinderOpen}
        onClose={() => {
          setSimsFinderOpen(false);
          dismissKeyboard();
        }}
        catalog={catalog}
        audits={audits}
      />
      <AuditReportModal
        open={reportOpen}
        onClose={() => {
          setReportOpen(false);
          dismissKeyboard();
        }}
        kind="department"
        departmentLabel={meta.label}
        audits={displayShift.length > 0 ? displayShift : shiftAudits}
        specialist={activeSpecialist}
        auditedBy={auditedBy}
      />

      <section
        aria-label={`${meta.label} shift summary`}
        className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/90 shadow-lg shadow-black/20"
      >
        <button
          type="button"
          onClick={() => setSummaryExpanded((v) => !v)}
          aria-expanded={summaryExpanded}
          className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tabular-nums text-slate-200 sm:text-sm">
            {meta.icon} {loaded ? displayShift.length : "—"} Logged
            <span className="text-slate-500"> | </span>
            {loaded ? shiftUnits : "—"} Units today
          </span>
          <span className="shrink-0 text-xs font-semibold text-emerald-400">
            {summaryExpanded ? "Collapse ▴" : "Expand ▾"}
          </span>
        </button>
        {summaryExpanded ? (
          <div className="space-y-3 border-t border-slate-800 p-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Entries
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-50">
                  {loaded ? displayShift.length : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-400/80">
                  Units today
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
                  {loaded ? shiftUnits : "—"}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-400">{meta.description}</p>
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

      {taxonomy ? (
        <div className="space-y-2">
          <TaxonomyDrillDown
            taxonomy={taxonomy}
            selected={taxonomySelection}
            onSelect={setTaxonomySelection}
          />
          {taxonomySelection ? (
            <p className="px-1 text-xs text-zinc-400">
              Folder filter:{" "}
              <span className="font-semibold text-emerald-300">
                {taxonomySelection.category.name}
                {taxonomySelection.subcategory
                  ? ` / ${taxonomySelection.subcategory}`
                  : ""}
              </span>
              <button
                type="button"
                onClick={() => setTaxonomySelection(null)}
                className="ml-2 font-semibold text-zinc-500 underline"
              >
                Clear
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {statusMsg ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-center text-sm font-medium text-emerald-200"
        >
          {statusMsg}
        </p>
      ) : null}

      <form
        className={`${cardClass} space-y-4`}
        onSubmit={(e) => {
          e.preventDefault();
          void handleLog();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="glass-subtitle">
            {meta.label} Unit Audit
          </h2>
          <span className="glass-pill-cyan">
            Mode · Units
          </span>
        </div>

        {taxonomySelection?.subcategory ? (
          <p className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-100">
            Logging under{" "}
            <span className="font-semibold">
              {taxonomySelection.category.name} /{" "}
              {taxonomySelection.subcategory}
            </span>
          </p>
        ) : null}

        <NumberField
          label="Item # / SKU / Barcode"
          mode="digits"
          value={sku}
          onChange={handleSkuChange}
          onScanCommit={handleSkuLookup}
          flash={scanFlash}
          placeholder="Scan barcode or tap to type item #"
          inputRef={skuInputRef}
        />

        <TextField
          label="Item Name"
          value={name}
          onChange={setName}
          placeholder={`e.g. ${meta.label} SKU name`}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-200">
              SIMS Location
            </span>
            <button
              type="button"
              onClick={() => setSimsFinderOpen(true)}
              className="text-xs font-semibold text-emerald-400"
            >
              📍 SIMS Stock
            </button>
          </div>
          <TextField
            value={simsLocation}
            onChange={setSimsLocation}
            placeholder={`${meta.label} Bay 01`}
          />
          <div className="flex flex-wrap gap-1.5">
            {simsSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSimsLocation(tag)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-semibold text-slate-300"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-200">
            Location Type
          </legend>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
            {(
              [
                ["sales_floor", "Sales Floor"],
                ["top_stock", "Top Stock"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLocation(value)}
                className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold ${
                  location === value
                    ? "bg-emerald-500 text-slate-950"
                    : "text-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-200">
            Unit Count
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => bumpUnits(-1)}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 text-xl font-bold text-slate-200"
            >
              −
            </button>
            <NumberField
              mode="integer"
              value={unitCount}
              onChange={setUnitCount}
              center
              inputRef={qtyInputRef}
              aria-label="Unit count"
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => bumpUnits(1)}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 text-xl font-bold text-slate-200"
            >
              +
            </button>
          </div>
        </div>
      </form>

      <div className="fixed bottom-16 left-0 right-0 z-20 mx-auto max-w-md px-4 pb-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            disabled={!canLog}
            onClick={() => void handleLog()}
            className="btn-primary-glow flex min-h-14 items-center justify-center rounded-2xl text-sm disabled:opacity-40"
          >
            {saving ? "Saving…" : `Log ${meta.shortLabel} & Reset`}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="flex min-h-14 items-center justify-center rounded-2xl border border-slate-600 bg-slate-900 px-4 text-sm font-semibold text-slate-200"
          >
            Reset
          </button>
        </div>
      </div>

      <section className={`${cardClass} space-y-2 pb-24`}>
        <h3 className="glass-subtitle">
          Today · {meta.label}
        </h3>
        {displayShift.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No {meta.label.toLowerCase()} units logged yet this shift.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleShift.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-2 rounded-xl bg-slate-950/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-100">
                      {a.sku} · {a.carpet_name || meta.label}
                    </p>
                    <p className="text-xs text-slate-400">
                      {a.box_count ?? 0} units
                      {a.sub_category ? ` · ${a.sub_category}` : ""} ·{" "}
                      {locationLabel(a.location_type)} ·{" "}
                      {a.sims_location || "—"} · {formatTime(a.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(a.id)}
                    className="shrink-0 text-xs font-semibold text-red-300"
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
            {displayShift.length > 5 ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-sm font-semibold text-slate-200"
              >
                {showAll
                  ? "Show Fewer Entries"
                  : `Show All Logged Entries (${displayShift.length})`}
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
