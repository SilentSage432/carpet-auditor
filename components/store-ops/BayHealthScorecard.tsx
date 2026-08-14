"use client";

/**
 * Compact bay-health badge for the Zebra checklist.
 * Diagnostics owned by lib/store-ops/bay-health; this only renders.
 */

import { useMemo, useState } from "react";
import {
  BAY_STALE_DAYS,
  type BayHealthFlag,
  type BayHealthScorecard,
} from "@/lib/store-ops/bay-health";

type Props = {
  card: BayHealthScorecard;
};

function flagLabel(flag: BayHealthFlag): string {
  if (flag === "stale") return `>${BAY_STALE_DAYS}d stale`;
  if (flag === "never_audited") return "Never completed";
  if (flag === "topstock_uninventoried") return "Topstock not inventoried";
  return "SIMS mismatch";
}

export function BayHealthScorecard({ card }: Props) {
  const [open, setOpen] = useState(false);
  const toneClass =
    card.tone === "alert"
      ? "border-rose-400/50 bg-rose-950/35 text-rose-100"
      : card.tone === "watch"
        ? "border-amber-400/50 bg-amber-950/30 text-amber-100"
        : "border-emerald-500/40 bg-emerald-950/30 text-emerald-100";

  const summary = useMemo(() => {
    const bits: string[] = [];
    if (card.staleCount) bits.push(`${card.staleCount} stale`);
    if (card.neverAuditedCount) bits.push(`${card.neverAuditedCount} never`);
    if (card.topstockGapCount) bits.push(`${card.topstockGapCount} topstock`);
    if (card.simsMismatchCount) bits.push(`${card.simsMismatchCount} SIMS`);
    if (bits.length === 0) return "All assigned bays current";
    return bits.join(" · ");
  }, [card]);

  return (
    <div className={`overflow-hidden rounded-2xl border ${toneClass}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left"
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] opacity-80">
          Bay Health
        </span>
        <span className="font-mono text-lg font-bold tabular-nums">
          {card.score}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-90">
          {summary}
          {card.troubleAisleCount > 0
            ? ` · Aisle ${card.troubleAisles.slice(0, 3).join(", ")}`
            : ""}
        </span>
        <span aria-hidden className="text-[10px] opacity-70">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <ul className="space-y-1.5 border-t border-white/10 px-4 py-3 text-xs">
          {card.findings.length === 0 ? (
            <li>No aging or SIMS gaps on this week&apos;s assigned bays.</li>
          ) : (
            card.findings.slice(0, 8).map((row) => (
              <li key={row.rotationId} className="flex flex-wrap gap-x-2">
                <span className="font-mono font-semibold">
                  A{row.aisle} B{row.bay}
                </span>
                <span className="opacity-70">{row.type}</span>
                <span>
                  {row.flags.map(flagLabel).join(" · ")}
                  {row.ageDays != null ? ` · ${row.ageDays}d` : ""}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
