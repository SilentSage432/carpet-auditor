"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickAddApplianceModal } from "@/components/barcode/QuickAddApplianceModal";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  findApplianceByItemOrUpc,
  resolveApplianceScan,
  type ApplianceScanResolution,
} from "@/lib/appliance-catalog";
import {
  applianceScansToCsv,
  deleteApplianceScan,
  fetchApplianceScans,
  isApplianceScanToday,
  saveApplianceScan,
} from "@/lib/appliance-scans";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { blurActiveInput } from "@/lib/focus-input";
import { useGlobalBarcodeScanner } from "@/lib/hardware-scanner";
import { playScanLoggedFeedback } from "@/lib/scan-feedback";
import {
  APPLIANCE_SIMS_SUGGESTIONS,
  isValidApplianceSubCategory,
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
  catalog: ApplianceCatalogItem[];
  onCatalogChange: (items: ApplianceCatalogItem[]) => void;
  scannedBy: string;
  activeSpecialist: StoreSpecialist | null;
};

export function ApplianceAuditSection({
  catalog,
  onCatalogChange,
  scannedBy,
  activeSpecialist,
}: Props) {
  const itemInputRef = useRef<HTMLInputElement>(null);
  const serialRef = useRef("");
  const locationRef = useRef("");
  const savingRef = useRef(false);

  const [itemNumber, setItemNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [scans, setScans] = useState<ApplianceScan[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "error">("ok");
  const [loaded, setLoaded] = useState(false);
  const [scanFlash, setScanFlash] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  /** Scans successfully logged this browser session (continuous counter). */
  const [sessionTotal, setSessionTotal] = useState(0);

  serialRef.current = serialNumber;
  locationRef.current = location;
  savingRef.current = saving;

  const shiftScans = useMemo(
    () => scans.filter((s) => isApplianceScanToday(s.scanned_at)),
    [scans]
  );
  const visibleScans = showAll ? scans : scans.slice(0, 5);

  const catalogMatch = useMemo(
    () => findApplianceByItemOrUpc(catalog, itemNumber),
    [catalog, itemNumber]
  );

  const dismissKeyboard = useCallback(() => {
    blurActiveInput(itemInputRef);
  }, []);

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

  /** Clear item fields for the next scan; keep location sticky for bay work. */
  const clearForNextScan = useCallback(() => {
    setItemNumber("");
    setSerialNumber("");
    setDescription("");
    setScanFlash(false);
    dismissKeyboard();
    window.setTimeout(() => itemInputRef.current?.focus(), 50);
  }, [dismissKeyboard]);

  /**
   * Continuous mode: POST to /api/appliances/scans immediately, then clear.
   * Does not wait for a Submit button.
   */
  const commitScan = useCallback(
    async (item: ApplianceCatalogItem) => {
      if (savingRef.current) return;
      if (!isValidApplianceSubCategory(item.category, item.sub_category)) {
        setQuickAddBarcode(item.upc || item.item_number);
        flashStatus("Select a sub-category to finish linking");
        return;
      }

      setSaving(true);
      try {
        const { record, offline } = await saveApplianceScan({
          item_number: item.item_number,
          serial_number: serialRef.current.trim(),
          location: locationRef.current.trim(),
          category: item.category,
          sub_category: String(item.sub_category ?? "").trim(),
          scanned_by: scannedBy || activeSpecialist?.name || "",
        });

        setScans((prev) => [record, ...prev.filter((s) => s.id !== record.id)]);
        setSessionTotal((n) => n + 1);
        playScanLoggedFeedback();
        setScanFlash(true);
        window.setTimeout(() => setScanFlash(false), 600);
        clearForNextScan();
        flashStatus(
          offline
            ? `Logged ${item.item_number} offline — will sync`
            : `Logged ${item.item_number}`
        );

        void fetchApplianceScans()
          .then((refreshed) => setScans(refreshed))
          .catch((refreshErr) => {
            console.error(
              "[ApplianceAudit] re-fetch after save failed",
              refreshErr
            );
          });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error("[ApplianceAudit] continuous save failed", err);
        flashStatus(`Failed to save scan: ${message}`, "error");
      } finally {
        setSaving(false);
      }
    },
    [activeSpecialist?.name, clearForNextScan, flashStatus, scannedBy]
  );

  function handleItemChange(raw: string) {
    const next = sanitizeBarcodeScan(raw);
    setItemNumber(next);
    const hit = findApplianceByItemOrUpc(catalog, next);
    if (hit) {
      setDescription(hit.description);
    } else {
      setDescription("");
    }
  }

  const handleItemLookup = useCallback(
    (raw: string) => {
      const cleaned = sanitizeBarcodeScan(raw);
      if (!cleaned) return;
      if (savingRef.current) return;
      // Pause further hardware scans while the link modal is open.
      if (quickAddBarcode != null) return;

      setItemNumber(cleaned);
      const resolution: ApplianceScanResolution = resolveApplianceScan(
        catalog,
        cleaned
      );
      if (resolution.kind === "empty") return;

      if (resolution.kind === "matched") {
        const item = resolution.item;
        setDescription(item.description);

        if (!isValidApplianceSubCategory(item.category, item.sub_category)) {
          setQuickAddBarcode(item.upc || item.item_number);
          flashStatus("Sub-category required — complete the link");
          return;
        }

        void commitScan(item);
        return;
      }

      // NEW / unrecognized — pause for subcategory (Quick-Add) modal.
      setQuickAddBarcode(resolution.scanned);
      flashStatus("New item — choose category & sub-category");
    },
    [catalog, commitScan, flashStatus, quickAddBarcode]
  );

  useGlobalBarcodeScanner(handleItemLookup);

  async function handleQuickAdded(item: ApplianceCatalogItem) {
    const next = [
      item,
      ...catalog.filter(
        (c) => c.id !== item.id && c.item_number !== item.item_number
      ),
    ].sort((a, b) => a.item_number.localeCompare(b.item_number));
    onCatalogChange(next);
    setQuickAddBarcode(null);
    await commitScan(item);
  }

  function closeQuickAdd() {
    setQuickAddBarcode(null);
    clearForNextScan();
  }

  async function handleDelete(id: string) {
    await deleteApplianceScan(id);
    setScans((prev) => prev.filter((s) => s.id !== id));
    flashStatus("Entry removed");
  }

  function handleDownloadCsv() {
    const rows = shiftScans.length > 0 ? shiftScans : scans;
    const csv = applianceScansToCsv(rows);
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
      <QuickAddApplianceModal
        open={quickAddBarcode != null}
        scannedBarcode={quickAddBarcode ?? ""}
        onClose={closeQuickAdd}
        onSaved={(item) => void handleQuickAdded(item)}
      />

      {/* Floating live session counter — continuous scan verification */}
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-30 -mx-1 rounded-2xl border border-sky-500/40 bg-sky-950/90 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur-md"
      >
        <p className="text-center font-mono text-sm font-semibold tabular-nums text-sky-100 sm:text-base">
          Session Total: {sessionTotal}{" "}
          {sessionTotal === 1 ? "item" : "items"} scanned
        </p>
        {saving ? (
          <p className="mt-0.5 text-center text-[11px] font-medium text-sky-300/80">
            Logging to database…
          </p>
        ) : (
          <p className="mt-0.5 text-center text-[11px] font-medium text-sky-300/70">
            Continuous mode — scan barcode to log instantly
          </p>
        )}
      </div>

      <section
        aria-label="Appliance shift summary"
        className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/90 shadow-lg shadow-black/20"
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

      <div className={`${cardClass} space-y-4 overflow-x-auto`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Appliance Floor Scan
          </h2>
          <span className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
            Continuous
          </span>
        </div>

        <NumberField
          label="Item # / SKU / Barcode"
          mode="digits"
          value={itemNumber}
          onChange={handleItemChange}
          onScanCommit={handleItemLookup}
          flash={scanFlash}
          placeholder="Scan barcode — auto-logs on detect"
          leftIcon={<BarcodeIcon className="h-5 w-5" />}
          inputRef={itemInputRef}
        />

        <TextField
          label="Serial # (optional — applied to next scan)"
          value={serialNumber}
          onChange={setSerialNumber}
          placeholder="Scan or type serial before item barcode"
        />

        {description ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
            {description}
            {catalogMatch?.sub_category
              ? ` · ${catalogMatch.category} / ${catalogMatch.sub_category}`
              : ""}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <TextField
            label="Location (sticky between scans)"
            value={location}
            onChange={setLocation}
            placeholder="e.g. Appliance Wall Bay 01"
          />
          <div className="flex flex-wrap gap-1.5">
            {APPLIANCE_SIMS_SUGGESTIONS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setLocation(tag)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  location === tag
                    ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-300"
                    : "border-slate-700 bg-slate-950 text-slate-400 active:bg-slate-800"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {scannedBy || activeSpecialist ? (
          <p className="text-center text-xs text-slate-500">
            Scanning as{" "}
            <span className="font-semibold text-emerald-400">
              {scannedBy || activeSpecialist?.name}
            </span>
          </p>
        ) : (
          <p className="text-center text-xs text-amber-400">
            Select an active specialist in the header before scanning.
          </p>
        )}
      </div>

      <section className="space-y-3 overflow-x-hidden" aria-label="Appliance scan log">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Scan log
          </h2>
          <span className="font-mono text-xs text-slate-500">{scans.length}</span>
        </div>

        {!loaded ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
            Loading scans…
          </p>
        ) : null}

        {loaded && scans.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
            No appliance scans yet — scan a barcode to start.
          </p>
        ) : null}

        <ul className="space-y-2">
          {visibleScans.map((scan) => (
            <li
              key={scan.id}
              className="flex gap-2 rounded-2xl border border-slate-800 bg-slate-900/90 p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-semibold text-slate-50">
                    Item {scan.item_number}
                  </span>
                  <span className="rounded bg-slate-700/50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-300">
                    {scan.category}
                    {scan.sub_category ? ` · ${scan.sub_category}` : ""}
                  </span>
                  {scan.offline ? (
                    <span className="rounded bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-300">
                      Offline
                    </span>
                  ) : null}
                </div>
                {scan.serial_number ? (
                  <p className="font-mono text-xs text-sky-300">
                    Serial {scan.serial_number}
                  </p>
                ) : null}
                {scan.location ? (
                  <p className="font-mono text-xs text-emerald-400/90">
                    📍 {scan.location}
                  </p>
                ) : null}
                <time
                  dateTime={scan.scanned_at}
                  className="font-mono text-xs text-slate-500"
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
                aria-label={`Delete item ${scan.item_number}`}
                onClick={() => void handleDelete(scan.id)}
                className="flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-xl border border-red-500/40 text-sm font-semibold text-red-400"
              >
                Del
              </button>
            </li>
          ))}
        </ul>

        {scans.length > 5 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-sm font-semibold text-slate-200"
          >
            {showAll
              ? "Show Fewer Entries"
              : `Show All Logged Entries (${scans.length})`}
          </button>
        ) : null}
      </section>
    </div>
  );
}
