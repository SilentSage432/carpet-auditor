"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickAddCatalogModal } from "@/components/barcode/QuickAddCatalogModal";
import { SimsLocationFinder } from "@/components/catalog/SimsLocationFinder";
import { NumberField, TextField } from "@/components/ui/NumberField";
import { AuditReportModal } from "@/components/hub/AuditReportModal";
import {
  resolveScan,
  sanitizeBarcodeScan,
} from "@/lib/barcode";
import {
  findCatalogBySkuOrBarcode,
} from "@/lib/catalog";
import { blurActiveInput } from "@/lib/focus-input";
import { useGlobalBarcodeScanner } from "@/lib/hardware-scanner";
import { toNumber } from "@/lib/number-input";
import { playSuccessChime } from "@/lib/scan-feedback";
import {
  deleteAudit,
  fetchAudits,
  isToday,
  saveAudit,
} from "@/lib/storage";
import {
  APPLIANCE_CATEGORIES,
  APPLIANCE_SIMS_SUGGESTIONS,
  isApplianceCategory,
  normalizeApplianceCategory,
  type ApplianceCategory,
  type CarpetAudit,
  type CatalogItem,
  type LocationType,
  type StoreSpecialist,
} from "@/lib/types";

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
  activeSpecialist: StoreSpecialist | null;
};

export function ApplianceAuditSection({
  catalog,
  onCatalogChange,
  auditedBy,
  activeSpecialist,
}: Props) {
  const skuInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [category, setCategory] = useState<ApplianceCategory>("Refrigerator");
  const [simsLocation, setSimsLocation] = useState("");
  const [location, setLocation] = useState<LocationType>("sales_floor");
  const [unitCount, setUnitCount] = useState("1");
  const [audits, setAudits] = useState<CarpetAudit[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scanFlash, setScanFlash] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [simsFinderOpen, setSimsFinderOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const unitNum = toNumber(unitCount, 0);

  const applianceAudits = useMemo(
    () => audits.filter((a) => isApplianceCategory(a.category)),
    [audits]
  );
  const shiftAudits = useMemo(
    () => applianceAudits.filter((a) => isToday(a.created_at)),
    [applianceAudits]
  );
  const shiftUnits = useMemo(
    () => shiftAudits.reduce((sum, a) => sum + (a.box_count ?? 0), 0),
    [shiftAudits]
  );
  const visibleAudits = showAll ? applianceAudits : applianceAudits.slice(0, 5);

  const catalogMatch = useMemo(
    () => findCatalogBySkuOrBarcode(catalog, sku),
    [catalog, sku]
  );

  const dismissKeyboard = useCallback(() => {
    blurActiveInput(skuInputRef);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAudits().then((rows) => {
      if (!cancelled) {
        setAudits(rows);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flashStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2800);
  }, []);

  const applyCatalogItem = useCallback((item: CatalogItem) => {
    setSku(item.sku);
    setName(item.carpet_name);
    setModel(item.vendor || "");
    setCategory(normalizeApplianceCategory(item.category));
    setSimsLocation(item.default_sims_location || "");
    setScanFlash(true);
    playSuccessChime();
    window.setTimeout(() => setScanFlash(false), 900);
    blurActiveInput(skuInputRef);
  }, []);

  function handleSkuChange(raw: string) {
    const next = sanitizeBarcodeScan(raw);
    setSku(next);
    const hit = findCatalogBySkuOrBarcode(catalog, next);
    if (hit) {
      setName(hit.carpet_name);
      setModel(hit.vendor || "");
      setCategory(normalizeApplianceCategory(hit.category));
      setSimsLocation(hit.default_sims_location || "");
    } else {
      setName("");
      setModel("");
    }
  }

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

    setQuickAddBarcode(resolution.scanned);
    flashStatus("Unlinked barcode — Quick-Add appliance to SIMS catalog");
  }

  useGlobalBarcodeScanner(handleSkuLookup);

  function handleQuickAdded(item: CatalogItem) {
    const next = [
      item,
      ...catalog.filter((c) => c.id !== item.id && c.sku !== item.sku),
    ].sort((a, b) => a.sku.localeCompare(b.sku));
    onCatalogChange(next);
    setQuickAddBarcode(null);
    setUnitCount("1");
    applyCatalogItem(item);
    flashStatus(`Added ${item.sku} to SIMS catalog`);
  }

  function closeQuickAdd() {
    setQuickAddBarcode(null);
    setSku("");
    setName("");
    setModel("");
    dismissKeyboard();
  }

  function resetForm() {
    setSku("");
    setName("");
    setModel("");
    setCategory("Refrigerator");
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
      const { record, offline } = await saveAudit({
        sku: sku.trim(),
        carpet_name: name.trim(),
        category,
        sims_location: simsLocation.trim(),
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
      flashStatus("Could not save appliance audit");
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
        domain="appliances"
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
        kind="appliances"
        departmentLabel="Appliance"
        audits={shiftAudits.length > 0 ? shiftAudits : applianceAudits}
        specialist={activeSpecialist}
        auditedBy={auditedBy}
      />

      <section
        aria-label="Appliance shift summary"
        className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 shadow-lg shadow-black/20"
      >
        <p className="truncate font-mono text-xs font-semibold tabular-nums text-slate-200 sm:text-sm">
          🔌 {loaded ? shiftAudits.length : "—"} Logged
          <span className="text-slate-500"> | </span>
          {loaded ? shiftUnits : "—"} Units today
        </p>
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="flex h-11 w-full items-center justify-center rounded-xl border border-sky-500/40 bg-sky-950/40 px-3 text-sm font-bold text-sky-200 active:scale-[0.98]"
        >
          📊 Export / Print Report
        </button>
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
        id="appliance-audit-form"
        className={`${cardClass} space-y-4 overflow-x-auto`}
        onSubmit={(e) => {
          e.preventDefault();
          void handleLog();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Appliance Unit Audit
          </h2>
          <span className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-300">
            Mode · Units
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

        <TextField
          label="Appliance Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Whirlpool French Door"
        />

        <TextField
          label="Model #"
          value={model}
          onChange={setModel}
          placeholder="e.g. WRF535SWHZ"
        />

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-200">Category</span>
          <select
            value={category}
            onChange={(e) =>
              setCategory(normalizeApplianceCategory(e.target.value))
            }
            className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
          >
            {APPLIANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1.5">
          <div className="flex items-end gap-2">
            <TextField
              className="min-w-0 flex-1"
              label="SIMS Staging Location"
              value={simsLocation}
              onChange={setSimsLocation}
              placeholder="e.g. Appliance Wall Bay 01"
            />
            <button
              type="button"
              onClick={() => setSimsFinderOpen(true)}
              className="flex h-12 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 text-xs font-semibold text-emerald-300 active:scale-95"
            >
              📍 SIMS
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {APPLIANCE_SIMS_SUGGESTIONS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSimsLocation(tag)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  simsLocation === tag
                    ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-300"
                    : "border-slate-700 bg-slate-950 text-slate-400 active:bg-slate-800"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {catalogMatch ? (
          <p className="text-xs text-emerald-400">
            Matched from SIMS catalog
            {catalogMatch.upc_barcode ? " · barcode linked" : ""}
            {catalogMatch.default_sims_location
              ? ` · ${catalogMatch.default_sims_location}`
              : ""}
          </p>
        ) : null}

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

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-200">
            Quantity / Unit Count
          </legend>
          <div className="flex w-full items-center gap-2.5">
            <button
              type="button"
              aria-label="Decrease units"
              onClick={() => bumpUnits(-1)}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-2xl font-bold text-slate-100 active:scale-95"
            >
              −
            </button>
            <NumberField
              mode="integer"
              value={unitCount}
              onChange={setUnitCount}
              placeholder="1"
              center
              className="min-w-0 flex-1"
              aria-label="Unit count"
              inputRef={qtyInputRef}
            />
            <button
              type="button"
              aria-label="Increase units"
              onClick={() => bumpUnits(1)}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-2xl font-bold text-slate-100 active:scale-95"
            >
              +
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setUnitCount(String(n))}
                className={`flex min-h-12 items-center justify-center rounded-xl border font-mono text-sm font-semibold active:scale-95 ${
                  unitNum === n
                    ? "border-emerald-500 bg-emerald-500 text-slate-950"
                    : "border-slate-800 bg-slate-950 text-emerald-400"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[1, 5].map((n) => (
              <button
                key={`plus-${n}`}
                type="button"
                onClick={() => bumpUnits(n)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 font-mono text-sm font-semibold text-sky-300 active:bg-slate-800"
              >
                +{n}
              </button>
            ))}
          </div>
          <div
            aria-live="polite"
            className="rounded-xl border border-sky-500/30 bg-gradient-to-br from-sky-950/50 to-slate-950 p-4 text-center"
          >
            <p className="font-mono text-3xl font-bold tabular-nums text-sky-300">
              {unitNum || 0}{" "}
              <span className="text-base font-semibold text-sky-300/80">
                unit{unitNum === 1 ? "" : "s"}
              </span>
            </p>
          </div>
        </fieldset>

        {auditedBy ? (
          <p className="text-center text-xs text-slate-500">
            Logging as{" "}
            <span className="font-semibold text-emerald-400">{auditedBy}</span>
          </p>
        ) : (
          <p className="text-center text-xs text-amber-400">
            Select an active specialist in the header before logging.
          </p>
        )}
      </form>

      <div className="fixed bottom-16 left-0 right-0 z-20 mx-auto w-full max-w-md border-t border-slate-800/80 bg-slate-950/90 p-3 backdrop-blur-md">
        <button
          type="submit"
          form="appliance-audit-form"
          disabled={!canLog}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-sky-400 text-base font-bold text-slate-950 transition enabled:active:scale-[0.98] enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Logging…" : "Log Appliance & Reset"}
        </button>
      </div>

      <section className="space-y-3 overflow-x-hidden" aria-label="Appliance audit log">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Appliance log
          </h2>
          <span className="font-mono text-xs text-slate-500">
            {applianceAudits.length}
          </span>
        </div>

        {!loaded && (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
            Loading audits…
          </p>
        )}

        {loaded && applianceAudits.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
            No appliance audits yet — scan a barcode to start.
          </p>
        )}

        <ul className="space-y-2">
          {visibleAudits.map((audit) => (
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-lg font-bold tabular-nums text-sky-300">
                    {audit.box_count ?? 0} units
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
          ))}
        </ul>

        {applianceAudits.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-sm font-semibold text-slate-200"
          >
            {showAll
              ? "Show Fewer Entries"
              : `Show All Logged Entries (${applianceAudits.length})`}
          </button>
        )}
      </section>
    </div>
  );
}
