"use client";

/**
 * Sticky-header network + pending-queue chip.
 * Owns useNetworkBadge so queue ticks do not re-render hub forms or Settings tools.
 * Vector Wifi / WifiOff glyphs — no raster or emoji status marks.
 */

import { memo, type ReactNode } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
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
  const iconId = online ? "wifi" : "wifiOff";
  const toneClass = online ? "text-success" : "text-warning";

  if (variant === "banner") {
    return (
      <p
        className={`mt-0.5 flex items-center gap-1 truncate text-[10px] font-semibold ${
          online ? "text-success/90" : "text-warning/90"
        }`}
        title={network.label}
        aria-live="polite"
      >
        <HubIcon id={iconId} className={`h-3.5 w-3.5 shrink-0 ${toneClass}`} />
        <span className="truncate">
          {online ? "Online" : "Offline Mode"}
          {queued}
        </span>
      </p>
    );
  }

  if (variant === "detail") {
    return (
      <p
        className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold ${toneClass}`}
        title={network.label}
        aria-live="polite"
      >
        <HubIcon id={iconId} className="h-3.5 w-3.5 shrink-0" />
        {online ? "Online" : "Offline Mode"}
        {queued}
      </p>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={network.label}>
      <HubIcon
        id={iconId}
        className={`h-4 w-4 shrink-0 ${toneClass}`}
      />
      <span className="min-w-0">
        {children}
        <span
          className={`mt-0.5 block truncate text-[10px] font-semibold ${
            online ? "text-muted" : "text-warning"
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
