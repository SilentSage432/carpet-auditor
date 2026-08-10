"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  formatLocationLabel,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import { completeRotation } from "@/lib/store-ops/client";

type Props = {
  specialist: StoreSpecialist;
  assignedWeek: string;
  rotations: WeeklyRotationWithLocation[];
  onRefresh: () => void;
};

export function WeeklyRotationList({
  specialist,
  assignedWeek,
  rotations,
  onRefresh,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    rotations,
    (current, completedId: string) =>
      current.map((r) =>
        r.id === completedId
          ? {
              ...r,
              is_completed: true,
              completed_at: new Date().toISOString(),
            }
          : r
      )
  );

  const open = optimistic.filter((r) => !r.is_completed);
  const done = optimistic.filter((r) => r.is_completed);

  function handleCheck(rotationId: string) {
    setError(null);
    startTransition(async () => {
      setOptimistic(rotationId);
      try {
        await completeRotation(specialist, rotationId);
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not complete bay");
        onRefresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-400">
          This Week&apos;s Assigned Rotation
        </p>
        <p className="mt-1 font-mono text-lg font-bold text-slate-50">
          {assignedWeek || "No week assigned"}
        </p>
        <p className="text-sm text-slate-400">
          {open.length} remaining · {done.length} complete
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {open.length === 0 && done.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
          No bays assigned this week. Ask Master Admin to generate the weekly
          rotation.
        </p>
      ) : null}

      <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90">
        {open.map((rotation) => {
          const loc = rotation.store_locations;
          const label = loc
            ? formatLocationLabel(loc)
            : `Location ${rotation.location_id.slice(0, 8)}`;
          return (
            <li key={rotation.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 active:bg-slate-800/60">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => handleCheck(rotation.id)}
                  className="h-6 w-6 shrink-0 accent-emerald-500"
                  aria-label={`Mark complete: ${label}`}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold text-slate-50">
                  {label}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {done.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
          <button
            type="button"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((o) => !o)}
            className="flex min-h-11 w-full items-center justify-between px-3 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
          >
            Completed ({done.length}) · cool-down locked
            <span aria-hidden>{doneOpen ? "▲" : "▼"}</span>
          </button>
          {doneOpen ? (
            <ul className="divide-y divide-slate-800 border-t border-slate-800 opacity-60">
              {done.map((rotation) => {
                const loc = rotation.store_locations;
                const label = loc
                  ? formatLocationLabel(loc)
                  : rotation.location_id.slice(0, 8);
                return (
                  <li
                    key={rotation.id}
                    className="flex min-h-10 items-center gap-3 px-3 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked
                      disabled
                      readOnly
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span className="truncate font-mono text-sm text-slate-400 line-through">
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
