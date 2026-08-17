"use client";

/**
 * Compact bay freshness chip + expandable grid.
 * Knowledge/composition: lib/heatmap/bay-tracker.ts
 */

import { useEffect, useMemo, useState } from "react";
import { Flame, Layers } from "lucide-react";
import {
  composeBayFreshness,
  readBayTouches,
  subscribeBayTouches,
  type BayFreshnessCell,
  type BayFreshnessTone,
} from "@/lib/heatmap/bay-tracker";
import { getStoreNumber } from "@/lib/store";
import type { StoreLocation } from "@/lib/store-ops/types";

type LocationLike = Pick<
  StoreLocation,
  "id" | "aisle" | "bay" | "last_serviced_at" | "last_completed_at"
>;

type Props = {
  locations: LocationLike[];
  refreshKey?: number | string;
};

const TONE_CLASS: Record<BayFreshnessTone, string> = {
  fresh: "bg-emerald-500 text-emerald-950",
  warm: "bg-amber-400 text-amber-950",
  stale: "bg-rose-600 text-rose-50",
};

const TONE_DOT: Record<BayFreshnessTone, string> = {
  fresh: "bg-emerald-400",
  warm: "bg-amber-400",
  stale: "bg-rose-500",
};

function CellChip({ cell }: { cell: BayFreshnessCell }) {
  return (
    <span
      title={`${cell.location_tag} · ${
        cell.age_days == null ? "never touched" : `${cell.age_days}d`
      }`}
      className={`inline-flex min-h-8 items-center rounded-md px-1.5 font-mono text-[10px] font-bold tracking-tight tabular-nums ${TONE_CLASS[cell.tone]}`}
    >
      {cell.location_tag.replace(/^Aisle\s+/i, "A").replace(/^Bay\s+/i, "B")}
    </span>
  );
}

export function BayFreshnessGrid({ locations, refreshKey }: Props) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribeBayTouches(() => setTick((n) => n + 1));
  }, []);

  const summary = useMemo(() => {
    void tick;
    void refreshKey;
    return composeBayFreshness({
      locations,
      overlay: readBayTouches(getStoreNumber()),
    });
  }, [locations, refreshKey, tick]);

  if (summary.cells.length === 0) return null;

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-950/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Flame
          className={`h-4 w-4 shrink-0 ${
            summary.staleCount > 0 ? "text-rose-400" : "text-emerald-400"
          }`}
          strokeWidth={1.75}
        />
        <span className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-zinc-100">
          {summary.headline}
        </span>
        <Layers className="h-4 w-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
      </button>

      <div className="flex gap-2 border-t border-zinc-800/80 px-3 py-1.5">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-300">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT.fresh}`} />
          Fresh {summary.freshCount}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-amber-300">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT.warm}`} />
          Warm {summary.warmCount}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-300">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT.stale}`} />
          Stale {summary.staleCount}
        </span>
      </div>

      {open ? (
        <div className="flex flex-wrap gap-1.5 border-t border-zinc-800/80 px-3 py-2.5">
          {summary.cells.slice(0, 48).map((cell) => (
            <CellChip key={cell.key} cell={cell} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
