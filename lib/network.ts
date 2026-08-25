/** Lightweight network status for the hub header. */

import { useEffect, useState } from "react";
import { getStoreNumber } from "./store";
import {
  countPendingSync,
  countQuarantinedSync,
  getSyncQueueSummary,
  isBrowserOnline,
  SYNC_QUEUE_CHANGED_EVENT,
  type SyncQueueSummary,
} from "./sync-queue";

export type NetworkBadge = {
  online: boolean;
  pending: number;
  quarantined: number;
  label: string;
  tone: "online" | "offline";
};

export function getNetworkBadge(
  storeNumber = typeof window !== "undefined" ? getStoreNumber() : ""
): NetworkBadge {
  const online = isBrowserOnline();
  const { pending, quarantined } = getSyncQueueSummary(storeNumber);
  if (online) {
    return {
      online: true,
      pending,
      quarantined,
      label:
        quarantined > 0
          ? `Online · ${pending} queued · ${quarantined} blocked`
          : pending > 0
            ? `Online · ${pending} queued`
            : "Online · Live Supabase Sync",
      tone: "online",
    };
  }
  return {
    online: false,
    pending,
    quarantined,
    label:
      quarantined > 0
        ? `Offline Mode · Queue (${pending}) · ${quarantined} blocked`
        : pending > 0
          ? `Offline Mode · Queue (${pending})`
          : "Offline Mode · Local Queue Active",
    tone: "offline",
  };
}

/** Reactive actionable pending count — excludes quarantined items. */
export function usePendingSyncCount(
  storeNumber = typeof window !== "undefined" ? getStoreNumber() : ""
): number {
  const [pending, setPending] = useState(() =>
    typeof window !== "undefined" ? countPendingSync(storeNumber) : 0
  );

  useEffect(() => {
    function refresh() {
      setPending((prev) => {
        const next = countPendingSync(storeNumber);
        return prev === next ? prev : next;
      });
    }
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    };
  }, [storeNumber]);

  return pending;
}

/** Reactive quarantined sync count for diagnostics (Settings Part 2). */
export function useQuarantinedSyncCount(
  storeNumber = typeof window !== "undefined" ? getStoreNumber() : ""
): number {
  const [quarantined, setQuarantined] = useState(() =>
    typeof window !== "undefined" ? countQuarantinedSync(storeNumber) : 0
  );

  useEffect(() => {
    function refresh() {
      setQuarantined((prev) => {
        const next = countQuarantinedSync(storeNumber);
        return prev === next ? prev : next;
      });
    }
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    };
  }, [storeNumber]);

  return quarantined;
}

export function useSyncQueueSummary(
  storeNumber = typeof window !== "undefined" ? getStoreNumber() : ""
): SyncQueueSummary {
  const [summary, setSummary] = useState<SyncQueueSummary>(() =>
    typeof window !== "undefined"
      ? getSyncQueueSummary(storeNumber)
      : { pending: 0, quarantined: 0 }
  );

  useEffect(() => {
    function refresh() {
      setSummary((prev) => {
        const next = getSyncQueueSummary(storeNumber);
        if (
          prev.pending === next.pending &&
          prev.quarantined === next.quarantined
        ) {
          return prev;
        }
        return next;
      });
    }
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    };
  }, [storeNumber]);

  return summary;
}

export function useNetworkBadge(
  storeNumber?: string
): NetworkBadge {
  const resolvedStore =
    storeNumber ??
    (typeof window !== "undefined" ? getStoreNumber() : "");
  const [badge, setBadge] = useState<NetworkBadge>(() => ({
    online: true,
    pending: 0,
    quarantined: 0,
    label: "Online · Live Supabase Sync",
    tone: "online",
  }));

  useEffect(() => {
    function refresh() {
      setBadge((prev) => {
        const next = getNetworkBadge(resolvedStore);
        if (
          prev.online === next.online &&
          prev.pending === next.pending &&
          prev.quarantined === next.quarantined &&
          prev.tone === next.tone &&
          prev.label === next.label
        ) {
          return prev;
        }
        return next;
      });
    }
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    };
  }, [resolvedStore]);

  return badge;
}
