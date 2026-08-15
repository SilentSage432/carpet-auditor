"use client";

/**
 * Selling vs Topstock audit mode — presentation only.
 * Canonical values owned by lib/store-ops/audit-location-mode.
 */

import {
  AUDIT_LOCATION_MODES,
  type AuditLocationMode,
} from "@/lib/store-ops/audit-location-mode";

type Props = {
  value: AuditLocationMode | "all";
  onChange: (mode: AuditLocationMode | "all") => void;
  /** Include an All chip (Zebra checklist filter). */
  includeAll?: boolean;
  legend?: string;
  disabled?: boolean;
};

export function AuditLocationModeToggle({
  value,
  onChange,
  includeAll = false,
  legend = "Audit mode",
  disabled = false,
}: Props) {
  const activeMeta =
    value === "all"
      ? null
      : AUDIT_LOCATION_MODES.find((m) => m.code === value) ??
        AUDIT_LOCATION_MODES[0];

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-medium text-slate-200">
        {legend}
      </legend>
      <div
        role="group"
        aria-label={legend}
        className={`grid gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1 ${
          includeAll ? "grid-cols-3" : "grid-cols-2"
        }`}
      >
        {includeAll ? (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value === "all"}
            onClick={() => onChange("all")}
            className={`flex min-h-11 flex-col items-center justify-center rounded-lg px-1 text-[11px] font-bold uppercase tracking-wide transition ${
              value === "all"
                ? "bg-emerald-500 text-slate-950 shadow"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            All
            <span
              className={`mt-0.5 text-[9px] font-semibold normal-case tracking-normal ${
                value === "all" ? "text-slate-800" : "text-slate-500"
              }`}
            >
              Selling + overheads
            </span>
          </button>
        ) : null}
        {AUDIT_LOCATION_MODES.map((mode) => {
          const active = value === mode.code;
          return (
            <button
              key={mode.code}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(mode.code)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-lg px-1 text-[11px] font-bold uppercase tracking-wide transition ${
                active
                  ? mode.code === "TOPSTOCK"
                    ? "bg-cyan-400 text-slate-950 shadow"
                    : "bg-emerald-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {mode.short}
              <span
                className={`mt-0.5 text-[9px] font-semibold normal-case tracking-normal ${
                  active ? "text-slate-800" : "text-slate-500"
                }`}
              >
                {mode.hint}
              </span>
            </button>
          );
        })}
      </div>
      {activeMeta && !includeAll ? (
        <p className="mt-1.5 text-[11px] text-slate-400">
          Discrepancies and notes save against{" "}
          <span className="font-mono font-semibold text-slate-200">
            {activeMeta.short}
          </span>{" "}
          ({activeMeta.hint}).
        </p>
      ) : null}
    </fieldset>
  );
}
