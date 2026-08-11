/** Lightweight network status for the hub header. */

import { useEffect, useState } from "react";
import { getStoreNumber } from "./store";
import {
  countPendingSync,
  isBrowserOnline,
  SYNC_QUEUE_CHANGED_EVENT,
} from "./sync-queue";

export type NetworkBadge = {
  online: boolean;
  pending: number;
  label: string;
  tone: "online" | "offline";
};

export function getNetworkBadge(
  storeNumber = typeof window !== "undefined" ? getStoreNumber() : ""
): NetworkBadge {
  const online = isBrowserOnline();
  const pending = countPendingSync(storeNumber);
  if (online) {
    return {
      online: true,
      pending,
      label:
        pending > 0
          ? `Online · ${pending} queued`
          : "Online · Live Supabase Sync",
      tone: "online",
    };
  }
  return {
    online: false,
    pending,
    label:
      pending > 0
        ? `Offline Mode · Queue (${pending})`
        : "Offline Mode · Local Queue Active",
    tone: "offline",
  };
}

/** Reactive pending offline action count for Settings / diagnostics. */
export function usePendingSyncCount(
  storeNumber = typeof window !== "undefined" ? getStoreNumber() : ""
): number {
  const [pending, setPending] = useState(() =>
    typeof window !== "undefined" ? countPendingSync(storeNumber) : 0
  );

  useEffect(() => {
    function refresh() {
      setPending(countPendingSync(storeNumber));
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

export function useNetworkBadge(
  storeNumber?: string
): NetworkBadge {
  const resolvedStore =
    storeNumber ??
    (typeof window !== "undefined" ? getStoreNumber() : "");
  const [badge, setBadge] = useState<NetworkBadge>(() => ({
    online: true,
    pending: 0,
    label: "Online · Live Supabase Sync",
    tone: "online",
  }));

  useEffect(() => {
    function refresh() {
      setBadge(getNetworkBadge(resolvedStore));
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
