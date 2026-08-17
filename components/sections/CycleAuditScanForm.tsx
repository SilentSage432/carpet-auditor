"use client";

/**
 * Cycle Audit scan/input island — owns form state + drafts.
 * Historical log stays in CycleAuditSection so keystrokes do not reconcile the table.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickAddCatalogModal } from "@/components/barcode/QuickAddCatalogModal";
import { ScanActionDock } from "@/components/hub/ScanActionDock";
import { LocationStatusIcon, VarianceStatusIcon } from "@/components/hub/StatusPills";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  resolveScan,
  sanitizeBarcodeScan,
} from "@/lib/barcode";
import {
  calculateCartonSqFt,
  calculateClf,
  calculateRollSqFt,
  calculateSquareYards,
  formatClf,
  formatSqFt,
  toTotalInches,
} from "@/lib/calc";
import {
  findCatalogBySkuOrBarcode,
  fetchCatalog,
  saveCatalogItem,
} from "@/lib/catalog";
import { blurActiveInput } from "@/lib/focus-input";
import { useGlobalBarcodeScanner } from "@/lib/hardware-scanner";
import { toNumber } from "@/lib/number-input";
import { playSuccessChime } from "@/lib/scan-feedback";
import { useFlushOnLeave } from "@/lib/use-flush-on-leave";
import { getStoreNumber } from "@/lib/store";
import {
  clearAuditDraft,
  flushAuditDraftSave,
  loadAuditDraft,
  saveAudit,
  scheduleAuditDraftSave,
} from "@/lib/storage";
import { AuditLocationModeToggle } from "@/components/store-ops/AuditLocationModeToggle";
import { RollMeasurementPad } from "@/components/inventory/RollMeasurementPad";
import {
  hubLocationFromStoreType,
  storeTypeFromHubLocation,
  formatAuditLocationBadge,
} from "@/lib/store-ops/audit-location-mode";
import {
  DEFAULT_ROLL_WIDTH_FT,
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  auditModeForCategory,
  normalizeCategory,
  normalizeRollWidthFt,
  type CatalogCategory,
  type CarpetAudit,
  type CatalogItem,
  type LocationType,
} from "@/lib/types";
import {
  calculateVariance,
  classifyVariance,
  formatVariance,
  varianceBadgeClass,
  varianceLabel,
} from "@/lib/variance";

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

const cardClass = "glass-card p-4";

type Props = {
  catalog: CatalogItem[];
  onCatalogChange: (items: CatalogItem[]) => void;
  auditedBy: string;
  scannerEnabled?: boolean;
  onLogged: (record: CarpetAudit, offline: boolean) => void;
  onOpenSimsFinder: () => void;
};

export function CycleAuditScanForm({
  catalog,
  onCatalogChange,
  auditedBy,
  scannerEnabled = true,
  onLogged,
  onOpenSimsFinder,
}: Props) {
  const measureInputRef = useRef<HTMLInputElement>(null);
  const boxCountInputRef = useRef<HTMLInputElement>(null);
  const skuInputRef = useRef<HTMLInputElement>(null);

  const [sku, setSku] = useState("");
  const [carpetName, setCarpetName] = useState("");
  const [category, setCategory] = useState<CatalogCategory>("Carpet");
  const [simsLocation, setSimsLocation] = useState("");
  const [rollWidth, setRollWidth] = useState<number | null>(null);
  const [sqftPerBox, setSqftPerBox] = useState("");
  const [location, setLocation] = useState<LocationType>("sales_floor");
  const [wholeInches, setWholeInches] = useState("");
  const [fraction, setFraction] = useState(0);
  const [rounds, setRounds] = useState("");
  const [boxCount, setBoxCount] = useState("");
  const [systemClf, setSystemClf] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scanFlash, setScanFlash] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const auditMode = auditModeForCategory(category);
  const effectiveRollWidth = normalizeRollWidthFt(rollWidth);

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
  const rollSqFt = useMemo(
    () => calculateRollSqFt(clf, effectiveRollWidth),
    [clf, effectiveRollWidth]
  );
  const rollSqYd = useMemo(
    () => calculateSquareYards(rollSqFt),
    [rollSqFt]
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

  const catalogMatch = useMemo(
    () => findCatalogBySkuOrBarcode(catalog, sku),
    [catalog, sku]
  );

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
    setRollWidth(
      draft.rollWidth != null ? normalizeRollWidthFt(draft.rollWidth) : null
    );
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
    scheduleAuditDraftSave({
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

  const dismissKeyboard = useCallback(() => {
    blurActiveInput(skuInputRef);
  }, []);

  const flushDraft = useCallback(() => {
    flushAuditDraftSave();
  }, []);
  useFlushOnLeave(flushDraft);

  useEffect(() => {
    if (!scannerEnabled) flushAuditDraftSave();
  }, [scannerEnabled]);

  const applyCatalogItem = useCallback((item: CatalogItem) => {
    const nextCategory = normalizeCategory(item.category);
    setSku(item.sku);
    setCarpetName(item.carpet_name);
    setCategory(nextCategory);
    setSimsLocation(item.default_sims_location || "");
    setRollWidth(normalizeRollWidthFt(item.roll_width_ft));
    setSqftPerBox(
      item.sqft_per_box != null ? String(item.sqft_per_box) : ""
    );
    setScanFlash(true);
    playSuccessChime();
    window.setTimeout(() => setScanFlash(false), 900);
    blurActiveInput(skuInputRef);
  }, []);

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
      setRollWidth(normalizeRollWidthFt(hit.roll_width_ft));
      setSqftPerBox(hit.sqft_per_box != null ? String(hit.sqft_per_box) : "");
    } else {
      setCarpetName("");
      setRollWidth(null);
    }
  }

  /** Enter / rapid-burst scan resolution — catalog match or Quick-Add. */
  function handleSkuLookup(raw: string) {
    const cleaned = sanitizeBarcodeScan(raw);
    if (!cleaned) return;

    setSku(cleaned);
    const resolution = resolveScan(catalog, cleaned);

    if (resolution.kind === "empty") return;

    if (resolution.kind === "matched") {
      applyCatalogItem(resolution.item);
      flashStatus(`Matched ${resolution.item.sku}`);
      return;
    }

    // Unlinked barcode / unknown scan → Quick-Add / marry modal
    setQuickAddBarcode(resolution.scanned);
    if (resolution.kind === "unlinked_barcode") {
      flashStatus("Unlinked barcode — Quick-Add to SIMS catalog");
    }
  }

  useGlobalBarcodeScanner(handleSkuLookup, scannerEnabled);

  function handleQuickAdded(item: CatalogItem) {
    const next = [
      item,
      ...catalog.filter((c) => c.id !== item.id && c.sku !== item.sku),
    ].sort((a, b) => a.sku.localeCompare(b.sku));
    onCatalogChange(next);
    setQuickAddBarcode(null);
    // Clear scan field + measure state; apply catalog for continue-audit
    setWholeInches("");
    setFraction(0);
    setRounds("");
    setBoxCount("");
    setSystemClf("");
    applyCatalogItem(item);
    flashStatus(`Added ${item.sku} to SIMS catalog`);
  }

  function closeQuickAdd() {
    setQuickAddBarcode(null);
    setSku("");
    setCarpetName("");
    setRollWidth(null);
    dismissKeyboard();
  }

  function resetForm() {
    setSku("");
    setCarpetName("");
    setCategory("Carpet");
    setSimsLocation("");
    setRollWidth(null);
    setSqftPerBox("");
    setWholeInches("");
    setFraction(0);
    setRounds("");
    setBoxCount("");
    setSystemClf("");
    clearAuditDraft();
    dismissKeyboard();
  }

  const canLog =
    sku.trim().length > 0 &&
    !saving &&
    (auditMode === "roll" ? roundsNum > 0 : boxCountNum > 0);

  async function handleLog() {
    if (!canLog) return;
    flushAuditDraftSave();
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
      playSuccessChime();
      const modeLabel = formatAuditLocationBadge(location);
      resetForm();
      onLogged(record, offline);
      flashStatus(
        offline
          ? `${modeLabel} saved offline — form reset`
          : auditMode === "roll"
            ? `${modeLabel} roll logged`
            : `${modeLabel} units logged`
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
      roll_width_ft: rollWidth ?? DEFAULT_ROLL_WIDTH_FT,
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

  function bumpRounds(delta: number) {
    setRounds((r) => String(Math.max(0, toNumber(r, 0) + delta)));
  }

  function bumpWhole(delta: number) {
    setWholeInches((v) => String(Math.max(0, toNumber(v, 0) + delta)));
  }

  function bumpBoxes(delta: number) {
    setBoxCount((r) => String(Math.max(0, toNumber(r, 0) + delta)));
  }

  return (
    <div className="space-y-3 overflow-x-hidden">
      <QuickAddCatalogModal
        open={quickAddBarcode != null}
        scannedBarcode={quickAddBarcode ?? ""}
        onClose={closeQuickAdd}
        onSaved={handleQuickAdded}
      />

      {statusMsg && (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-center text-sm font-medium text-emerald-200"
        >
          {statusMsg}
        </p>
      )}

      <form
        id="cycle-audit-form"
        className={`${cardClass} space-y-3 overflow-x-auto !p-3`}
        onSubmit={(e) => {
          e.preventDefault();
          void handleLog();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="glass-subtitle">
            Scan-to-Catalog Audit
          </h2>
          <span className="glass-pill-emerald">
            {auditMode === "roll" ? "Mode A · Rolls" : "Mode B · Cartons"}
          </span>
        </div>

        <NumberField
          label="Item # / SKU / Barcode"
          mode="digits"
          value={sku}
          onChange={handleSkuChange}
          onScanCommit={handleSkuLookup}
          flash={scanFlash}
          placeholder="Scan barcode or tap to type item #"
          leftIcon={<BarcodeIcon className="h-5 w-5" />}
          inputRef={skuInputRef}
        />

        <div className="space-y-1.5">
          <TextField
            label="Product Name / Style"
            value={carpetName}
            onChange={setCarpetName}
            placeholder="e.g. Stainmaster Hearthstone 12ft"
          />
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((o) => !o)}
            className="flex min-h-10 w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            More details (category, SIMS, width)
            <span aria-hidden>{detailsOpen ? "▲" : "▼"}</span>
          </button>
          {detailsOpen ? (
            <>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">Category</span>
            <select
              value={category}
              onChange={(e) => {
                const next = normalizeCategory(e.target.value);
                setCategory(next);
                if (auditModeForCategory(next) === "roll") {
                  setRollWidth((w) =>
                    w != null ? normalizeRollWidthFt(w) : DEFAULT_ROLL_WIDTH_FT
                  );
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
          <div className="flex items-end gap-2">
            <TextField
              className="min-w-0 flex-1"
              label="SIMS Location Tag"
              value={simsLocation}
              onChange={setSimsLocation}
              placeholder="e.g. Aisle 14 - Bay 012"
            />
            <button
              type="button"
              onClick={onOpenSimsFinder}
              className="flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 text-xs font-semibold text-emerald-300 active:scale-95"
            >
              <LocationStatusIcon className="h-3.5 w-3.5" />
              SIMS Stock
            </button>
          </div>
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
                  const active = effectiveRollWidth === ft;
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
          ) : null}
          {catalogMatch ? (
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
            </>
          ) : null}
        </div>

        <AuditLocationModeToggle
          value={storeTypeFromHubLocation(location)}
          onChange={(mode) => {
            if (mode === "all") return;
            setLocation(hubLocationFromStoreType(mode));
          }}
          legend="Selling vs Topstock"
        />

        {auditMode === "roll" ? (
          <RollMeasurementPad
            mode="roll"
            wholeInches={wholeInches}
            onWholeInchesChange={setWholeInches}
            fraction={fraction}
            onFractionChange={setFraction}
            rounds={rounds}
            onRoundsChange={setRounds}
            onBumpRounds={bumpRounds}
            onBumpWhole={bumpWhole}
            clf={clf}
            sqFt={rollSqFt}
            sqYd={rollSqYd}
            rollWidthFt={effectiveRollWidth}
            measureInputRef={measureInputRef}
          />
        ) : (
          <RollMeasurementPad
            mode="carton"
            boxCount={boxCount}
            onBoxCountChange={setBoxCount}
            onBumpBoxes={bumpBoxes}
            sqftPerBox={sqftPerBox}
            onSqftPerBoxChange={setSqftPerBox}
            cartonSqFt={cartonSqFt}
            boxCountInputRef={boxCountInputRef}
          />
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
            className={`flex flex-col items-center rounded-xl border px-3 py-3 text-center text-sm font-semibold backdrop-blur-sm ${varianceBadgeClass(liveVarianceKind)}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <VarianceStatusIcon kind={liveVarianceKind} />
              {varianceLabel(liveVarianceKind)}: {formatVariance(liveVariance)}
            </span>
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
      </form>

      <ScanActionDock className="border-t border-slate-800/80 bg-slate-950/90 p-3 backdrop-blur-md">
        <button
          type="submit"
          form="cycle-audit-form"
          disabled={!canLog}
          className="flex h-12 w-full items-center justify-center rounded-xl btn-primary-glow px-4 text-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving
            ? "Logging…"
            : auditMode === "roll"
              ? "Log Roll & Reset"
              : "Log Units & Reset"}
        </button>
      </ScanActionDock>
    </div>
  );
}

