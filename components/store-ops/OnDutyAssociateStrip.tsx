"use client";

/**
 * Compact on-duty specialist pills for Floor.
 * Presentation only — workload counts come from composeOnDutyBayWorkload.
 * Storewide views with more than 6 associates collapse to a summary sheet.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, UserCheck, Users, X } from "lucide-react";
import { formatCompactShiftRange } from "@/lib/store-ops/shift-status";
import type { OnDutyWorkloadGroup } from "@/lib/store-ops/weekly-rotations";

const ICON_STROKE = 1.75;
const STOREWIDE_PILL_LIMIT = 6;

type Props = {
  groups: OnDutyWorkloadGroup[];
  selectedId: string | "all";
  onSelect: (id: string | "all") => void;
  loading?: boolean;
  /** Full-store pin — collapse the strip when the roster is long. */
  storewide?: boolean;
  /** Hide inline pills — use with controlled sheet (Floor top rail). */
  hideStrip?: boolean;
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
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
  storewide = false,
  hideStrip = false,
  sheetOpen: sheetOpenProp,
  onSheetOpenChange,
}: Props) {
  const [sheetOpenInternal, setSheetOpenInternal] = useState(false);
  const sheetOpen = sheetOpenProp ?? sheetOpenInternal;
  const setSheetOpen = onSheetOpenChange ?? setSheetOpenInternal;
  const totalBays = groups.reduce((sum, group) => sum + group.rotationIds.length, 0);
  const compact = storewide && groups.length > STOREWIDE_PILL_LIMIT;

  useEffect(() => {
    if (!sheetOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheetOpen]);

  function pick(id: string | "all") {
    onSelect(id);
    setSheetOpen(false);
  }

  return (
    <>
      {!hideStrip ? (
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
          ) : compact ? (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/25 px-3 text-sm font-bold text-cyan-100"
            >
              <Users className="w-4 h-4 mr-2" strokeWidth={ICON_STROKE} aria-hidden />
              {groups.length} Associates On Duty
            </button>
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
              {groups.map((group) => (
                <AssociatePill
                  key={group.specialist_id}
                  group={group}
                  selected={selectedId === group.specialist_id}
                  onSelect={() => onSelect(group.specialist_id)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {sheetOpen ? (
        <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close on-duty list"
            onClick={() => setSheetOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="on-duty-sheet-title"
            className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                  Storewide
                </p>
                <h2
                  id="on-duty-sheet-title"
                  className="mt-1 text-lg font-bold text-white"
                >
                  {groups.length} Associates On Duty
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="btn-icon-touch"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>
            <ul className="space-y-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => pick("all")}
                  className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold ${
                    selectedId === "all"
                      ? "border-cyan-400/55 bg-cyan-950/40 text-cyan-100"
                      : "border-zinc-700 text-zinc-200"
                  }`}
                >
                  <span className="inline-flex items-center">
                    <Users className="w-4 h-4 mr-2" strokeWidth={ICON_STROKE} aria-hidden />
                    All associates
                  </span>
                  {selectedId === "all" ? (
                    <CheckCircle2
                      className="h-4 w-4 text-cyan-300"
                      strokeWidth={ICON_STROKE}
                      aria-hidden
                    />
                  ) : null}
                </button>
              </li>
              {groups.map((group) => {
                const selected = selectedId === group.specialist_id;
                const hours = formatCompactShiftRange(group.start, group.end);
                const count = group.rotationIds.length;
                return (
                  <li key={group.specialist_id}>
                    <button
                      type="button"
                      onClick={() => pick(group.specialist_id)}
                      className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${
                        selected
                          ? "border-cyan-400/55 bg-cyan-950/40 text-cyan-100"
                          : "border-zinc-700 text-zinc-200"
                      }`}
                    >
                      <span>
                        {group.specialist_name}
                        <span className="mt-0.5 block font-mono text-[11px] font-medium text-zinc-500">
                          {hours} · {count} {count === 1 ? "Bay" : "Bays"}
                        </span>
                      </span>
                      {selected ? (
                        <CheckCircle2
                          className="h-4 w-4 shrink-0 text-cyan-300"
                          strokeWidth={ICON_STROKE}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AssociatePill({
  group,
  selected,
  onSelect,
}: {
  group: OnDutyWorkloadGroup;
  selected: boolean;
  onSelect: () => void;
}) {
  const count = group.rotationIds.length;
  const hours = formatCompactShiftRange(group.start, group.end);
  return (
    <button
      type="button"
      onClick={onSelect}
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
}
