"use client";

import { useEffect, useState } from "react";
import { generateRotations } from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import { playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import type { Department } from "@/lib/store-ops/types";
import { isoWeekLabel } from "@/lib/store-ops/week";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  departments: Department[];
  initialDepartmentId?: string;
  onForced: () => void;
};

/**
 * Manual override for the weekly rotation engine.
 * Opened from Super Admin "Trigger Weekly Rotation".
 */
export function ForceRotationModal({
  open,
  onClose,
  specialist,
  departments,
  initialDepartmentId,
  onForced,
}: Props) {
  const [genDept, setGenDept] = useState(initialDepartmentId || "");
  const [genCount, setGenCount] = useState("10");
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const currentWeek = isoWeekLabel();

  useEffect(() => {
    if (!open) return;
    setGenDept((current) => current || initialDepartmentId || departments[0]?.id || "");
    setGenMsg(null);
    setGenError(null);
  }, [open, initialDepartmentId, departments]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeDepartments = departments.filter((d) => d.is_active !== false);
  const deptOptions =
    activeDepartments.length > 0 ? activeDepartments : departments;

  async function handleForceDraw() {
    if (!genDept) return;
    setGenBusy(true);
    setGenMsg(null);
    setGenError(null);
    try {
      const result = await generateRotations(
        specialist,
        genDept,
        Number(genCount)
      );
      setGenMsg(
        `Week ${result.assigned_week}: assigned ${result.created} bay${
          result.created === 1 ? "" : "s"
        }${result.cycle_reset ? " (new cycle started)" : ""}.`
      );
      onForced();
      playSuccessTone();
    } catch (err) {
      setGenError(
        readableError(
          err,
          "Force draw failed — map PENDING bays first, then retry"
        )
      );
      playErrorTone();
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="force-rotation-title"
        className="relative z-[81] w-full max-w-md glass-card rounded-t-2xl !rounded-b-none border-amber-500/40 p-5 sm:!rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
              Weekly Rotation Engine
            </p>
            <h2
              id="force-rotation-title"
              className="glass-title mt-1 text-lg"
            >
              Trigger Weekly Rotation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-zinc-700 text-zinc-300"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <p className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          Automated Cron: Active · Last Draw: Current ISO Week ({currentWeek})
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Automated rotation runs weekly on schedule. Use this panel for manual
          overrides or initial department setup.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="glass-label mb-1 block">Department</span>
            <select
              value={genDept}
              onChange={(e) => setGenDept(e.target.value)}
              className="glass-input min-h-[44px] text-sm font-semibold"
            >
              {deptOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.is_active === false ? " (paused)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="glass-label mb-1 block">Bay count</span>
            <input
              type="number"
              min={1}
              value={genCount}
              onChange={(e) => setGenCount(e.target.value)}
              className="glass-input min-h-[44px] font-mono text-sm font-semibold"
            />
          </label>
          <button
            type="button"
            disabled={genBusy || !genDept}
            onClick={handleForceDraw}
            className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/90 px-4 text-base font-bold text-zinc-950 shadow-lg shadow-amber-950/40 disabled:opacity-50"
          >
            {genBusy ? "Drawing…" : "Force Draw New Rotation"}
          </button>
        </div>

        {genMsg ? (
          <p className="mt-3 text-sm text-amber-200" role="status">
            {genMsg}
          </p>
        ) : null}
        {genError ? (
          <p className="mt-3 text-sm font-medium text-red-300" role="alert">
            {genError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
