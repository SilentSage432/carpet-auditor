"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateRotationsBatch,
  fetchStoreScheduleSettings,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import { playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import type { Department } from "@/lib/store-ops/types";
import { formatSundayStageTimeDisplay } from "@/lib/store-ops/sunday-schedule";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  departments: Department[];
  initialDepartmentId?: string;
  onForced: () => void;
};

function formatSelectionSummary(selectedCount: number, totalCount: number): string {
  if (selectedCount === 0) return "No departments selected";
  if (selectedCount === totalCount) {
    return `All Departments (${totalCount})`;
  }
  return `${selectedCount} Department${selectedCount === 1 ? "" : "s"} Selected`;
}

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
  const [selectedDeptIds, setSelectedDeptIds] = useState<Set<string>>(
    () => new Set()
  );
  const [deptPickerOpen, setDeptPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [genCount, setGenCount] = useState("10");
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [cronLine, setCronLine] = useState("Loading schedule…");

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.is_active !== false),
    [departments]
  );
  const deptOptions =
    activeDepartments.length > 0 ? activeDepartments : departments;

  const selectedCount = selectedDeptIds.size;
  const selectionSummary = formatSelectionSummary(selectedCount, deptOptions.length);

  useEffect(() => {
    if (!open) return;
    const defaultIds = deptOptions.map((d) => d.id);
    if (initialDepartmentId && defaultIds.includes(initialDepartmentId)) {
      setSelectedDeptIds(new Set([initialDepartmentId]));
    } else {
      setSelectedDeptIds(new Set(defaultIds));
    }
    setDeptPickerOpen(false);
    setGenMsg(null);
    setGenError(null);
    let cancelled = false;
    void fetchStoreScheduleSettings(specialist)
      .then((settings) => {
        if (cancelled) return;
        const auto = settings.sunday_auto_generate
          ? `Active · ${formatSundayStageTimeDisplay(settings.sunday_auto_stage_time)} ${settings.timezone}`
          : "Disabled";
        setCronLine(
          `Automated Cron: ${auto} · Staging week ${settings.staging_week}`
        );
      })
      .catch(() => {
        if (!cancelled) setCronLine("Automated Cron: schedule unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialDepartmentId, deptOptions, specialist]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (deptPickerOpen) {
          setDeptPickerOpen(false);
          return;
        }
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, deptPickerOpen]);

  useEffect(() => {
    if (!deptPickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) {
        setDeptPickerOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [deptPickerOpen]);

  if (!open) return null;

  function toggleDepartment(id: string) {
    setSelectedDeptIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllDepartments() {
    setSelectedDeptIds(new Set(deptOptions.map((d) => d.id)));
  }

  function clearAllDepartments() {
    setSelectedDeptIds(new Set());
  }

  async function handleForceDraw() {
    if (selectedDeptIds.size === 0) return;
    setGenBusy(true);
    setGenMsg(null);
    setGenError(null);
    try {
      const result = await generateRotationsBatch(
        specialist,
        Array.from(selectedDeptIds),
        Number(genCount),
        { force: true }
      );

      if (result.success_count === 0) {
        const firstFailure = result.failures?.[0]?.error;
        setGenError(
          firstFailure ||
            readableError(
              null,
              "Force draw failed — map PENDING bays first, then retry"
            )
        );
        playErrorTone();
        return;
      }

      const deptLabel =
        result.success_count === 1 ? "department" : "departments";
      let message = `Successfully staged ${result.staged_bays} bay${
        result.staged_bays === 1 ? "" : "s"
      } across ${result.success_count} ${deptLabel}.`;

      if (result.failed_count > 0) {
        message += ` ${result.failed_count} department${
          result.failed_count === 1 ? "" : "s"
        } could not be staged.`;
      }

      if (result.assigned_week) {
        message = `Week ${result.assigned_week}: ${message}`;
      }

      setGenMsg(message);
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
              Generate this week&apos;s list
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
          {cronLine}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Force Draw replaces incomplete bays for the staging week. The scheduled
          runner will not overwrite a week that is already staged.
        </p>

        <div className="mt-4 space-y-3">
          <div ref={pickerRef} className="relative block text-sm">
            <span className="glass-label mb-1 block">Departments</span>
            <button
              type="button"
              aria-expanded={deptPickerOpen}
              aria-haspopup="listbox"
              onClick={() => setDeptPickerOpen((open) => !open)}
              className="glass-input flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-sm font-semibold"
            >
              <span className="inline-flex min-h-7 items-center rounded-full border border-amber-400/40 bg-amber-950/40 px-2.5 font-mono text-[11px] font-bold tracking-tight text-amber-100">
                {selectionSummary}
              </span>
              <span className="text-zinc-400" aria-hidden>
                {deptPickerOpen ? "▴" : "▾"}
              </span>
            </button>

            {deptPickerOpen ? (
              <div
                role="listbox"
                aria-multiselectable="true"
                aria-label="Select departments"
                className="absolute left-0 right-0 z-[82] mt-2 max-h-64 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-md"
              >
                <div className="mb-2 flex gap-2 border-b border-zinc-800 pb-2">
                  <button
                    type="button"
                    onClick={selectAllDepartments}
                    className="flex min-h-9 flex-1 items-center justify-center rounded-lg border border-zinc-700 px-2 text-xs font-semibold text-zinc-200"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearAllDepartments}
                    className="flex min-h-9 flex-1 items-center justify-center rounded-lg border border-zinc-700 px-2 text-xs font-semibold text-zinc-200"
                  >
                    Clear All
                  </button>
                </div>

                <ul className="space-y-1">
                  {deptOptions.map((d) => {
                    const checked = selectedDeptIds.has(d.id);
                    return (
                      <li key={d.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-zinc-900/80">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDepartment(d.id)}
                            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-amber-500"
                          />
                          <span className="text-sm font-medium text-zinc-100">
                            {d.name}
                            {d.is_active === false ? " (paused)" : ""}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>

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
            disabled={genBusy || selectedDeptIds.size === 0}
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
