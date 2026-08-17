"use client";

/**
 * Floor predictive briefing — presentation for copilot recommendations.
 * Knowledge/composition lives in lib/store-ops/predictive-copilot.ts.
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import {
  applyCopilotAction,
  composePredictiveCopilot,
  type CopilotRecommendation,
} from "@/lib/store-ops/predictive-copilot";
import { yieldToMain } from "@/lib/store-ops/velocity";
import { canManageShiftBoard } from "@/lib/rbac";
import { getStoreNumber } from "@/lib/store";
import { localWorkDate } from "@/lib/store-ops/shift-status";
import { toastError, toastSuccess } from "@/lib/toast";
import type { StoreSpecialist } from "@/lib/types";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";

type Props = {
  specialist: StoreSpecialist;
  week: string;
  rotations: WeeklyRotationWithLocation[];
  departmentId: string | null;
  refreshKey?: number | string;
  onApplied?: () => void;
};

function dismissKey(store: string, date: string): string {
  return `deptsync_copilot_dismiss:${store}:${date}`;
}

export function PredictiveCopilotBanner({
  specialist,
  week,
  rotations,
  departmentId,
  refreshKey,
  onApplied,
}: Props) {
  const [recs, setRecs] = useState<CopilotRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const canStage = canManageShiftBoard(specialist);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await yieldToMain();
      const next = await composePredictiveCopilot({
        specialist,
        week,
        rotations,
        departmentId,
      });
      setRecs(next);
    } catch {
      setRecs([]);
    } finally {
      setLoading(false);
    }
  }, [specialist, week, rotations, departmentId]);

  useEffect(() => {
    const store = getStoreNumber();
    const date = localWorkDate();
    try {
      setDismissed(
        Boolean(store && window.localStorage.getItem(dismissKey(store, date)))
      );
    } catch {
      setDismissed(false);
    }
  }, [refreshKey]);

  useEffect(() => {
    let idleId = 0;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void load();
    };
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(run, { timeout: 120 });
    } else {
      idleId = window.setTimeout(run, 0);
    }
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [load, refreshKey]);

  function dismiss() {
    const store = getStoreNumber();
    const date = localWorkDate();
    try {
      if (store) window.localStorage.setItem(dismissKey(store, date), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  async function run(rec: CopilotRecommendation) {
    if (rec.action !== "downstock" && !canStage) {
      toastError("Ask a supervisor to stage those bays onto the shift");
      return;
    }
    setBusyId(rec.id);
    const previous = recs;
    setRecs((curr) => curr.filter((row) => row.id !== rec.id));
    try {
      const message = await applyCopilotAction(specialist, week, rec);
      toastSuccess(message);
      onApplied?.();
    } catch (err) {
      setRecs(previous);
      toastError(
        err instanceof Error ? err.message : "Could not apply that action"
      );
    } finally {
      setBusyId(null);
    }
  }

  if (dismissed || loading || recs.length === 0) return null;

  return (
    <section className="glass-card mb-3 border-amber-500/30 !p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
            Predictive copilot
          </p>
          <p className="mt-0.5 text-sm text-zinc-400">
            High-impact shift suggestions from walk logs, carry-over, and pace.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="btn-icon-touch text-zinc-400"
          aria-label="Dismiss copilot for today"
        >
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <ul className="space-y-2">
        {recs.map((rec) => (
          <li
            key={rec.id}
            className="rounded-xl border border-zinc-800 bg-zinc-950/55 px-3 py-2.5"
          >
            <p className="text-sm font-semibold text-zinc-100">{rec.title}</p>
            <p className="mt-0.5 font-mono text-[11px] tracking-tight text-zinc-500">
              {rec.detail}
            </p>
            <button
              type="button"
              disabled={busyId === rec.id}
              onClick={() => void run(rec)}
              className="btn-primary-glow mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {busyId === rec.id ? "Applying…" : rec.actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
