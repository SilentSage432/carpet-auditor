"use client";

/**
 * SI-001C Floor current-attention strip — props-only presentation.
 * FloorTab owns fetch/state/aggregation.
 */

import { Focus } from "lucide-react";
import type { MapAttentionClientStatus } from "@/lib/store-ops/location-attention-presentation";
import {
  ATTENTION_NEEDS_DEPARTMENT_LABEL,
  ATTENTION_SOME_EVIDENCE_UNAVAILABLE,
  ATTENTION_UNAVAILABLE_STATUS_LABEL,
  formatAttentionAsOf,
} from "@/lib/store-ops/location-attention-presentation";
import {
  formatAttentionTierCountLine,
  type LocationAttentionSummary,
} from "@/lib/store-ops/location-attention-summary";

const ICON_STROKE = 1.75;

export const FLOOR_ATTENTION_QUIET_LABEL = "No Medium/High attention" as const;

type Props = {
  status: MapAttentionClientStatus;
  summary: LocationAttentionSummary | null;
  generatedAt: string | null;
  degraded: boolean;
  onViewMap?: () => void;
};

export function FloorAttentionSummary({
  status,
  summary,
  generatedAt,
  degraded,
  onViewMap,
}: Props) {
  if (status === "IDLE" || status === "LOADING") {
    return null;
  }

  const showCta =
    Boolean(onViewMap) &&
    (status === "AVAILABLE" || status === "DEGRADED");

  let body: string;
  if (status === "NEEDS_DEPARTMENT") {
    body = ATTENTION_NEEDS_DEPARTMENT_LABEL;
  } else if (status === "UNAVAILABLE") {
    body = ATTENTION_UNAVAILABLE_STATUS_LABEL;
  } else {
    const counts =
      summary != null ? formatAttentionTierCountLine(summary) : null;
    body = counts ?? FLOOR_ATTENTION_QUIET_LABEL;
  }

  const asOf =
    generatedAt && (status === "AVAILABLE" || status === "DEGRADED")
      ? formatAttentionAsOf(generatedAt)
      : null;

  const provenanceParts: string[] = [];
  if (status === "AVAILABLE" || status === "DEGRADED") {
    provenanceParts.push("Derived");
    if (asOf) provenanceParts.push(asOf);
  }

  return (
    <div
      className="mt-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-1.5"
      data-testid="floor-current-attention"
      data-status={status}
    >
      <div className="flex items-start gap-2">
        <Focus
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400"
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] font-bold uppercase tracking-wide text-zinc-500">
            Current attention
          </p>
          <p
            className={`mt-0.5 text-xs leading-snug ${
              summary && summary.highCount > 0
                ? "font-semibold text-zinc-100"
                : "font-medium text-zinc-300"
            }`}
          >
            {body}
          </p>
          {status === "DEGRADED" || (status === "AVAILABLE" && degraded) ? (
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
              {ATTENTION_SOME_EVIDENCE_UNAVAILABLE}
            </p>
          ) : null}
          {provenanceParts.length > 0 ? (
            <p className="mt-0.5 font-mono text-[10px] leading-snug text-zinc-600">
              {provenanceParts.join(" · ")}
            </p>
          ) : null}
        </div>
        {showCta && onViewMap ? (
          <button
            type="button"
            onClick={onViewMap}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700/80 px-2.5 text-[11px] font-semibold text-zinc-300 transition active:scale-[0.99]"
          >
            View on Map
          </button>
        ) : null}
      </div>
    </div>
  );
}
