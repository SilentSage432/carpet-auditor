"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickAddCatalogModal } from "@/components/barcode/QuickAddCatalogModal";
import { NumberField, TextField } from "@/components/ui/NumberField";
import { PinKeypadModal } from "@/components/hub/PinKeypadModal";
import {
  resolveScan,
  sanitizeBarcodeScan,
} from "@/lib/barcode";
import {
  findSupervisor,
  isSupervisor,
  verifyPin,
} from "@/lib/specialists";
import {
  CLF_FACTOR,
  FRACTION_OPTIONS,
  calculateCartonSqFt,
  calculateClf,
  formatCartonBreakdown,
  formatClf,
  formatDecimalInches,
  formatFormulaBreakdown,
  formatMeasurementDisplay,
  formatSqFt,
  toTotalInches,
} from "@/lib/calc";
import {
  findCatalogBySkuOrBarcode,
  fetchCatalog,
  saveCatalogItem,
} from "@/lib/catalog";
import { toNumber } from "@/lib/number-input";
import { playSuccessChime } from "@/lib/scan-feedback";
import { getStoreNumber } from "@/lib/store";
import {
  auditsToCsv,
  clearAuditDraft,
  deleteAudit,
  fetchAudits,
  isToday,
  loadAuditDraft,
  saveAudit,
  saveAuditDraft,
} from "@/lib/storage";
import {
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  auditModeForCategory,
  normalizeCategory,
  type CarpetAudit,
  type CatalogItem,
  type FlooringCategory,
  type LocationType,
  type StoreSpecialist,
} from "@/lib/types";
import {
  calculateVariance,
  classifyVariance,
  formatVariance,
  isDiscrepancy,
  varianceBadgeClass,
  varianceLabel,
} from "@/lib/variance";

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

function BarcodeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 5v14M7 5v14M10 5v14M12 5v14M16 5v14M19 5v14M21 5v14" />
    </svg>
  );
}

const cardClass =
  "rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg shadow-black/20";

type Props = {
  catalog: CatalogItem[];
  onCatalogChange: (items: CatalogItem[]) => void;
  auditedBy: string;
  specialists: StoreSpecialist[];
  activeSpecialist: StoreSpecialist | null;
};

export function CycleAuditSection({
  catalog,
  onCatalogChange,
  auditedBy,
  specialists,
  activeSpecialist,
}: Props) {
  const measureInputRef = useRef<HTMLInputElement>(null);
  const boxCountInputRef = useRef<HTMLInputElement>(null);

  const [sku, setSku] = useState("");
  const [carpetName, setCarpetName] = useState("");
  const [category, setCategory] = useState<FlooringCategory>("Carpet");
  const [simsLocation, setSimsLocation] = useState("");
  const [rollWidth, setRollWidth] = useState<number | null>(null);
  const [sqftPerBox, setSqftPerBox] = useState("");
  const [location, setLocation] = useState<LocationType>("sales_floor");
  const [wholeInches, setWholeInches] = useState("");
  const [fraction, setFraction] = useState(0);
  const [rounds, setRounds] = useState("");
  const [boxCount, setBoxCount] = useState("");
  const [systemClf, setSystemClf] = useState("");
  const [audits, setAudits] = useState<CarpetAudit[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scanFlash, setScanFlash] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [filterSpecialist, setFilterSpecialist] = useState("all");
  const [filterLocation, setFilterLocation] = useState<"all" | LocationType>("all");
  const [filterDiscrepancies, setFilterDiscrepancies] = useState(false);
  const [discrepancyUnlocked, setDiscrepancyUnlocked] = useState(false);
  const [pinForDiscrepancy, setPinForDiscrepancy] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const auditMode = auditModeForCategory(category);
  const canViewDiscrepancies =
    isSupervisor(activeSpecialist) || discrepancyUnlocked;

  const wholeNum = toNumber(wholeInches, 0);
  const roundsNum = toNumber(rounds, 0);
  const boxCountNum = toNumber(boxCount, 0);
  const sqftPerBoxNum = toNumber(sqftPerBox, 0);
  const systemClfNum =
    systemClf.trim() === "" ? null : toNumber(systemClf, Number.NaN);
  const totalInchesValue = useMemo(
    () => toTotalInches(wholeNum, fraction),
    [wholeNum, fraction]
  );
  const clf = useMemo(
    () => calculateClf(totalInchesValue, roundsNum),
    [totalInchesValue, roundsNum]
  );
  const cartonSqFt = useMemo(
    () => calculateCartonSqFt(boxCountNum, sqftPerBoxNum),
    [boxCountNum, sqftPerBoxNum]
  );
  const liveVariance = useMemo(
    () =>
      calculateVariance(
        auditMode === "roll" ? clf : cartonSqFt,
        systemClfNum != null && Number.isFinite(systemClfNum) ? systemClfNum : null
      ),
    [auditMode, clf, cartonSqFt, systemClfNum]
  );
  const liveVarianceKind = classifyVariance(liveVariance);

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

  const catalogMatch = useMemo(
    () => findCatalogBySkuOrBarcode(catalog, sku),
    [catalog, sku]
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

  useEffect(() => {
    if (draftRestored) return;
    const draft = loadAuditDraft();
    if (!draft) {
      setDraftRestored(true);
      return;
    }
    setSku(draft.sku);
    setCarpetName(draft.carpetName);
    setCategory(normalizeCategory(draft.category));
    setSimsLocation(draft.simsLocation);
    setLocation(draft.location);
    setWholeInches(draft.wholeInches);
    setFraction(draft.fraction);
    setRounds(draft.rounds);
    setBoxCount(draft.boxCount);
    setSqftPerBox(draft.sqftPerBox);
    setSystemClf(draft.systemClf);
    setRollWidth(draft.rollWidth);
    setDraftRestored(true);
  }, [draftRestored]);

  useEffect(() => {
    if (!draftRestored) return;
    const hasContent =
      sku ||
      carpetName ||
      wholeInches ||
      rounds ||
      boxCount ||
      simsLocation;
    if (!hasContent) {
      clearAuditDraft();
      return;
    }
    saveAuditDraft({
      store_number: getStoreNumber(),
      sku,
      carpetName,
      category,
      simsLocation,
      location,
      wholeInches,
      fraction,
      rounds,
      boxCount,
      sqftPerBox,
      systemClf,
      rollWidth,
    });
  }, [
    draftRestored,
    sku,
    carpetName,
    category,
    simsLocation,
    location,
    wholeInches,
    fraction,
    rounds,
    boxCount,
    sqftPerBox,
    systemClf,
    rollWidth,
  ]);

  const focusMeasureInput = useCallback((mode: "roll" | "carton") => {
    window.setTimeout(() => {
      const el =
        mode === "roll" ? measureInputRef.current : boxCountInputRef.current;
      el?.focus();
      el?.select();
    }, 50);
  }, []);

  const applyCatalogItem = useCallback(
    (item: CatalogItem) => {
      const nextCategory = normalizeCategory(item.category);
      const mode = auditModeForCategory(nextCategory);
      setSku(item.sku);
      setCarpetName(item.carpet_name);
      setCategory(nextCategory);
      setSimsLocation(item.default_sims_location || "");
      setRollWidth(item.roll_width_ft);
      setSqftPerBox(
        item.sqft_per_box != null ? String(item.sqft_per_box) : ""
      );
      setScanFlash(true);
      playSuccessChime();
      window.setTimeout(() => setScanFlash(false), 900);
      focusMeasureInput(mode);
    },
    [focusMeasureInput]
  );

  const flashStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2800);
  }, []);

  function handleSkuChange(raw: string) {
    const next = sanitizeBarcodeScan(raw);
    setSku(next);
    const hit = findCatalogBySkuOrBarcode(catalog, next);
    if (hit) {
      setCarpetName(hit.carpet_name);
      setCategory(normalizeCategory(hit.category));
      setSimsLocation(hit.default_sims_location || "");
      setRollWidth(hit.roll_width_ft);
      setSqftPerBox(hit.sqft_per_box != null ? String(hit.sqft_per_box) : "");
    } else {
      setCarpetName("");
      setRollWidth(null);
    }
  }

  function handleScanCommit(sanitized: string) {
    const resolution = resolveScan(catalog, sanitized);
    if (resolution.kind === "empty") return;

    if (resolution.kind === "matched") {
      applyCatalogItem(resolution.item);
      flashStatus(`Matched ${resolution.item.sku}`);
      return;
    }

    if (resolution.kind === "unlinked_barcode") {
      setSku(resolution.scanned);
      setQuickAddBarcode(resolution.scanned);
      return;
    }

    setSku(resolution.scanned);
  }

  function handleQuickAdded(item: CatalogItem) {
    const next = [
      item,
      ...catalog.filter((c) => c.id !== item.id && c.sku !== item.sku),
    ].sort((a, b) => a.sku.localeCompare(b.sku));
    onCatalogChange(next);
    applyCatalogItem(item);
    setQuickAddBarcode(null);
    flashStatus(`Added ${item.sku} to SIMS catalog`);
  }

  function resetForm() {
    setSku("");
    setCarpetName("");
    setCategory("Carpet");
    setSimsLocation("");
    setRollWidth(null);
    setSqftPerBox("");
    setLocation("sales_floor");
    setWholeInches("");
    setFraction(0);
    setRounds("");
    setBoxCount("");
    setSystemClf("");
    clearAuditDraft();
  }

  const canLog =
    sku.trim().length > 0 &&
    !saving &&
    (auditMode === "roll" ? roundsNum > 0 : boxCountNum > 0);

  async function handleLog() {
    if (!canLog) return;
    setSaving(true);
    try {
      const systemValue =
        systemClfNum != null && Number.isFinite(systemClfNum) ? systemClfNum : null;
      const physicalQty = auditMode === "roll" ? clf : cartonSqFt;
      const variance = calculateVariance(physicalQty, systemValue);
      const { record, offline } = await saveAudit({
        sku: sku.trim(),
        carpet_name: carpetName.trim(),
        category,
        sims_location: simsLocation.trim(),
        location_type: location,
        measurement_inches: auditMode === "roll" ? wholeNum : 0,
        measurement_fraction: auditMode === "roll" ? fraction : 0,
        rounds: auditMode === "roll" ? roundsNum : 0,
        calculated_clf: auditMode === "roll" ? clf : 0,
        box_count: auditMode === "carton" ? boxCountNum : null,
        calculated_sqft: auditMode === "carton" ? cartonSqFt : null,
        system_clf: systemValue,
        variance_clf: variance,
        audited_by: auditedBy,
      });
      setAudits((prev) => [record, ...prev.filter((a) => a.id !== record.id)]);
      resetForm();
      flashStatus(
        offline
          ? "Saved offline — form reset"
          : auditMode === "roll"
            ? "Roll logged — form reset"
            : "Units logged — form reset"
      );
    } catch {
      flashStatus("Could not save audit");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveToCatalog() {
    if (!sku.trim() || !carpetName.trim()) return;
    const { record, offline } = await saveCatalogItem({
      sku: sku.trim(),
      carpet_name: carpetName.trim(),
      vendor: "",
      category,
      default_sims_location: simsLocation.trim(),
      roll_width_ft: rollWidth ?? 12,
      sqft_per_box:
        auditMode === "carton" && sqftPerBoxNum > 0 ? sqftPerBoxNum : null,
      upc_barcode: null,
    });
    const next = await fetchCatalog();
    onCatalogChange(
      next.length ? next : [record, ...catalog.filter((c) => c.sku !== record.sku)]
    );
    setRollWidth(record.roll_width_ft);
    flashStatus(offline ? "Catalog saved offline" : "Saved to SIMS catalog");
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
      `Total entries: ${totalRolls} (Floor ${floorCount} / Top Stock ${topStockCount})`,
      `Shift CLF: ${formatClf(shiftClf)}`,
      `Shift SqFt: ${formatSqFt(shiftSqFt)}`,
      `Cumulative CLF: ${formatClf(cumulativeClf)}`,
      "",
      ...shiftAudits.map((a) => {
        const qty =
          a.box_count != null && a.box_count > 0
            ? `${a.box_count} units / ${formatSqFt(a.calculated_sqft ?? 0)} sq ft`
            : `${formatMeasurementDisplay(a.measurement_inches, a.measurement_fraction)} × ${a.rounds} = ${formatClf(a.calculated_clf)} CLF`;
        return `${formatTime(a.created_at)} | SKU ${a.sku} | ${a.carpet_name || "—"} | ${a.category} | ${a.sims_location || "—"} | ${locationLabel(a.location_type)} | ${qty}`;
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

  function bumpRounds(delta: number) {
    setRounds((r) => String(Math.max(0, toNumber(r, 0) + delta)));
  }

  function bumpBoxes(delta: number) {
    setBoxCount((r) => String(Math.max(0, toNumber(r, 0) + delta)));
  }

  return (
    <div className="space-y-4">
      <QuickAddCatalogModal
        open={quickAddBarcode != null}
        scannedBarcode={quickAddBarcode ?? ""}
        onClose={() => setQuickAddBarcode(null)}
        onSaved={handleQuickAdded}
      />
      <PinKeypadModal
        key={pinForDiscrepancy ? "discrepancy-pin" : "discrepancy-closed"}
        open={pinForDiscrepancy}
        title="Supervisor PIN required"
        subtitle="Unlock Discrepancies Only filter"
        verify={(pin) => {
          const supervisor = findSupervisor(specialists);
          return supervisor ? verifyPin(supervisor, pin) : false;
        }}
        onClose={() => setPinForDiscrepancy(false)}
        onSuccess={() => {
          setDiscrepancyUnlocked(true);
          setFilterDiscrepancies(true);
          setPinForDiscrepancy(false);
        }}
      />

      <section aria-label="Shift summary" className={cardClass}>
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
              Floor
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
              {loaded ? floorCount : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-amber-400/80">
              Top stock
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-300">
              {loaded ? topStockCount : "—"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Cumulative CLF:{" "}
          <span className="font-mono text-lg font-semibold text-emerald-400">
            {loaded ? formatClf(cumulativeClf) : "—"}
          </span>
          <span className="ml-2 font-mono text-xs text-slate-500">
            (shift {loaded ? formatClf(shiftClf) : "—"}
            {shiftSqFt > 0 ? ` · ${formatSqFt(shiftSqFt)} sq ft` : ""})
          </span>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void handleCopySummary()}
            className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-slate-100"
          >
            {copied ? "Copied ✓" : "Copy Shift Summary"}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-slate-100"
          >
            Export CSV
          </button>
        </div>
      </section>

      {statusMsg && (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-center text-sm font-medium text-emerald-200"
        >
          {statusMsg}
        </p>
      )}

      <form
        className={`${cardClass} space-y-4 overflow-hidden`}
        onSubmit={(e) => {
          e.preventDefault();
          void handleLog();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Scan-to-Catalog Audit
          </h2>
          <span className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
            {auditMode === "roll" ? "Mode A · Rolls" : "Mode B · Cartons"}
          </span>
        </div>

        <NumberField
          label="Item # / SKU / Barcode"
          mode="digits"
          value={sku}
          onChange={handleSkuChange}
          onScanCommit={handleScanCommit}
          flash={scanFlash}
          placeholder="Scan barcode or type item #"
          leftIcon={<BarcodeIcon className="h-5 w-5" />}
        />

        <div className="space-y-1.5">
          <TextField
            label="Product Name / Style"
            value={carpetName}
            onChange={setCarpetName}
            placeholder="e.g. Stainmaster Hearthstone 12ft"
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">Category</span>
            <select
              value={category}
              onChange={(e) => {
                const next = normalizeCategory(e.target.value);
                setCategory(next);
                if (auditModeForCategory(next) === "roll") {
                  setRollWidth((w) => w ?? 12);
                }
              }}
              className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
            >
              {FLOORING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="SIMS Location Tag"
            value={simsLocation}
            onChange={setSimsLocation}
            placeholder="e.g. Aisle 14 - Bay 012"
          />
          {auditMode === "roll" ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-200">
                Roll Width
              </legend>
              <div
                role="group"
                className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
              >
                {ROLL_WIDTH_OPTIONS_FT.map((ft) => {
                  const active = (rollWidth ?? 12) === ft;
                  return (
                    <button
                      key={ft}
                      type="button"
                      onClick={() => setRollWidth(ft)}
                      className={`flex min-h-12 items-center justify-center rounded-lg font-mono text-sm font-semibold transition ${
                        active
                          ? "bg-emerald-500 text-slate-950 shadow"
                          : "text-slate-400 hover:text-slate-100"
                      }`}
                    >
                      {ft} ft
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}          {catalogMatch ? (
            <p className="text-xs text-emerald-400">
              Matched from SIMS catalog
              {catalogMatch.upc_barcode ? " · barcode linked" : ""}
              {catalogMatch.default_sims_location
                ? ` · ${catalogMatch.default_sims_location}`
                : ""}
            </p>
          ) : sku.trim() && carpetName.trim() ? (
            <button
              type="button"
              onClick={() => void handleSaveToCatalog()}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-sm font-semibold text-emerald-300"
            >
              + Save to SIMS Catalog
            </button>
          ) : null}
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-200">
            Location Type
          </legend>
          <div
            role="group"
            className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
          >
            {(
              [
                ["sales_floor", "Sales Floor"],
                ["top_stock", "Top Stock"],
              ] as const
            ).map(([value, label]) => {
              const active = location === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocation(value)}
                  className={`flex min-h-12 items-center justify-center rounded-lg text-sm font-semibold transition ${
                    active
                      ? "bg-emerald-500 text-slate-950 shadow"
                      : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {auditMode === "roll" ? (
          <>
            <fieldset className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <legend className="text-sm font-medium text-slate-200">
                  Measurement (inches)
                </legend>
                <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/50 px-2.5 py-1 font-mono text-sm font-bold tabular-nums text-emerald-400">
                  {formatDecimalInches(totalInchesValue)}
                </span>
              </div>
              <NumberField
                label="Whole inches"
                mode="integer"
                value={wholeInches}
                onChange={setWholeInches}
                placeholder="0"
                inputRef={measureInputRef}
              />
              <div className="grid grid-cols-4 gap-2">
                {FRACTION_OPTIONS.map((opt) => {
                  const active = fraction === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setFraction(opt.value)}
                      className={`flex min-h-12 items-center justify-center rounded-xl font-mono text-sm font-semibold transition ${
                        active
                          ? "bg-emerald-500 text-slate-950"
                          : "border border-slate-800 bg-slate-950 text-slate-200 active:bg-slate-800"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-200">Rounds</legend>
              <div className="flex w-full items-center gap-2.5">
                <button
                  type="button"
                  aria-label="Decrease rounds"
                  onClick={() => bumpRounds(-1)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-xl font-bold text-slate-100 active:scale-95"
                >
                  −
                </button>
                <NumberField
                  mode="integer"
                  value={rounds}
                  onChange={setRounds}
                  placeholder="0"
                  center
                  className="min-w-0 flex-1"
                  aria-label="Rounds"
                />
                <button
                  type="button"
                  aria-label="Increase rounds"
                  onClick={() => bumpRounds(1)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-xl font-bold text-slate-100 active:scale-95"
                >
                  +
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[5, 10, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => bumpRounds(n)}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 font-mono text-sm font-semibold text-emerald-400 active:bg-slate-800"
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </fieldset>

            <div
              aria-live="polite"
              className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/60 to-slate-950 p-4 text-center shadow-[0_0_24px_-8px_rgba(16,185,129,0.45)]"
            >
              <p className="break-words font-mono text-xs leading-relaxed text-emerald-300/80">
                {formatFormulaBreakdown(totalInchesValue, roundsNum, clf)}
              </p>
              <p className="mt-1 font-mono text-3xl font-bold tabular-nums tracking-tight text-emerald-400">
                {formatClf(clf)}{" "}
                <span className="text-base font-semibold text-emerald-300/90">CLF</span>
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                × {CLF_FACTOR} factor
              </p>
            </div>
          </>
        ) : (
          <>
            <NumberField
              label="Sq Ft Coverage per Box"
              mode="decimal"
              value={sqftPerBox}
              onChange={setSqftPerBox}
              placeholder="e.g. 23.64"
            />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-200">
                Carton / Unit Count
              </legend>
              <div className="flex w-full items-center gap-2.5">
                <button
                  type="button"
                  aria-label="Decrease count"
                  onClick={() => bumpBoxes(-1)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-xl font-bold text-slate-100 active:scale-95"
                >
                  −
                </button>
                <NumberField
                  mode="integer"
                  value={boxCount}
                  onChange={setBoxCount}
                  placeholder="0"
                  center
                  className="min-w-0 flex-1"
                  aria-label="Box count"
                  inputRef={boxCountInputRef}
                />
                <button
                  type="button"
                  aria-label="Increase count"
                  onClick={() => bumpBoxes(1)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-xl font-bold text-slate-100 active:scale-95"
                >
                  +
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[5, 10, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => bumpBoxes(n)}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 font-mono text-sm font-semibold text-emerald-400 active:bg-slate-800"
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </fieldset>

            <div
              aria-live="polite"
              className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/60 to-slate-950 p-4 text-center shadow-[0_0_24px_-8px_rgba(16,185,129,0.45)]"
            >
              <p className="break-words font-mono text-xs leading-relaxed text-emerald-300/80">
                {formatCartonBreakdown(boxCountNum, sqftPerBoxNum, cartonSqFt)}
              </p>
              <p className="mt-1 font-mono text-3xl font-bold tabular-nums tracking-tight text-emerald-400">
                {formatSqFt(cartonSqFt)}{" "}
                <span className="text-base font-semibold text-emerald-300/90">
                  sq ft
                </span>
              </p>
            </div>
          </>
        )}

        <NumberField
          label={
            auditMode === "roll"
              ? "System On-Hand (CLF) — optional"
              : "System On-Hand (Sq Ft) — optional"
          }
          mode="decimal"
          value={systemClf}
          onChange={setSystemClf}
          placeholder="e.g. 48.00"
        />
        {liveVariance != null && (
          <div
            className={`rounded-xl border px-3 py-3 text-center text-sm font-semibold ${varianceBadgeClass(liveVarianceKind)}`}
          >
            {liveVarianceKind === "match" && "🟢 "}
            {liveVarianceKind === "shortage" && "🔴 "}
            {liveVarianceKind === "overage" && "🟡 "}
            {varianceLabel(liveVarianceKind)}: {formatVariance(liveVariance)}
            <span className="mt-1 block text-xs font-normal opacity-80">
              Physical{" "}
              {auditMode === "roll"
                ? formatClf(clf)
                : formatSqFt(cartonSqFt)}{" "}
              − System{" "}
              {auditMode === "roll"
                ? formatClf(systemClfNum ?? 0)
                : formatSqFt(systemClfNum ?? 0)}
            </span>
          </div>
        )}

        {auditedBy ? (
          <p className="text-center text-xs text-slate-500">
            Logging as <span className="font-semibold text-emerald-400">{auditedBy}</span>
          </p>
        ) : (
          <p className="text-center text-xs text-amber-400">
            Select an active specialist in the header before logging.
          </p>
        )}

        <button
          type="submit"
          disabled={!canLog}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950 transition enabled:active:scale-[0.98] enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving
            ? "Logging…"
            : auditMode === "roll"
              ? "Log Roll & Reset"
              : "Log Units & Reset"}
        </button>
      </form>

      <section className="space-y-3" aria-label="Shift audit log">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Shift log
          </h2>
          <span className="font-mono text-xs text-slate-500">
            {filteredAudits.length}/{audits.length}
          </span>
        </div>

        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/90 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Supervisor filters
          </p>
          <label className="block space-y-1">
            <span className="text-xs text-slate-400">Specialist</span>
            <select
              value={filterSpecialist}
              onChange={(e) => setFilterSpecialist(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
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
              <option value="sales_floor">Sales Floor</option>
              <option value="top_stock">Top Stock</option>
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3">
            <input
              type="checkbox"
              checked={filterDiscrepancies && canViewDiscrepancies}
              onChange={(e) => {
                if (!canViewDiscrepancies) {
                  setPinForDiscrepancy(true);
                  return;
                }
                setFilterDiscrepancies(e.target.checked);
              }}
              className="h-5 w-5 accent-emerald-500"
            />
            <span className="min-w-0 text-sm text-slate-200">
              Discrepancies only
              {!canViewDiscrepancies ? (
                <span className="mt-0.5 block text-xs text-amber-400">
                  🛡️ Supervisor PIN required
                </span>
              ) : null}
            </span>
          </label>
        </div>

        {!loaded && (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
            Loading audits…
          </p>
        )}

        {loaded && filteredAudits.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
            {audits.length === 0
              ? "No audits logged yet — scan a barcode to start."
              : "No entries match the current filters."}
          </p>
        )}

        <ul className="space-y-2">
          {visibleAudits.map((audit) => {
            const kind = classifyVariance(audit.variance_clf);
            const isCarton =
              audit.box_count != null && audit.box_count > 0;
            return (
              <li
                key={audit.id}
                className="flex gap-2 rounded-2xl border border-slate-800 bg-slate-900/90 p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-semibold text-slate-50">
                      SKU {audit.sku}
                    </span>
                    <span className="rounded bg-slate-700/50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-300">
                      {audit.category}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        audit.location_type === "sales_floor"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {locationLabel(audit.location_type)}
                    </span>
                    {audit.offline && (
                      <span className="rounded bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-300">
                        Offline
                      </span>
                    )}
                  </div>
                  {audit.carpet_name ? (
                    <p className="truncate text-sm text-slate-300">
                      {audit.carpet_name}
                    </p>
                  ) : null}
                  {audit.sims_location ? (
                    <p className="font-mono text-xs text-emerald-400/90">
                      📍 {audit.sims_location}
                    </p>
                  ) : null}
                  <p className="text-sm text-slate-400">
                    {isCarton
                      ? `${audit.box_count} units`
                      : `${formatMeasurementDisplay(
                          audit.measurement_inches,
                          audit.measurement_fraction
                        )} × ${audit.rounds} rounds`}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-lg font-bold tabular-nums text-emerald-400">
                      {isCarton
                        ? `${formatSqFt(audit.calculated_sqft ?? 0)} sq ft`
                        : `${formatClf(audit.calculated_clf)} CLF`}
                    </span>
                    <time
                      dateTime={audit.created_at}
                      className="font-mono text-xs text-slate-500"
                    >
                      {formatTime(audit.created_at)}
                    </time>
                  </div>
                  {audit.audited_by ? (
                    <p className="text-xs text-slate-500">
                      Logged by {audit.audited_by}
                    </p>
                  ) : null}
                  {audit.variance_clf != null && (
                    <span
                      className={`inline-flex rounded-lg border px-2 py-1 text-xs font-semibold ${varianceBadgeClass(kind)}`}
                    >
                      {kind === "match" && "🟢 "}
                      {kind === "shortage" && "🔴 "}
                      {kind === "overage" && "🟡 "}
                      {formatVariance(audit.variance_clf)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Delete SKU ${audit.sku}`}
                  onClick={() => void handleDelete(audit.id)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-xl border border-red-500/40 text-sm font-semibold text-red-400"
                >
                  Del
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
