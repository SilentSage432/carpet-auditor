/**
 * Client helpers for appliance physical audits (APP-AUD-001).
 * Reconciliation is online-only. Scan association uses cached active session id offline.
 */

import { storeOpsAuthHeadersAsync } from "@/lib/store-ops/auth";
import { getStoreNumber } from "@/lib/store";
import {
  flushSyncQueue,
  getPendingApplianceScanSyncForAudit,
  isBrowserOnline,
} from "@/lib/sync-queue";
import {
  mapApplianceAuditSessionRow,
  mapApplianceReconciliationSnapshotRow,
  type ApplianceAuditSession,
  type AppliancePhysicalItemCount,
  type ApplianceReconciliationSnapshot,
} from "@/lib/appliances/physical-audit";
import type { ApplianceScan } from "@/lib/types";

const ACTIVE_SESSION_KEY = "appliance_active_audit_session";

export type ApplianceAuditDetail = {
  session: ApplianceAuditSession;
  scans: ApplianceScan[];
  physical_items: AppliancePhysicalItemCount[];
  snapshots: ApplianceReconciliationSnapshot[];
  summary: {
    physical_unit_count: number;
    unique_item_count: number;
    reconciled_item_count: number;
    snapshot_row_count: number;
  };
};

export function loadCachedActiveAuditSessionId(
  store = getStoreNumber()
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { store_number?: string; id?: string };
    if (parsed.store_number !== store) return null;
    return parsed.id ? String(parsed.id) : null;
  } catch {
    return null;
  }
}

export function cacheActiveAuditSession(
  session: ApplianceAuditSession | null
): void {
  if (typeof window === "undefined") return;
  if (!session || session.status !== "ACTIVE") {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    return;
  }
  localStorage.setItem(
    ACTIVE_SESSION_KEY,
    JSON.stringify({ store_number: session.store_number, id: session.id })
  );
}

export async function fetchApplianceAuditSessions(options?: {
  status?: "ACTIVE" | "CLOSED" | "ALL";
}): Promise<ApplianceAuditSession[]> {
  if (!isBrowserOnline()) {
    const cached = loadCachedActiveAuditSessionId();
    if (cached && (!options?.status || options.status === "ACTIVE")) {
      return [
        {
          id: cached,
          store_number: getStoreNumber(),
          status: "ACTIVE",
          started_at: "",
          closed_at: null,
          started_by: "",
          closed_by: null,
          notes: "",
          created_at: "",
        },
      ];
    }
    return [];
  }

  const store = getStoreNumber();
  const authHeaders = await storeOpsAuthHeadersAsync();
  const qs = new URLSearchParams();
  if (options?.status && options.status !== "ALL") {
    qs.set("status", options.status);
  }
  const res = await fetch(
    `/api/appliances/audits${qs.toString() ? `?${qs}` : ""}`,
    {
      headers: { ...authHeaders, "x-store-number": store },
      cache: "no-store",
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    sessions?: unknown[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `Failed to load audits (${res.status})`);
  }
  return (json.sessions ?? []).map((row) =>
    mapApplianceAuditSessionRow(row as Record<string, unknown>)
  );
}

export async function startAppliancePhysicalAudit(notes = ""): Promise<{
  session: ApplianceAuditSession;
}> {
  if (!isBrowserOnline()) {
    throw new Error("Starting a physical audit requires connectivity");
  }
  const store = getStoreNumber();
  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch("/api/appliances/audits", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      "x-store-number": store,
    },
    body: JSON.stringify({ notes }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    session?: Record<string, unknown>;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `Could not start audit (${res.status})`);
  }
  if (!json.session) throw new Error("API returned no session");
  const session = mapApplianceAuditSessionRow(json.session);
  cacheActiveAuditSession(session);
  return { session };
}

export async function closeAppliancePhysicalAudit(
  sessionId: string,
  notes?: string
): Promise<ApplianceAuditSession> {
  if (!isBrowserOnline()) {
    throw new Error("Closing a physical audit requires connectivity");
  }

  const store = getStoreNumber();
  const pendingBefore = getPendingApplianceScanSyncForAudit(sessionId, store);
  if (pendingBefore.length > 0) {
    await flushSyncQueue(store);
  }
  const stillPending = getPendingApplianceScanSyncForAudit(sessionId, store);
  if (stillPending.length > 0) {
    const quarantined = stillPending.filter((a) => a.status === "quarantined")
      .length;
    throw new Error(
      quarantined > 0
        ? `Cannot close — ${stillPending.length} unsynced scan(s) for this audit are still pending (${quarantined} quarantined). Resolve sync, then close.`
        : `Cannot close — ${stillPending.length} unsynced scan observation(s) for this audit are still pending. Wait for sync, then close.`
    );
  }

  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch(`/api/appliances/audits/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      "x-store-number": store,
    },
    body: JSON.stringify({ action: "close", notes }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    session?: Record<string, unknown>;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `Could not close audit (${res.status})`);
  }
  if (!json.session) throw new Error("API returned no session");
  const session = mapApplianceAuditSessionRow(json.session);
  cacheActiveAuditSession(null);
  return session;
}

export async function fetchApplianceAuditDetail(
  sessionId: string
): Promise<ApplianceAuditDetail> {
  if (!isBrowserOnline()) {
    throw new Error("Audit history requires connectivity");
  }
  const store = getStoreNumber();
  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch(
    `/api/appliances/audits/${encodeURIComponent(sessionId)}`,
    {
      headers: { ...authHeaders, "x-store-number": store },
      cache: "no-store",
    }
  );
  const json = (await res.json().catch(() => ({}))) as ApplianceAuditDetail & {
    error?: string;
    session?: Record<string, unknown>;
    snapshots?: unknown[];
  };
  if (!res.ok) {
    throw new Error(json.error || `Failed to load audit (${res.status})`);
  }
  return {
    session: mapApplianceAuditSessionRow(
      (json.session ?? {}) as Record<string, unknown>
    ),
    scans: (json.scans ?? []) as ApplianceScan[],
    physical_items: json.physical_items ?? [],
    snapshots: (json.snapshots ?? []).map((row) =>
      mapApplianceReconciliationSnapshotRow(row as Record<string, unknown>)
    ),
    summary: json.summary ?? {
      physical_unit_count: 0,
      unique_item_count: 0,
      reconciled_item_count: 0,
      snapshot_row_count: 0,
    },
  };
}

export async function saveApplianceReconciliation(
  sessionId: string,
  items: {
    item_number: string;
    declared_lowes_oh: number | null;
    outcome?: string | null;
    notes?: string;
  }[]
): Promise<ApplianceReconciliationSnapshot[]> {
  if (!isBrowserOnline()) {
    throw new Error("Reconciliation with Lowe's OH requires connectivity");
  }
  const store = getStoreNumber();
  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch(
    `/api/appliances/audits/${encodeURIComponent(sessionId)}/reconcile`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        "x-store-number": store,
      },
      body: JSON.stringify({ items }),
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    snapshots?: unknown[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `Reconciliation failed (${res.status})`);
  }
  return (json.snapshots ?? []).map((row) =>
    mapApplianceReconciliationSnapshotRow(row as Record<string, unknown>)
  );
}
