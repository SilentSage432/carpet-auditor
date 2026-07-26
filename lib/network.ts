/** Lightweight network status for the hub header. */

import { useEffect, useState } from "react";
import {
  countPendingSync,
  isBrowserOnline,
} from "./sync-queue";

export type NetworkBadge = {
  online: boolean;
  pending: number;
  label: string;
  tone: "online" | "offline";
};

export function getNetworkBadge(): NetworkBadge {
  const online = isBrowserOnline();
  const pending = countPendingSync();
  if (online) {
    return {
      online: true,
      pending,
      label:
        pending > 0
          ? `Online · Syncing ${pending}`
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

export function useNetworkBadge(): NetworkBadge {
  const [badge, setBadge] = useState<NetworkBadge>(() => ({
    online: true,
    pending: 0,
    label: "Online · Live Supabase Sync",
    tone: "online",
  }));

  useEffect(() => {
    function refresh() {
      setBadge(getNetworkBadge());
    }
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("carpet-sync-queue-changed", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("carpet-sync-queue-changed", refresh);
    };
  }, []);

  return badge;
}
