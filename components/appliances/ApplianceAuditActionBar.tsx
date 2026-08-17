"use client";

/**
 * Appliance audit session actions — export, email, reset, showroom baseline lock.
 */

import { useMemo, useState } from "react";
import { ConfirmModal } from "@/components/hub/ConfirmModal";
import {
  buildApplianceAuditMailtoLink,
  shareOrDownloadApplianceCsv,
} from "@/lib/appliances/audit-export";
import {
  applianceScansToCsv,
  clearAllApplianceScans,
  countLockedShowroomBaseline,
  lockApplianceShowroomBaseline,
  type ApplianceScanCsvOptions,
} from "@/lib/appliance-scans";
import { getStoreNumber } from "@/lib/store";
import { isApplianceShowroomDisplayScan, type ApplianceScan } from "@/lib/types";

type Props = {
  scans: ApplianceScan[];
  csvOptions?: ApplianceScanCsvOptions;
  disabled?: boolean;
  onResetComplete: () => void;
  onRefresh: () => void;
  onStatus: (message: string, tone?: "ok" | "error") => void;
};

export function ApplianceAuditActionBar({
  scans,
  csvOptions = {},
  disabled = false,
  onResetComplete,
  onRefresh,
  onStatus,
}: Props) {
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState<"export" | "reset" | "lock" | null>(null);

  const hasScans = scans.length > 0;
  const baselineCount = useMemo(
    () => countLockedShowroomBaseline(scans),
    [scans]
  );
  const showroomCount = useMemo(
    () => scans.filter((s) => isApplianceShowroomDisplayScan(s)).length,
    [scans]
  );

  async function handleShareExport() {
    if (!hasScans) return;
    setBusy("export");
    try {
      const mode = await shareOrDownloadApplianceCsv(scans, {
        ...csvOptions,
        filename: `appliance-audit-${getStoreNumber()}-${new Date().toISOString().slice(0, 10)}.csv`,
      });
      onStatus(
        mode === "shared"
          ? "Audit CSV shared"
          : "Audit CSV downloaded"
      );
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not export CSV",
        "error"
      );
    } finally {
      setBusy(null);
    }
  }

  function handleEmail() {
    if (!hasScans) return;
    const href = buildApplianceAuditMailtoLink(scans, {
      ...csvOptions,
      storeNumber: getStoreNumber(),
    });
    window.location.href = href;
    onStatus("Opening email draft with audit summary");
  }

  async function confirmReset() {
    setBusy("reset");
    try {
      const { deleted, preserved } = await clearAllApplianceScans({
        preserveShowroomBaseline: baselineCount > 0,
      });
      setResetStep(0);
      onResetComplete();
      onStatus(
        preserved > 0
          ? `Topstock reset — cleared ${deleted} scan(s), kept ${preserved} baseline showroom unit(s)`
          : deleted > 0
            ? `Audit session reset — ${deleted} scan(s) cleared`
            : "Audit session reset — ledger is empty"
      );
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not reset audit session",
        "error"
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleLockBaseline() {
    if (showroomCount === 0) {
      onStatus("Scan showroom display units before locking baseline", "error");
      return;
    }
    setBusy("lock");
    try {
      const { locked } = await lockApplianceShowroomBaseline();
      onRefresh();
      onStatus(
        locked > 0
          ? `Showroom baseline locked — ${locked} display unit(s) persist across weekly topstock resets`
          : "No showroom scans to lock"
      );
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not lock showroom baseline",
        "error"
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ConfirmModal
        open={resetStep === 1}
        title="Reset appliance audit session?"
        message={
          baselineCount > 0
            ? `Clears weekly boxed/topstock counts for store ${getStoreNumber()}. ${baselineCount} locked showroom baseline unit(s) stay until MST resets the floor.`
            : `This permanently deletes ${scans.length} scan record(s) for store ${getStoreNumber()} and cannot be undone.`
        }
        confirmLabel={
          baselineCount > 0 ? "Reset topstock counts" : "Yes, reset audit"
        }
        danger
        onClose={() => setResetStep(0)}
        onConfirm={() => void confirmReset()}
      />

      <section
        aria-label="Appliance audit actions"
        className="space-y-2"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            disabled={disabled || !hasScans || busy != null}
            onClick={() => void handleShareExport()}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-950/30 px-2 text-xs font-bold text-sky-100 disabled:opacity-40 sm:text-sm"
          >
            {busy === "export" ? "…" : "📤 Share / Export CSV"}
          </button>
          <button
            type="button"
            disabled={disabled || !hasScans || busy != null}
            onClick={handleEmail}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-950/30 px-2 text-xs font-bold text-violet-100 disabled:opacity-40 sm:text-sm"
          >
            ✉️ Send Email
          </button>
          <button
            type="button"
            disabled={disabled || !hasScans || busy != null}
            onClick={() => {
              const csv = applianceScansToCsv(scans, csvOptions);
              void navigator.clipboard?.writeText(csv);
              onStatus("Full CSV copied to clipboard");
            }}
            className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-zinc-600 bg-zinc-950/50 px-2 text-xs font-bold text-zinc-200 disabled:opacity-40 sm:col-span-1 sm:text-sm"
          >
            Copy CSV
          </button>
          <button
            type="button"
            disabled={disabled || !hasScans || busy != null}
            onClick={() => setResetStep(1)}
            className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/30 px-2 text-xs font-bold text-rose-100 disabled:opacity-40 sm:col-span-1 sm:text-sm"
          >
            {busy === "reset" ? "…" : "🗑️ Reset Audit Session"}
          </button>
        </div>

        <button
          type="button"
          disabled={disabled || showroomCount === 0 || busy != null}
          onClick={() => void handleLockBaseline()}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/25 px-3 text-xs font-bold text-amber-100 disabled:opacity-40 sm:text-sm"
        >
          {busy === "lock" ? "…" : "🔒 Lock Showroom Baseline"}
          {baselineCount > 0 ? (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] text-amber-200">
              {baselineCount} locked
            </span>
          ) : null}
        </button>
      </section>
    </>
  );
}
