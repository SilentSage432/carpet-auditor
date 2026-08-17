"use client";

import {
  formatApplianceConditionTag,
  isApplianceShowroomDisplayScan,
  type ApplianceScan,
} from "@/lib/types";

type Props = {
  scan: Pick<
    ApplianceScan,
    "location_type" | "condition_tag" | "location" | "is_showroom_baseline"
  >;
  compact?: boolean;
};

/** Distinct badge for showroom floor vs boxed backstock units. */
export function ApplianceUnitLocationBadge({ scan, compact = false }: Props) {
  const showroom = isApplianceShowroomDisplayScan(scan);
  const baseline = Boolean(scan.is_showroom_baseline);

  if (showroom) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 font-semibold text-cyan-100 ${
          compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
        }`}
      >
        <span aria-hidden>🏢</span>
        Showroom Floor
        {baseline ? (
          <span className="rounded bg-amber-500/20 px-1 text-[9px] uppercase text-amber-200">
            Baseline
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-900/80 font-semibold text-slate-300 ${
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      }`}
    >
      <span aria-hidden>📦</span>
      Boxed Stock
    </span>
  );
}

type SummaryProps = {
  scans: ApplianceScan[];
  className?: string;
};

/** e.g. Total: 3 (1 Showroom Display, 2 Boxed Stock) */
export function ApplianceGroupCountSummary({ scans, className = "" }: SummaryProps) {
  let showroomDisplay = 0;
  let boxedStock = 0;
  let baselineLocked = 0;

  for (const scan of scans) {
    if (isApplianceShowroomDisplayScan(scan)) showroomDisplay += 1;
    else boxedStock += 1;
    if (scan.is_showroom_baseline) baselineLocked += 1;
  }

  const total = scans.length;
  const parts: string[] = [];
  if (showroomDisplay > 0) {
    parts.push(`${showroomDisplay} Showroom Display`);
  }
  if (boxedStock > 0) {
    parts.push(`${boxedStock} Boxed Stock`);
  }

  return (
    <p className={`font-mono text-xs tabular-nums text-slate-400 ${className}`.trim()}>
      Total: {total}
      {parts.length > 0 ? ` (${parts.join(", ")})` : null}
      {baselineLocked > 0 ? (
        <span className="ml-1 text-amber-300/90">
          · {baselineLocked} baseline locked
        </span>
      ) : null}
    </p>
  );
}

export function formatApplianceUnitDetail(scan: ApplianceScan): string {
  const bits = [formatApplianceConditionTag(scan.condition_tag)];
  if (scan.serial_number.trim()) bits.unshift(`SN ${scan.serial_number.trim()}`);
  return bits.join(" · ");
}
