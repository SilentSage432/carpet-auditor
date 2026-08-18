"use client";

/**
 * Appliance SIMS / placard checklist — presentation only.
 * Completions still go through completeRotation; scans stay in appliance-scans.
 */

import { useEffect, useMemo, useState } from "react";
import { composeSimsReconciliation } from "@/lib/appliances/sims-reconciliation";
import { formatBayTag } from "@/lib/store-ops/types";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

type StepId = "placards" | "scan" | "sims" | "confirm";

type Props = {
  rotation: WeeklyRotationWithLocation;
  scanCount: number;
  scans: ApplianceScan[];
  catalog: ApplianceCatalogItem[];
  busy?: boolean;
  onScanBay: () => void;
  onComplete: () => void;
};

const STORAGE_PREFIX = "deptsync_sims_checklist_";

function loadSteps(rotationId: string): Record<StepId, boolean> {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${rotationId}`);
    if (!raw) {
      return { placards: false, scan: false, sims: false, confirm: false };
    }
    const parsed = JSON.parse(raw) as Partial<Record<StepId, boolean>>;
    return {
      placards: Boolean(parsed.placards),
      scan: Boolean(parsed.scan),
      sims: Boolean(parsed.sims),
      confirm: Boolean(parsed.confirm),
    };
  } catch {
    return { placards: false, scan: false, sims: false, confirm: false };
  }
}

export function ApplianceSimsChecklist({
  rotation,
  scanCount,
  scans,
  catalog,
  busy = false,
  onScanBay,
  onComplete,
}: Props) {
  const loc = rotation.store_locations;
  const tag = loc ? formatBayTag(loc) : "Bay";
  const [steps, setSteps] = useState<Record<StepId, boolean>>(() =>
    loadSteps(rotation.id)
  );

  useEffect(() => {
    setSteps(loadSteps(rotation.id));
  }, [rotation.id]);

  useEffect(() => {
    if (scanCount > 0 && !steps.scan) {
      setSteps((prev) => ({ ...prev, scan: true }));
    }
  }, [scanCount, steps.scan]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        `${STORAGE_PREFIX}${rotation.id}`,
        JSON.stringify(steps)
      );
    } catch {
      /* ignore */
    }
  }, [rotation.id, steps]);

  const recon = useMemo(
    () => composeSimsReconciliation({ scans, catalog }),
    [scans, catalog]
  );

  const ready =
    steps.placards && steps.scan && steps.sims && steps.confirm && !busy;

  function toggle(id: StepId) {
    setSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <li className="rounded-xl border border-cyan-500/35 bg-cyan-950/20 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold tracking-tight text-zinc-50">
            {tag}
            {loc?.type ? ` · ${loc.type}` : ""}
          </p>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-cyan-300">
            Appliance SIMS / Placard
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-cyan-400/40 bg-cyan-950/50 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-100">
          {scanCount} carton{scanCount === 1 ? "" : "s"} scanned in Bay{" "}
          {loc?.bay ?? "—"}
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        <li>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-1">
            <input
              type="checkbox"
              checked={steps.placards}
              onChange={() => toggle("placards")}
              className="mt-1 h-5 w-5 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="text-sm text-zinc-100">
              Step 1: Verify bay placards &amp; aisle markers
            </span>
          </label>
        </li>
        <li>
          <div className="flex items-start gap-2 rounded-lg px-1">
            <input
              type="checkbox"
              checked={steps.scan}
              onChange={() => toggle("scan")}
              className="mt-1 h-5 w-5 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-100">
                Step 2: Scan bay units
              </p>
              <button
                type="button"
                onClick={onScanBay}
                className="mt-1 flex min-h-10 w-full items-center justify-center rounded-xl border border-cyan-400/50 bg-cyan-600/90 px-3 text-sm font-bold text-zinc-950"
              >
                Open continuous scanner
              </button>
            </div>
          </div>
        </li>
        <li>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-1">
            <input
              type="checkbox"
              checked={steps.sims}
              onChange={() => toggle("sims")}
              className="mt-1 h-5 w-5 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-zinc-100">
                Step 3: SIMS reconciliation check
              </span>
              {recon.flags.length === 0 ? (
                <span className="mt-1 block text-xs text-emerald-200">
                  {recon.scanned_count} unit{recon.scanned_count === 1 ? "" : "s"} scanned — no catalog/serial flags.
                </span>
              ) : (
                <ul className="mt-1 space-y-0.5 text-xs text-amber-200">
                  {recon.flags.slice(0, 6).map((flag, index) => (
                    <li key={`${flag.code}-${flag.item_number ?? index}`}>
                      {flag.message}
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </label>
        </li>
        <li>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-1">
            <input
              type="checkbox"
              checked={steps.confirm}
              onChange={() => toggle("confirm")}
              className="mt-1 h-5 w-5 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="text-sm text-zinc-100">
              Step 4: Confirm placard accuracy / correct discrepancies
            </span>
          </label>
        </li>
      </ol>

      <button
        type="button"
        disabled={!ready}
        onClick={onComplete}
        className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/90 px-3 text-sm font-bold text-zinc-950 disabled:opacity-40"
      >
        {busy ? "Submitting…" : "Complete & Submit for DS Verification"}
      </button>
    </li>
  );
}
