"use client";

/**
 * One-tap barrier reasons for floor verification.
 * Reason vocabulary owned by lib/store-ops/verification.
 */

import {
  EXCEPTION_REASONS,
  QUICK_BARRIER_REASONS,
} from "@/lib/store-ops/verification";
import type { ExceptionReason } from "@/lib/store-ops/types";

type Props = {
  value?: string;
  onSelect: (reason: ExceptionReason) => void;
  disabled?: boolean;
  /** Show the longer historic reasons under a More row. */
  showAll?: boolean;
};

export function BarrierReasonChips({
  value,
  onSelect,
  disabled = false,
  showAll = false,
}: Props) {
  const extra = showAll
    ? EXCEPTION_REASONS.filter((r) => !QUICK_BARRIER_REASONS.includes(r))
    : [];

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {QUICK_BARRIER_REASONS.map((reason) => {
          const active = value === reason;
          return (
            <button
              key={reason}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onSelect(reason)}
              className={`flex min-h-12 items-center justify-center rounded-xl border px-2 text-center text-xs font-bold leading-tight transition active:scale-[0.99] disabled:opacity-50 ${
                active
                  ? "border-amber-400 bg-amber-400 text-slate-950"
                  : "border-amber-500/40 bg-amber-950/30 text-amber-100"
              }`}
            >
              {reason}
            </button>
          );
        })}
      </div>
      {extra.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {extra.map((reason) => {
            const active = value === reason;
            return (
              <button
                key={reason}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onSelect(reason)}
                className={`min-h-10 rounded-lg border px-2.5 text-[11px] font-semibold transition disabled:opacity-50 ${
                  active
                    ? "border-slate-300 bg-slate-200 text-slate-950"
                    : "border-slate-700 bg-slate-950 text-slate-300"
                }`}
              >
                {reason}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
