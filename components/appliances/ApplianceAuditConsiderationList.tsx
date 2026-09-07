"use client";

/**
 * APP-ROT-001 — compact "Consider checking again" strip.
 * Advisory evidence only — not mandatory audit targets.
 */

import {
  APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT,
  daysSinceIso,
  type ApplianceAuditConsiderationItem,
} from "@/lib/appliances/audit-consideration";

type Props = {
  items: ApplianceAuditConsiderationItem[];
  eligibleCount: number;
  loading?: boolean;
  /** When true, show all eligible (View more). */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Open existing audit history for this item's latest CLOSED audit. */
  onOpenHistory?: (item: ApplianceAuditConsiderationItem) => void;
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ApplianceAuditConsiderationList({
  items,
  eligibleCount,
  loading = false,
  expanded = false,
  onToggleExpanded,
  onOpenHistory,
}: Props) {
  if (loading) {
    return (
      <div
        data-testid="appliance-audit-consideration"
        className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Consider checking again
        </p>
        <p className="mt-1 text-[11px] text-slate-500">Loading evidence…</p>
      </div>
    );
  }

  if (eligibleCount === 0 || items.length === 0) {
    return null;
  }

  const visible = expanded
    ? items
    : items.slice(0, APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT);
  const canExpand =
    eligibleCount > APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT && onToggleExpanded;

  return (
    <div
      data-testid="appliance-audit-consideration"
      className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-amber-200/90">
            Consider checking again
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
            Evidence from past physical audits — advisory only. Scan whatever
            you need; this is not a required target list.
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-slate-500">
          {eligibleCount}
        </span>
      </div>

      <ul className="space-y-1.5" data-testid="appliance-audit-consideration-list">
        {visible.map((item) => {
          const daysClosed = daysSinceIso(item.lastClosedAuditAt);
          const daysObserved = daysSinceIso(item.lastObservedAt);
          return (
            <li key={item.item_number}>
              <button
                type="button"
                disabled={!onOpenHistory || !item.lastClosedAuditId}
                onClick={() => onOpenHistory?.(item)}
                className="flex min-h-11 w-full flex-col gap-0.5 rounded-lg border border-slate-800/80 bg-slate-950/50 px-2.5 py-2 text-left disabled:opacity-80"
                data-testid={`consideration-item-${item.item_number}`}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-100">
                    {item.item_number}
                  </span>
                  {item.description ? (
                    <span className="truncate text-[11px] text-slate-500">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <ul className="space-y-0.5">
                  {item.reasons.map((reason) => (
                    <li
                      key={reason.code}
                      className="text-[11px] leading-snug text-amber-100/90"
                    >
                      {reason.label}
                    </li>
                  ))}
                </ul>
                <span className="font-mono text-[10px] text-slate-500">
                  {item.reconciledAuditCount === 1
                    ? "1 reconciled audit"
                    : `${item.reconciledAuditCount} reconciled audits`}
                  {item.nonzeroVarianceCount > 0
                    ? ` · nonzero in ${item.nonzeroVarianceCount} of ${item.reconciledAuditCount}`
                    : ""}
                  {" · "}
                  last closed {formatWhen(item.lastClosedAuditAt)}
                  {daysClosed != null ? ` (${daysClosed}d)` : ""}
                  {item.lastObservedAt &&
                  item.lastObservedAt !== item.lastClosedAuditAt
                    ? ` · last observed ${formatWhen(item.lastObservedAt)}${
                        daysObserved != null ? ` (${daysObserved}d)` : ""
                      }`
                    : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {canExpand ? (
        <button
          type="button"
          onClick={onToggleExpanded}
          data-testid="consideration-view-more"
          className="flex min-h-9 w-full items-center justify-center rounded-lg text-[11px] font-semibold text-amber-200/90"
        >
          {expanded
            ? "Show less"
            : `View more (${eligibleCount - visible.length} more)`}
        </button>
      ) : null}
    </div>
  );
}
