"use client";

import { isCarryOverPriorityBadge } from "@/lib/store-ops/types";
import type { StoreLocation } from "@/lib/store-ops/types";

type AssignmentHint = {
  status?: string | null;
  is_carried_over?: boolean | null;
} | null;

/** Amber Geist Mono badge for call-out carry-over priority bays. */
export function CarryOverPriorityBadge({
  location,
  assignment,
}: {
  location?: Pick<
    StoreLocation,
    "carried_over" | "last_carried_over_at" | "status"
  > | null;
  assignment?: AssignmentHint;
}) {
  if (!isCarryOverPriorityBadge(location, assignment)) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/45 bg-amber-950/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-tight text-amber-100">
      Carry-Over Priority
    </span>
  );
}
