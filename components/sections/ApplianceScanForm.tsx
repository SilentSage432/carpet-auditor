"use client";

/**
 * Appliance scan/input island — owns form state + drafts.
 * Quiet COUNT path for known UPCs; Quick-Add TEACH for unknowns.
 * Historical scan log stays in ApplianceAuditSection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickAddApplianceModal } from "@/components/barcode/QuickAddApplianceModal";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  findApplianceByItemOrUpc,
  resolveApplianceScan,
  type ApplianceScanResolution,
} from "@/lib/appliance-catalog";
import {
  clearApplianceScanDraft,
  flushApplianceScanDraftSave,
  getLocalApplianceScans,
  loadApplianceScanDraft,
  saveApplianceScan,
  scheduleApplianceScanDraftSave,
} from "@/lib/appliance-scans";
import { loadCachedActiveAuditSessionId } from "@/lib/appliances/audit-client";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { blurActiveInput } from "@/lib/focus-input";
import { useGlobalBarcodeScanner } from "@/lib/hardware-scanner";
import { playScanLoggedFeedback } from "@/lib/scan-feedback";
import { playErrorTone } from "@/lib/ui/feedback";
import { getStoreNumber } from "@/lib/store";
import {
  getPendingApplianceScanSyncForAudit,
  SYNC_QUEUE_CHANGED_EVENT,
} from "@/lib/sync-queue";
import { useFlushOnLeave } from "@/lib/use-flush-on-leave";
import {
  APPLIANCE_LOCATION_SUGGESTIONS,
  APPLIANCE_SCAN_MODES,
  APPLIANCE_SIMS_SUGGESTIONS,
  defaultApplianceConditionForLocation,
  isValidApplianceSubCategory,
  type ApplianceCatalogItem,
  type ApplianceLocationType,
  type ApplianceScan,
  type StoreSpecialist,
} from "@/lib/types";
import type { ApplianceScannerLocationContext } from "@/lib/specialty-tools";

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
  catalog: ApplianceCatalogItem[];
  onCatalogChange: (items: ApplianceCatalogItem[]) => void;
  scannedBy: string;
  activeSpecialist: StoreSpecialist | null;
  scannerEnabled?: boolean;
  /** Focus SKU field when mounted (scanner modal open). */
  focusOnMount?: boolean;
  /** When opened from a mapped SIMS bay, lock location and attach location_id. */
  bayLocation?: ApplianceScannerLocationContext | null;
  /** Active physical audit session id (APP-AUD-001). */
  auditSessionId?: string | null;
  /** When true, do not resume cached active audit (ad-hoc ledger path). */
  ignoreCachedAuditSession?: boolean;
  /** Close scanner and open physical audit review/finish (APP-FIELD-001). */
  onReviewFinishAudit?: () => void;
  onLogged: (record: ApplianceScan, offline: boolean) => void;
};

export function ApplianceScanForm({
  catalog,
  onCatalogChange,
  scannedBy,
  activeSpecialist,
  scannerEnabled = true,
  focusOnMount = false,
  bayLocation = null,
  auditSessionId = null,
  ignoreCachedAuditSession = false,
  onReviewFinishAudit,
  onLogged,
}: Props) {
  const itemInputRef = useRef<HTMLInputElement>(null);
  const serialRef = useRef("");
  const locationRef = useRef("");
  const locationTypeRef = useRef<ApplianceLocationType>("showroom");
  /** Teach path only — known rapid-fire must not hard-block the next barcode. */
  const teachBusyRef = useRef(false);

  const [itemNumber, setItemNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [locationType, setLocationType] =
    useState<ApplianceLocationType>("showroom");
  const [teachBusy, setTeachBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "error">("ok");
  const [scanFlash, setScanFlash] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [draftRestored, setDraftRestored] = useState(false);
  /** Progressive disclosure — wedge field stays mounted; UI expands on demand. */
  const [manualEntry, setManualEntry] = useState(false);
  const [pendingAuditScans, setPendingAuditScans] = useState(0);
  const [auditUnitCount, setAuditUnitCount] = useState(0);

  serialRef.current = serialNumber;
  locationRef.current = location;
  locationTypeRef.current = locationType;
  teachBusyRef.current = teachBusy;

  const locationSuggestions = useMemo(() => {
    return [
      ...APPLIANCE_LOCATION_SUGGESTIONS[locationType],
      ...APPLIANCE_SIMS_SUGGESTIONS,
    ].filter((tag, index, all) => all.indexOf(tag) === index);
  }, [locationType]);

  const catalogMatch = useMemo(
    () => findApplianceByItemOrUpc(catalog, itemNumber),
    [catalog, itemNumber]
  );

  const dismissKeyboard = useCallback(() => {
    blurActiveInput(itemInputRef);
  }, []);

  const flashStatus = useCallback((msg: string, tone: "ok" | "error" = "ok") => {
    setStatusTone(tone);
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), tone === "error" ? 5000 : 2800);
  }, []);

  useEffect(() => {
    if (draftRestored) return;
    const draft = loadApplianceScanDraft();
    if (!draft) {
      setDraftRestored(true);
      return;
    }
    setItemNumber(draft.itemNumber);
    setSerialNumber(draft.serialNumber);
    setLocation(draft.location);
    setLocationType(draft.locationType ?? "showroom");
    setDescription(draft.description);
    if (draft.itemNumber) setManualEntry(true);
    setDraftRestored(true);
  }, [draftRestored]);

  useEffect(() => {
    if (!bayLocation) return;
    setLocation(bayLocation.location_tag);
    if (bayLocation.location_type) {
      setLocationType(bayLocation.location_type);
    }
  }, [bayLocation]);

  useEffect(() => {
    if (!draftRestored) return;
    const hasContent =
      itemNumber || serialNumber || location || description;
    if (!hasContent) {
      clearApplianceScanDraft();
      return;
    }
    scheduleApplianceScanDraftSave({
      store_number: getStoreNumber(),
      itemNumber,
      serialNumber,
      location,
      locationType,
      description,
    });
  }, [draftRestored, itemNumber, serialNumber, location, locationType, description]);

  const flushDraft = useCallback(() => {
    flushApplianceScanDraftSave();
  }, []);
  useFlushOnLeave(flushDraft);

  useEffect(() => {
    if (!scannerEnabled) flushApplianceScanDraftSave();
  }, [scannerEnabled]);

  useEffect(() => {
    if (!focusOnMount || !scannerEnabled) return;
    // Keep wedge target focused even when visually quiet.
    window.setTimeout(() => itemInputRef.current?.focus(), 50);
  }, [focusOnMount, scannerEnabled, quickAddBarcode, manualEntry]);

  const resolvedAuditSessionId = ignoreCachedAuditSession
    ? auditSessionId
    : auditSessionId || loadCachedActiveAuditSessionId();

  const refreshAuditCounts = useCallback(() => {
    const sessionId = resolvedAuditSessionId;
    if (!sessionId) {
      setPendingAuditScans(0);
      setAuditUnitCount(0);
      return;
    }
    const store = getStoreNumber();
    setPendingAuditScans(
      getPendingApplianceScanSyncForAudit(sessionId, store).length
    );
    setAuditUnitCount(
      getLocalApplianceScans(store).filter(
        (s) => s.audit_session_id === sessionId
      ).length
    );
  }, [resolvedAuditSessionId]);

  useEffect(() => {
    refreshAuditCounts();
    if (typeof window === "undefined") return;
    const onQueue = () => refreshAuditCounts();
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, onQueue);
    window.addEventListener("online", onQueue);
    return () => {
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, onQueue);
      window.removeEventListener("online", onQueue);
    };
  }, [refreshAuditCounts]);

  const clearForNextScan = useCallback(() => {
    setItemNumber("");
    setSerialNumber("");
    setDescription("");
    setScanFlash(false);
    setManualEntry(false);
    dismissKeyboard();
    window.setTimeout(() => itemInputRef.current?.focus(), 0);
  }, [dismissKeyboard]);

  const commitScan = useCallback(
    async (item: ApplianceCatalogItem) => {
      if (!isValidApplianceSubCategory(item.category, item.sub_category)) {
        setQuickAddBarcode(item.upc || item.item_number);
        flashStatus("Select a sub-category to finish linking");
        return;
      }

      flushApplianceScanDraftSave();
      const capturedAt = new Date().toISOString();
      const sessionId = ignoreCachedAuditSession
        ? auditSessionId || undefined
        : auditSessionId || loadCachedActiveAuditSessionId() || undefined;
      const serialSnapshot = serialRef.current.trim();
      const locationSnapshot = locationRef.current.trim();
      const locationTypeSnapshot = locationTypeRef.current;

      // APP-FIELD-001: acknowledge before network — ready for next barcode.
      setSessionTotal((n) => n + 1);
      playScanLoggedFeedback();
      setScanFlash(true);
      window.setTimeout(() => setScanFlash(false), 450);
      clearForNextScan();

      try {
        const { record, offline } = await saveApplianceScan(
          {
            item_number: item.item_number,
            serial_number: serialSnapshot,
            location: locationSnapshot,
            location_type: locationTypeSnapshot,
            condition_tag: defaultApplianceConditionForLocation(
              locationTypeSnapshot
            ),
            category: item.category,
            sub_category: String(item.sub_category ?? "").trim(),
            scanned_by: scannedBy || activeSpecialist?.name || "",
            scanned_at: capturedAt,
            location_id: bayLocation?.location_id,
            aisle: bayLocation?.aisle,
            bay_number: bayLocation?.bay,
            audit_session_id: sessionId,
          },
          { localFirst: true }
        );

        onLogged(record, offline);
        refreshAuditCounts();
        flashStatus(
          offline
            ? `Counted ${item.item_number} · syncing when online`
            : `Counted ${item.item_number}`
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error("[ApplianceAudit] continuous save failed", err);
        setSessionTotal((n) => Math.max(0, n - 1));
        flashStatus(`Failed to save scan: ${message}`, "error");
        playErrorTone();
      }
    },
    [
      activeSpecialist?.name,
      auditSessionId,
      bayLocation,
      clearForNextScan,
      flashStatus,
      ignoreCachedAuditSession,
      onLogged,
      refreshAuditCounts,
      scannedBy,
    ]
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
      if (teachBusyRef.current) return;
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

      setQuickAddBarcode(resolution.scanned);
      flashStatus("Unknown item — teach mapping to continue");
    },
    [catalog, commitScan, flashStatus, quickAddBarcode]
  );

  useGlobalBarcodeScanner(handleItemLookup, scannerEnabled && quickAddBarcode == null);

  async function handleQuickAdded(item: ApplianceCatalogItem) {
    const next = [
      item,
      ...catalog.filter(
        (c) => c.id !== item.id && c.item_number !== item.item_number
      ),
    ].sort((a, b) => a.item_number.localeCompare(b.item_number));
    onCatalogChange(next);
    setQuickAddBarcode(null);
    setTeachBusy(true);
    try {
      // Logs the physical unit once — do not require a second scan of the tag.
      await commitScan(item);
    } finally {
      setTeachBusy(false);
    }
  }

  function closeQuickAdd() {
    setQuickAddBarcode(null);
    clearForNextScan();
  }

  function openManualEntry() {
    setManualEntry(true);
    window.setTimeout(() => itemInputRef.current?.focus(), 50);
  }

  return (
    <>
      <QuickAddApplianceModal
        open={quickAddBarcode != null}
        scannedBarcode={quickAddBarcode ?? ""}
        catalog={catalog}
        onClose={closeQuickAdd}
        onSaved={(item) => void handleQuickAdded(item)}
      />

      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-30 -mx-1 space-y-2 rounded-2xl border border-cyan-500/40 bg-zinc-900/90 px-3 py-3 shadow-lg shadow-black/30 backdrop-blur-xl"
      >
        {resolvedAuditSessionId ? (
          <div className="space-y-2 rounded-xl border border-emerald-500/35 bg-emerald-950/30 px-2.5 py-2">
            <p className="text-center font-mono text-[10px] font-bold uppercase tracking-wide text-emerald-200">
              Physical audit active
            </p>
            <p className="text-center text-xs text-emerald-100/90">
              {Math.max(sessionTotal, auditUnitCount)} observed unit
              {Math.max(sessionTotal, auditUnitCount) === 1 ? "" : "s"}
              {pendingAuditScans > 0
                ? ` · ${pendingAuditScans} unsynced`
                : ""}
            </p>
            {onReviewFinishAudit ? (
              <button
                type="button"
                onClick={onReviewFinishAudit}
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/90 px-3 text-xs font-bold text-zinc-950"
              >
                Review / Finish Audit
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-center font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Ad-hoc scan · not a durable physical audit
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {APPLIANCE_SCAN_MODES.map((mode) => {
            const active = locationType === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setLocationType(mode.id)}
                disabled={teachBusy}
                className={`flex min-h-11 items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-bold transition ${
                  active
                    ? "border-cyan-400/50 bg-cyan-950/50 text-cyan-100"
                    : "border-zinc-700 bg-zinc-950/70 text-zinc-400"
                }`}
              >
                <span aria-hidden>{mode.emoji}</span>
                {mode.label}
              </button>
            );
          })}
        </div>
        <p className="text-center font-mono text-sm font-semibold tabular-nums text-sky-100 sm:text-base">
          {resolvedAuditSessionId ? "Audit count" : "Ad-hoc session"}:{" "}
          {sessionTotal} {sessionTotal === 1 ? "item" : "items"} scanned
        </p>
        <p className="mt-0.5 text-center text-[11px] font-medium text-sky-300/70">
          {teachBusy
            ? "Saving mapping…"
            : "Ready — scan next barcode"}
        </p>
      </div>

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
          <h2 className="glass-subtitle">Appliance Floor Scan</h2>
          <span className="glass-pill-cyan">Quiet count</span>
        </div>

        {/*
          Wedge field always mounted with NumberField scan debounce.
          Quiet label by default; "Enter item manually" expands typing affordance.
        */}
        <div className="space-y-2">
          <NumberField
            label={manualEntry ? "Item # / SKU / Barcode" : "Scan barcode"}
            mode="digits"
            value={itemNumber}
            onChange={handleItemChange}
            onScanCommit={handleItemLookup}
            flash={scanFlash}
            placeholder={
              manualEntry
                ? "Type Item # or scan — Enter to log"
                : "Hardware scan auto-logs known UPCs"
            }
            leftIcon={<BarcodeIcon className="h-5 w-5" />}
            inputRef={itemInputRef}
          />
          {!manualEntry ? (
            <p className="text-center text-[11px] text-slate-500">
              Known UPCs resolve quietly · unknown opens Teach
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (manualEntry) {
                setManualEntry(false);
                window.setTimeout(() => itemInputRef.current?.focus(), 50);
              } else {
                openManualEntry();
              }
            }}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-xs font-semibold text-slate-300"
          >
            {manualEntry ? "Done with manual entry" : "Enter item manually"}
          </button>
        </div>

        <TextField
          label="Serial # (optional — applied to next scan)"
          value={serialNumber}
          onChange={setSerialNumber}
          placeholder="Scan or type serial before item barcode"
        />

        {description && catalogMatch ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
            {description}
            {catalogMatch.sub_category
              ? ` · ${catalogMatch.category} / ${catalogMatch.sub_category}`
              : ""}
          </p>
        ) : null}

        <div className="space-y-1.5">
          {bayLocation ? (
            <p className="rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 font-mono text-sm font-semibold text-cyan-100">
              Mapped bay {bayLocation.location_tag}
            </p>
          ) : (
            <>
              <TextField
                label="Location (sticky between scans)"
                value={location}
                onChange={setLocation}
                placeholder={
                  locationType === "topstock"
                    ? "e.g. Top Stock Bay 012"
                    : "e.g. Showroom Floor"
                }
              />
              <div className="flex flex-wrap gap-1.5">
                {locationSuggestions.map((tag) => (
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
            </>
          )}
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
    </>
  );
}
