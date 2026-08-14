"use client";

/**
 * Supervisor personal weekly audit rollup.
 * Composes audit-summary.ts; presentation only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  composeWeeklyAuditRollup,
  formatWeeklyAuditRollupText,
} from "@/lib/store-ops/audit-summary";
import {
  fetchExceptionSummary,
  fetchStoreHealth,
  fetchThisWeekRotations,
} from "@/lib/store-ops/client";
import { fetchSundayAssignments } from "@/lib/store-ops/sunday-audit";
import { hoursBySpecialistId, readShiftRoster } from "@/lib/store-ops/weekly-rotations";
import { getStoreNumber } from "@/lib/store";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  specialist: StoreSpecialist;
  assignedWeek?: string;
  onClose: () => void;
};

export function SupervisorAuditSummaryModal({
  open,
  specialist,
  assignedWeek,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollup, setRollup] = useState<ReturnType<
    typeof composeWeeklyAuditRollup
  > | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [health, weekData, exceptions] = await Promise.all([
        fetchStoreHealth(specialist, assignedWeek),
        fetchThisWeekRotations(specialist),
        fetchExceptionSummary(specialist, assignedWeek).catch(() => ({
          exceptions: [] as Array<{ bay_id: string }>,
        })),
      ]);
      const week = assignedWeek || weekData.assigned_week || health.assigned_week;
      const assignments = week
        ? await fetchSundayAssignments(week, getStoreNumber()).catch(() => ({}))
        : {};
      const hours = week
        ? hoursBySpecialistId(readShiftRoster(week, getStoreNumber()))
        : {};
      setRollup(
        composeWeeklyAuditRollup({
          week,
          health,
          rotations: weekData.rotations ?? [],
          assignments,
          shiftHours: hours,
          exceptionLocationIds: (exceptions.exceptions ?? []).map(
            (row) => row.bay_id
          ),
        })
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load weekly rollup"
      );
      setRollup(null);
    } finally {
      setBusy(false);
    }
  }, [specialist, assignedWeek]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const copyText = useMemo(
    () => (rollup ? formatWeeklyAuditRollupText(rollup) : ""),
    [rollup]
  );

  async function copyStats() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard copy failed");
    }
  }

  if (!open) return null;

  const quotaDenom = Math.max(1, rollup?.quota ?? 1);
  const pct = rollup?.completion_pct ?? 0;

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close weekly rollup"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-rollup-title"
        className="glass-card relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 border-emerald-500/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
              Supervisor rollup
            </p>
            <h2 id="weekly-rollup-title" className="glass-title mt-1 text-lg">
              Weekly audit summary
            </h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              {rollup?.assigned_week || assignedWeek || "This week"}
              {rollup?.department_name ? ` · ${rollup.department_name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-zinc-700 text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error ? (
          <p className="mb-3 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {busy && !rollup ? (
          <p className="text-sm text-zinc-400">Composing this week&apos;s stats…</p>
        ) : rollup ? (
          <div className="space-y-4">
            <section className="rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-3 py-3">
              <p className="text-sm font-semibold text-zinc-100">
                {rollup.completed}/{rollup.quota} bays vs weekly quota
              </p>
              <p className="mt-0.5 font-mono text-xs text-zinc-400">
                Assigned {rollup.assigned} · remaining {rollup.remaining} · {pct}%
              </p>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{
                    width: `${Math.min(100, Math.round((rollup.completed / quotaDenom) * 100))}%`,
                  }}
                />
              </div>
            </section>

            <section>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                By associate / shift
              </p>
              {rollup.associates.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-400">
                  No Sunday assignments this week. Completions stay unassigned
                  rather than guessed.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
                  {rollup.associates.map((row) => (
                    <li
                      key={row.specialist_id}
                      className="flex min-h-11 items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm text-zinc-100">
                        {row.specialist_name}
                        {row.shift_hours ? (
                          <span className="ml-1 font-mono text-[10px] text-amber-200/90">
                            {row.shift_hours}h
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-zinc-400">
                        {row.completed}/{row.assigned}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {rollup.unassigned.assigned > 0 ? (
                <p className="mt-2 font-mono text-xs text-zinc-500">
                  Unassigned {rollup.unassigned.completed}/
                  {rollup.unassigned.assigned} complete
                </p>
              ) : null}
            </section>

            <section className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                  Resolved barriers
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-emerald-100">
                  {rollup.resolved_barriers}
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                  Open barriers
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-amber-100">
                  {rollup.open_barriers}
                </p>
              </div>
            </section>

            <button
              type="button"
              onClick={() => void copyStats()}
              className="btn-primary-glow flex min-h-14 w-full items-center justify-center rounded-xl text-sm"
            >
              {copied ? "Copied" : "Copy weekly stats"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
