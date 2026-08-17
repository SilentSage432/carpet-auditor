"use client";

/**
 * Header pending-queue chip. Hidden at 0. Presentation only — lib/sync-queue owns the queue.
 */

import { HubIcon } from "@/components/hub/NavIcons";
import { usePendingSyncCount } from "@/lib/network";

type Props = {
  storeNumber?: string;
};

export function SyncStatusPill({ storeNumber }: Props) {
  const pending = usePendingSyncCount(storeNumber);
  if (pending <= 0) return null;

  const label = pending === 1 ? "1 pending sync" : `${pending} pending syncs`;

  return (
    <span
      className="inline-flex max-w-[9.5rem] shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-1 font-mono text-[10px] font-semibold leading-none text-warning"
      title={label}
      aria-live="polite"
    >
      <HubIcon id="refresh" className="h-3 w-3 shrink-0 animate-pulse" />
      <span className="truncate">{label}</span>
    </span>
  );
}
