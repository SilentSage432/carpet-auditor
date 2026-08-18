"use client";

/**
 * Full-screen bottom sheet for continuous appliance UPC audit scanning.
 * Stays open between scans — hardware wedge input keeps focus on the SKU field.
 */

import { useEffect } from "react";
import { ApplianceScanForm } from "@/components/sections/ApplianceScanForm";
import type { ApplianceCatalogItem, ApplianceScan, StoreSpecialist } from "@/lib/types";
import type { ApplianceScannerLocationContext } from "@/lib/specialty-tools";

type Props = {
  open: boolean;
  onClose: () => void;
  catalog: ApplianceCatalogItem[];
  onCatalogChange: (items: ApplianceCatalogItem[]) => void;
  scannedBy: string;
  activeSpecialist: StoreSpecialist | null;
  scannerEnabled?: boolean;
  bayLocation?: ApplianceScannerLocationContext | null;
  onLogged: (record: ApplianceScan, offline: boolean) => void;
};

export function ApplianceScannerModal({
  open,
  onClose,
  catalog,
  onCatalogChange,
  scannedBy,
  activeSpecialist,
  scannerEnabled = true,
  bayLocation = null,
  onLogged,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-slate-950/75">
      <button
        type="button"
        aria-label="Close appliance scanner"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Appliance UPC audit scanner"
        className="relative z-10 max-h-[92dvh] overflow-y-auto rounded-t-2xl border-t-2 border-cyan-500/40 bg-slate-950 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600" />
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-cyan-200">
            Scan &amp; Count Appliances
            {bayLocation ? ` · ${bayLocation.location_tag}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-10 items-center rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-300"
          >
            Done
          </button>
        </div>
        <ApplianceScanForm
          catalog={catalog}
          onCatalogChange={onCatalogChange}
          scannedBy={scannedBy}
          activeSpecialist={activeSpecialist}
          scannerEnabled={scannerEnabled}
          focusOnMount
          bayLocation={bayLocation}
          onLogged={onLogged}
        />
      </div>
    </div>
  );
}
