"use client";

/**
 * RD-4 — weekly command summary strip.
 * Answers planned / assigned / completed evidence / remaining from real plan.
 * Does not treat assignment as proof of work.
 */

import type { ThisWeekCommandSummary } from "@/lib/store-ops/this-week-ownership";

type Props = {
  summary: ThisWeekCommandSummary;
  loading?: boolean;
};

function Stat({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: number | string;
  hint?: string;
  emphasize?: "amber" | "emerald" | "zinc";
}) {
  const valueTone =
    emphasize === "amber"
      ? "text-amber-100"
      : emphasize === "emerald"
        ? "text-emerald-100"
        : "text-zinc-50";
  return (
    <div
      className="min-w-0 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2"
      data-testid={`week-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${valueTone}`}>
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function ThisWeekCommandSummaryCard({
  summary,
  loading = false,
}: Props) {
  if (loading && !summary.hasPlan) {
    return (
      <section
        className="rounded-2xl border border-zinc-800/90 bg-zinc-950/70 px-3 py-3"
        data-testid="this-week-command-summary"
      >
        <p className="text-sm text-zinc-500">Loading week evidence…</p>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70"
      data-testid="this-week-command-summary"
      aria-label="This week command summary"
    >
      <header className="border-b border-zinc-800/80 px-3 py-2.5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
          Weekly command
          {summary.weekLabel ? ` · ${summary.weekLabel}` : ""}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-zinc-100">
          {summary.hasPlan
            ? summary.headline
            : "No staged plan for this week yet"}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-zinc-500">
          Shared planning model: {summary.sharedCapacitySlots} ×{" "}
          {summary.baysPerPerson} = {summary.sharedCapacityBays} when four
          associates are eligible. Sunday stages eligible ×{" "}
          {summary.baysPerPerson} (not a fixed {summary.sharedCapacityBays}
          -bay lock). One pool across Flooring and Home Decor.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-4">
        <Stat
          label="Planned"
          value={summary.plannedBayCount}
          hint="Staged for the week"
        />
        <Stat
          label="Assigned"
          value={summary.assignedBayCount}
          hint={
            summary.unassignedBayCount > 0
              ? `${summary.unassignedBayCount} still unowned`
              : "Owners named"
          }
          emphasize={summary.unassignedBayCount > 0 ? "amber" : "zinc"}
        />
        <Stat
          label="Verified"
          value={summary.verifiedCount}
          hint={
            summary.reportedCompleteCount > summary.verifiedCount
              ? `${summary.reportedCompleteCount - summary.verifiedCount} reported, not verified`
              : "Operator accepted"
          }
          emphasize="emerald"
        />
        <Stat
          label="Remaining"
          value={summary.remainingBayCount}
          hint={
            summary.awaitingVerificationCount > 0
              ? `${summary.awaitingVerificationCount} awaiting verify`
              : summary.barrierBayCount > 0
                ? `${summary.barrierBayCount} barrier`
                : "Still open"
          }
          emphasize={summary.remainingBayCount > 0 ? "amber" : "emerald"}
        />
      </div>

      <p
        className="border-t border-zinc-800/80 px-3 py-2 text-[10px] leading-snug text-zinc-500"
        data-testid="week-summary-evidence-note"
      >
        Assignment names responsibility. Reported and verified counts are
        completion evidence — a scheduled bay is not proof that work occurred.
      </p>
    </section>
  );
}
