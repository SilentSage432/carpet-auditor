"use client";

/**
 * Compact on-duty specialist pills for Floor.
 * Presentation only — workload counts come from composeOnDutyBayWorkload.
 */

import { Clock, UserCheck, Users } from "lucide-react";
import { formatCompactShiftRange } from "@/lib/store-ops/shift-status";
import type { OnDutyWorkloadGroup } from "@/lib/store-ops/weekly-rotations";

const ICON_STROKE = 1.75;

type Props = {
  groups: OnDutyWorkloadGroup[];
  selectedId: string | "all";
  onSelect: (id: string | "all") => void;
  loading?: boolean;
};

function givenName(name: string): string {
  const base = name.split(" · ")[0]?.trim() || name;
  return base.split(/\s+/)[0] || base;
}

export function OnDutyAssociateStrip({
  groups,
  selectedId,
  onSelect,
  loading = false,
}: Props) {
  const totalBays = groups.reduce((sum, group) => sum + group.rotationIds.length, 0);

  return (
    <section className="mb-3" aria-label="On-duty associates">
      <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        On duty today
      </p>
      {loading && groups.length === 0 ? (
        <p className="text-sm text-zinc-400">Loading today&apos;s specialists…</p>
      ) : groups.length === 0 ? (
        <p className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-zinc-700 px-3 text-sm text-zinc-400">
          <Clock className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
          No associates on duty for this department today
        </p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            type="button"
            onClick={() => onSelect("all")}
            className={`chip-filter inline-flex shrink-0 items-center gap-1.5 rounded-full ${
              selectedId === "all"
                ? "border-cyan-400/55 bg-cyan-950/45 text-cyan-100"
                : "border-slate-700 text-slate-300"
            }`}
          >
            <Users className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden />
            All · {totalBays} {totalBays === 1 ? "Bay" : "Bays"}
          </button>
          {groups.map((group) => {
            const count = group.rotationIds.length;
            const hours = formatCompactShiftRange(group.start, group.end);
            const selected = selectedId === group.specialist_id;
            return (
              <button
                key={group.specialist_id}
                type="button"
                onClick={() => onSelect(group.specialist_id)}
                className={`chip-filter inline-flex shrink-0 items-center gap-1.5 rounded-full ${
                  selected
                    ? "border-cyan-400/55 bg-cyan-950/45 text-cyan-100"
                    : "border-slate-700 text-slate-300"
                }`}
              >
                <UserCheck
                  className={`h-3.5 w-3.5 ${
                    selected ? "text-emerald-300" : "text-emerald-400/80"
                  }`}
                  strokeWidth={ICON_STROKE}
                  aria-hidden
                />
                {givenName(group.specialist_name)} ({hours}) · {count}{" "}
                {count === 1 ? "Bay" : "Bays"}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
