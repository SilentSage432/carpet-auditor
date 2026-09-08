"use client";

/**
 * Floating offline banner — presentation + reconnect flush.
 * Sync ownership stays in lib/sync-queue; network badge in lib/network.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePendingSyncCount, useQuarantinedSyncCount } from "@/lib/network";
import { getStoreNumber } from "@/lib/store";
import {
  installSyncAutoFlush,
  isBrowserOnline,
  SYNC_QUEUE_CHANGED_EVENT,
  SYNC_QUEUE_INSPECT_HREF,
} from "@/lib/sync-queue";
import { hapticPulse } from "@/utils/haptics";

type BannerState =
  | { kind: "hidden" }
  | { kind: "offline"; pending: number; quarantined: number }
  | { kind: "attention"; pending: number; quarantined: number }
  | { kind: "flushing" }
  | { kind: "synced"; count: number };

export function OfflineNetworkBanner() {
  const router = useRouter();
  const storeNumber =
    typeof window !== "undefined" ? getStoreNumber() : "";
  const pending = usePendingSyncCount(storeNumber);
  const quarantined = useQuarantinedSyncCount(storeNumber);
  const [state, setState] = useState<BannerState>({ kind: "hidden" });

  useEffect(() => {
    function showOffline() {
      setState({
        kind: "offline",
        pending,
        quarantined,
      });
    }

    function showAttention() {
      setState({
        kind: "attention",
        pending,
        quarantined,
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
          window.setTimeout(() => {
            if (quarantined > 0) showAttention();
            else setState({ kind: "hidden" });
          }, 2800);
        } else if (quarantined > 0) {
          showAttention();
        } else {
          setState({ kind: "hidden" });
        }
      },
    });

    function onOffline() {
      showOffline();
    }

    function onQueueChanged() {
      if (!isBrowserOnline()) {
        showOffline();
        return;
      }
      if (quarantined > 0) showAttention();
    }

    window.addEventListener("offline", onOffline);
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, onQueueChanged);

    if (!isBrowserOnline()) {
      showOffline();
    } else if (quarantined > 0) {
      showAttention();
    }

    return () => {
      uninstall();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, onQueueChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeNumber]);

  useEffect(() => {
    if (state.kind === "offline" || state.kind === "attention") {
      setState({ kind: state.kind, pending, quarantined });
    }
    if (
      state.kind === "hidden" &&
      isBrowserOnline() &&
      quarantined > 0
    ) {
      setState({ kind: "attention", pending, quarantined });
    }
  }, [pending, quarantined, state.kind]);

  if (state.kind === "hidden") return null;

  const synced = state.kind === "synced";
  const attention = state.kind === "attention";
  /**
   * APP-SYNC-UX-001: the quarantined count is queued sync operations, never
   * merchandise — "items" misread as appliances on the showroom floor.
   */
  const label =
    state.kind === "offline"
      ? state.quarantined > 0
        ? `Offline — ${state.pending} queued · ${state.quarantined} blocked`
        : state.pending > 0
          ? `Offline Mode — Queuing Sync (${state.pending})`
          : "Offline Mode — Queuing Sync"
      : state.kind === "attention"
        ? state.pending > 0
          ? `${state.quarantined} sync issue${state.quarantined === 1 ? "" : "s"} blocked · ${state.pending} pending`
          : `${state.quarantined} sync issue${state.quarantined === 1 ? "" : "s"} need attention`
        : state.kind === "flushing"
          ? "Reconnected — flushing queue…"
          : `Synced ${state.count} queued action${state.count === 1 ? "" : "s"}`;

  const shellClass = `pointer-events-auto max-w-lg rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-md ${
    synced
      ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100 shadow-emerald-950/40"
      : attention
        ? "border-red-500/40 bg-red-950/90 text-red-100 shadow-red-950/40"
        : "border-amber-500/40 bg-amber-950/90 text-amber-100 shadow-amber-950/40"
  }`;

  const dot = (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-90"
      aria-hidden
    />
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[85] flex justify-center px-3"
    >
      {attention ? (
        <button
          type="button"
          data-testid="sync-attention-banner"
          onClick={() => router.push(SYNC_QUEUE_INSPECT_HREF)}
          className={`${shellClass} flex min-h-10 items-center gap-2 text-left`}
        >
          {dot}
          <span className="min-w-0 flex-1">{label}</span>
          <span className="shrink-0 rounded-lg border border-red-300/50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide">
            Review
          </span>
        </button>
      ) : (
        <div className={`${shellClass} flex items-center gap-1.5 text-center`}>
          {dot}
          <span className="min-w-0 flex-1">{label}</span>
        </div>
      )}
    </div>
  );
}
