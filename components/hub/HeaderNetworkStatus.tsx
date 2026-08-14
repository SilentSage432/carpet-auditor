"use client";

/**
 * Sticky-header network + pending-queue chip.
 * Owns useNetworkBadge so queue ticks do not re-render hub forms or Admin Tools.
 */

import { memo, type ReactNode } from "react";
import { useNetworkBadge } from "@/lib/network";

type Props = {
  storeNumber?: string;
  variant?: "compact" | "detail" | "banner";
  children?: ReactNode;
};

export const HeaderNetworkStatus = memo(function HeaderNetworkStatus({
  storeNumber,
  variant = "compact",
  children,
}: Props) {
  const network = useNetworkBadge(storeNumber);
  const online = network.tone === "online";
  const queued =
    network.pending > 0
      ? variant === "compact"
        ? ` · ${network.pending}q`
        : ` · ${network.pending} queued`
      : "";

  if (variant === "banner") {
    return (
      <p
        className={`mt-0.5 flex items-center gap-1.5 truncate text-[10px] font-semibold ${
          online ? "text-emerald-400/90" : "text-amber-300/90"
        }`}
        title={network.label}
        aria-live="polite"
      >
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            online ? "bg-emerald-400" : "bg-amber-400"
          }`}
          aria-hidden
        />
        <span className="truncate">
          {online ? "🟢 Online" : "🟠 Offline Mode"}
          {queued}
        </span>
      </p>
    );
  }

  if (variant === "detail") {
    return (
      <p
        className={`mt-2 text-[11px] font-semibold ${
          online ? "text-emerald-400" : "text-amber-300"
        }`}
        title={network.label}
        aria-live="polite"
      >
        {online ? "Online" : "Offline Mode"}
        {queued}
      </p>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2" title={network.label}>
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          online ? "bg-emerald-400" : "bg-amber-400"
        }`}
        aria-hidden
      />
      <span className="min-w-0">
        {children}
        <span
          className={`mt-0.5 block truncate text-[10px] font-semibold ${
            online ? "text-zinc-300" : "text-amber-300"
          }`}
          aria-live="polite"
        >
          {online ? "Online" : "Offline"}
          {queued}
        </span>
      </span>
    </span>
  );
});
