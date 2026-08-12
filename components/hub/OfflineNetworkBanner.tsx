"use client";

/**
 * Floating offline banner — presentation + reconnect flush.
 * Sync ownership stays in lib/sync-queue; network badge in lib/network.
 */

import { useEffect, useState } from "react";
import { usePendingSyncCount } from "@/lib/network";
import { getStoreNumber } from "@/lib/store";
import {
  installSyncAutoFlush,
  isBrowserOnline,
  SYNC_QUEUE_CHANGED_EVENT,
} from "@/lib/sync-queue";
import { hapticPulse } from "@/utils/haptics";

type BannerState =
  | { kind: "hidden" }
  | { kind: "offline"; pending: number }
  | { kind: "flushing" }
  | { kind: "synced"; count: number };

export function OfflineNetworkBanner() {
  const storeNumber =
    typeof window !== "undefined" ? getStoreNumber() : "";
  const pending = usePendingSyncCount(storeNumber);
  const [state, setState] = useState<BannerState>({ kind: "hidden" });

  useEffect(() => {
    function showOffline() {
      setState({
        kind: "offline",
        pending,
      });
    }

    const uninstall = installSyncAutoFlush({
      getStore: () => getStoreNumber(),
      onFlushStart: () => {
        if (isBrowserOnline()) setState({ kind: "flushing" });
      },
      onFlushComplete: (synced) => {
        if (!isBrowserOnline()) {
          showOffline();
          return;
        }
        if (synced > 0) {
          hapticPulse("success");
          setState({ kind: "synced", count: synced });
          window.setTimeout(() => setState({ kind: "hidden" }), 2800);
        } else {
          setState({ kind: "hidden" });
        }
      },
    });

    function onOffline() {
      showOffline();
    }

    function onQueueChanged() {
      if (!isBrowserOnline()) showOffline();
    }

    window.addEventListener("offline", onOffline);
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, onQueueChanged);

    if (!isBrowserOnline()) {
      showOffline();
    }

    return () => {
      uninstall();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, onQueueChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeNumber]);

  useEffect(() => {
    if (state.kind !== "offline") return;
    setState({ kind: "offline", pending });
  }, [pending, state.kind]);

  if (state.kind === "hidden") return null;

  const synced = state.kind === "synced";
  const label =
    state.kind === "offline"
      ? state.pending > 0
        ? `Offline Mode — Queuing Sync (${state.pending})`
        : "Offline Mode — Queuing Sync"
      : state.kind === "flushing"
        ? "Reconnected — flushing queue…"
        : `Synced ${state.count} queued action${state.count === 1 ? "" : "s"}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[85] flex justify-center px-3"
    >
      <div
        className={`pointer-events-auto max-w-lg rounded-xl border px-3 py-2 text-center text-xs font-semibold shadow-lg backdrop-blur-md ${
          synced
            ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100 shadow-emerald-950/40"
            : "border-amber-500/40 bg-amber-950/90 text-amber-100 shadow-amber-950/40"
        }`}
      >
        <span
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle opacity-90"
          aria-hidden
        />
        {label}
      </div>
    </div>
  );
}
