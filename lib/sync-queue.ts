/**
 * Offline sync queue — owns pending Supabase writes, backoff retry, and conflict pauses.
 * Domain modules enqueue when offline; this module does not own domain knowledge.
 */

import {
  isSyncConflictError,
  requestConflictResolution,
  SyncConflictError,
} from "./sync-conflict";
import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import { uid } from "./uid";

export const SYNC_QUEUE_KEY = "carpet_hub_sync_queue";
/** Dispatched whenever the local queue is rewritten — header / Settings must listen. */
export const SYNC_QUEUE_CHANGED_EVENT = "carpet-sync-queue-changed";

export type SyncActionType =
  | "upsert_audit"
  | "upsert_catalog"
  | "upsert_remnant"
  | "upsert_specialist"
  | "upsert_appliance_catalog"
  | "upsert_appliance_scan"
  | "delete_audit"
  | "delete_catalog"
  | "delete_remnant"
  | "delete_specialist"
  | "delete_appliance_catalog"
  | "delete_appliance_scan";

export type SyncAction = {
  id: string;
  /** Stable transaction UUID for this queued write (survives retries). */
  transaction_id: string;
  created_at: string;
  /** When the local edit was queued / last refreshed. */
  optimistic_at: string;
  /**
   * Server `updated_at` the edit was based on (optional).
   * When missing, conflict detection uses created_at vs server updated_at.
   */
  base_updated_at?: string | null;
  attempts: number;
  next_retry_at?: string | null;
  last_error?: string | null;
  /** After "Keep My Local Version" — skip version check on replay. */
  force_overwrite?: boolean;
  store_number: string;
  type: SyncActionType;
  payload: Record<string, unknown>;
};

export type EnqueueSyncOptions = {
  baseUpdatedAt?: string | null;
  transactionId?: string;
};

const LOCAL_KEYS: Record<string, string> = {
  carpet_audits: "carpet_audits_offline",
  carpet_catalog: "carpet_catalog_offline",
  carpet_remnants: "carpet_remnants_offline",
  store_specialists: "carpet_specialists_offline",
  appliance_catalog: "appliance_catalog_offline",
  appliance_scans: "appliance_scans_offline",
};

const MAX_BACKOFF_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 2_000;

let flushing = false;
let autoFlushInstalled = false;
let retryTimer: number | null = null;

function scheduleRetryFlush(actions: SyncAction[]): void {
  if (typeof window === "undefined") return;
  const nextTimes = actions
    .map((a) => (a.next_retry_at ? Date.parse(a.next_retry_at) : NaN))
    .filter((t) => Number.isFinite(t) && t > Date.now());
  if (nextTimes.length === 0) return;
  const soonest = Math.min(...nextTimes);
  const delay = Math.max(50, Math.min(soonest - Date.now() + 25, MAX_BACKOFF_MS));
  if (retryTimer != null) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (isBrowserOnline()) void flushSyncQueue();
  }, delay);
}

type UpsertConflictConfig = {
  table: string;
  idField?: string;
};

const UPSERT_CONFLICT_CONFIG: Partial<
  Record<SyncActionType, UpsertConflictConfig>
> = {
  upsert_audit: { table: "carpet_audits" },
  upsert_catalog: { table: "carpet_catalog" },
  upsert_remnant: { table: "carpet_remnants" },
  upsert_specialist: { table: "store_specialists" },
  upsert_appliance_catalog: { table: "appliance_catalog" },
  upsert_appliance_scan: { table: "appliance_scans" },
};

function notifyQueueChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_QUEUE_CHANGED_EVENT));
}

function normalizeAction(raw: unknown): SyncAction | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.type !== "string" || typeof row.store_number !== "string") {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: String(row.id ?? uid("sync")),
    transaction_id: String(row.transaction_id ?? row.id ?? uid("txn")),
    created_at: String(row.created_at ?? now),
    optimistic_at: String(row.optimistic_at ?? row.created_at ?? now),
    base_updated_at:
      row.base_updated_at == null ? null : String(row.base_updated_at),
    attempts: Number.isFinite(Number(row.attempts))
      ? Math.max(0, Math.floor(Number(row.attempts)))
      : 0,
    next_retry_at:
      row.next_retry_at == null ? null : String(row.next_retry_at),
    last_error: row.last_error == null ? null : String(row.last_error),
    force_overwrite: Boolean(row.force_overwrite),
    store_number: String(row.store_number),
    type: row.type as SyncActionType,
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
  };
}

function readQueue(): SyncAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeAction)
      .filter((a): a is SyncAction => Boolean(a));
  } catch {
    return [];
  }
}

function writeQueue(actions: SyncAction[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(actions));
  notifyQueueChanged();
}

/** Explicitly empty the persisted queue and notify UI subscribers. */
export function clearSyncQueue(): void {
  writeQueue([]);
}

/**
 * Drop every queued action for one store (or the whole queue when omitted)
 * and force a UI refresh.
 */
export function purgeSyncQueue(storeNumber?: string): void {
  if (!storeNumber) {
    clearSyncQueue();
    return;
  }
  writeQueue(readQueue().filter((a) => a.store_number !== storeNumber));
}

export function getSyncQueue(): SyncAction[] {
  return readQueue();
}

export function countPendingSync(storeNumber = getStoreNumber()): number {
  return readQueue().filter((a) => a.store_number === storeNumber).length;
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/** Prefer offline path when the browser reports no connectivity or Supabase is missing. */
export function shouldSaveOffline(): boolean {
  if (!isBrowserOnline()) return true;
  return getSupabase() == null;
}

function backoffMs(attempts: number): number {
  const exp = Math.max(0, attempts - 1);
  return Math.min(BASE_BACKOFF_MS * 2 ** exp, MAX_BACKOFF_MS);
}

function isTransientError(err: unknown): boolean {
  if (isSyncConflictError(err)) return false;
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : err instanceof Error
        ? err.message
        : String(err ?? "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;

  if (status === 409 || code === "409") return false;
  if (status === 429 || status >= 500) return true;
  if (
    /network|fetch|timeout|temporar|unavailable|ECONN|ETIMEDOUT|offline/i.test(
      message
    )
  ) {
    return true;
  }
  // PostgREST / Postgres connection blips
  if (code === "PGRST301" || code === "57P01" || code === "08006") return true;
  return false;
}

function isHttpConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = Number((err as { status?: unknown }).status);
  const code = String((err as { code?: unknown }).code ?? "");
  return status === 409 || code === "409" || code === "23505";
}

export function enqueueSyncAction(
  type: SyncActionType,
  payload: Record<string, unknown>,
  storeNumber = getStoreNumber(),
  options?: EnqueueSyncOptions
): SyncAction {
  const now = new Date().toISOString();
  const baseFromPayload =
    typeof payload.base_updated_at === "string"
      ? payload.base_updated_at
      : null;
  const cleanPayload = { ...payload };
  delete cleanPayload.base_updated_at;

  const action: SyncAction = {
    id: uid("sync"),
    transaction_id: options?.transactionId?.trim() || uid("txn"),
    created_at: now,
    optimistic_at: now,
    base_updated_at: options?.baseUpdatedAt ?? baseFromPayload,
    attempts: 0,
    next_retry_at: null,
    last_error: null,
    force_overwrite: false,
    store_number: storeNumber,
    type,
    payload: { ...cleanPayload, store_number: storeNumber },
  };

  const existing = readQueue().filter((a) => {
    // Collapse duplicate upserts for the same entity id — keep newest payload
    if (
      a.type === type &&
      a.store_number === storeNumber &&
      a.payload.id != null &&
      payload.id != null &&
      String(a.payload.id) === String(payload.id)
    ) {
      // Preserve transaction id + base version from earlier queue entry
      action.transaction_id = a.transaction_id || action.transaction_id;
      if (!action.base_updated_at && a.base_updated_at) {
        action.base_updated_at = a.base_updated_at;
      }
      return false;
    }
    return true;
  });

  writeQueue([...existing, action]);
  return action;
}

function markLocalOnline(storageKey: string, id: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return;
    const next = parsed.map((row) => {
      const r = row as Record<string, unknown>;
      if (String(r.id) !== id) return row;
      return { ...r, offline: false };
    });
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function applyServerRowToLocal(
  storageKey: string,
  server: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const id = String(server.id ?? "");
  if (!id) return;
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const list = Array.isArray(parsed) ? [...parsed] : [];
    const idx = list.findIndex(
      (row) => String((row as Record<string, unknown>).id) === id
    );
    const nextRow = { ...server, offline: false };
    if (idx >= 0) list[idx] = nextRow;
    else list.unshift(nextRow);
    localStorage.setItem(storageKey, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

async function fetchServerVersion(
  action: SyncAction
): Promise<Record<string, unknown> | null> {
  const config = UPSERT_CONFLICT_CONFIG[action.type];
  if (!config) return null;
  const supabase = getSupabase();
  if (!supabase) return null;

  const entityId = String(action.payload.id ?? "");
  if (!entityId) return null;

  const { data, error } = await supabase
    .from(config.table)
    .select("*")
    .eq("id", entityId)
    .eq("store_number", action.store_number)
    .maybeSingle();

  if (error) {
    // Missing row / RLS miss → treat as no server version
    return null;
  }
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : null;
}

function serverIsNewerThanLocalBase(
  action: SyncAction,
  server: Record<string, unknown>
): boolean {
  if (action.force_overwrite) return false;
  const serverUpdated = String(
    server.updated_at ?? server.created_at ?? ""
  ).trim();
  if (!serverUpdated) return false;

  const serverMs = Date.parse(serverUpdated);
  if (!Number.isFinite(serverMs)) return false;

  const base = String(action.base_updated_at ?? "").trim();
  if (base) {
    const baseMs = Date.parse(base);
    if (Number.isFinite(baseMs) && serverMs > baseMs) return true;
    // Same or older base → not a conflict
    if (Number.isFinite(baseMs)) return false;
  }

  // No base: conflict if server changed after we queued the edit
  const queuedMs = Date.parse(action.created_at || action.optimistic_at);
  if (!Number.isFinite(queuedMs)) return false;
  return serverMs > queuedMs;
}

async function assertNoVersionConflict(action: SyncAction): Promise<void> {
  if (!action.type.startsWith("upsert_")) return;
  if (action.force_overwrite) return;

  const server = await fetchServerVersion(action);
  if (!server) return;

  if (serverIsNewerThanLocalBase(action, server)) {
    throw new SyncConflictError(
      "Server version is newer than the offline edit",
      {
        action,
        local: { ...action.payload },
        server,
      }
    );
  }
}

async function replayAction(action: SyncAction): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");

  await assertNoVersionConflict(action);

  const payload: Record<string, unknown> = {
    ...action.payload,
    store_number: action.store_number,
  };
  const entityId = String(payload.id ?? "");

  try {
    switch (action.type) {
      case "upsert_audit": {
        const { error } = await supabase
          .from("carpet_audits")
          .upsert(payload, { onConflict: "id" });
        if (error) throw error;
        if (entityId) markLocalOnline(LOCAL_KEYS.carpet_audits, entityId);
        return;
      }
      case "upsert_catalog": {
        const { error } = await supabase
          .from("carpet_catalog")
          .upsert(payload, { onConflict: "store_number,sku" });
        if (error) throw error;
        if (entityId) markLocalOnline(LOCAL_KEYS.carpet_catalog, entityId);
        return;
      }
      case "upsert_appliance_catalog": {
        const { error } = await supabase
          .from("appliance_catalog")
          .upsert(payload, { onConflict: "store_number,item_number" });
        if (error) throw error;
        if (entityId) markLocalOnline(LOCAL_KEYS.appliance_catalog, entityId);
        return;
      }
      case "upsert_appliance_scan": {
        const { error } = await supabase
          .from("appliance_scans")
          .upsert(payload, { onConflict: "id" });
        if (error) throw error;
        if (entityId) markLocalOnline(LOCAL_KEYS.appliance_scans, entityId);
        return;
      }
      case "upsert_remnant": {
        const { error } = await supabase
          .from("carpet_remnants")
          .upsert(payload, { onConflict: "id" });
        if (error) throw error;
        if (entityId) markLocalOnline(LOCAL_KEYS.carpet_remnants, entityId);
        return;
      }
      case "upsert_specialist": {
        const specialistPayload = { ...payload };
        const rawId = specialistPayload.id;
        const uuidOk =
          typeof rawId === "string" &&
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            rawId
          );
        if (!uuidOk) {
          delete specialistPayload.id;
        }
        const { data, error } = await supabase
          .from("store_specialists")
          .upsert(specialistPayload, { onConflict: "store_number,name" })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        const syncedId =
          data && typeof (data as { id?: string }).id === "string"
            ? String((data as { id: string }).id)
            : uuidOk
              ? String(rawId)
              : "";
        if (syncedId) markLocalOnline(LOCAL_KEYS.store_specialists, syncedId);
        return;
      }
      case "delete_audit": {
        const { error } = await supabase
          .from("carpet_audits")
          .delete()
          .eq("id", entityId)
          .eq("store_number", action.store_number);
        if (error) throw error;
        return;
      }
      case "delete_catalog": {
        const { error } = await supabase
          .from("carpet_catalog")
          .delete()
          .eq("id", entityId)
          .eq("store_number", action.store_number);
        if (error) throw error;
        return;
      }
      case "delete_appliance_catalog": {
        const { error } = await supabase
          .from("appliance_catalog")
          .delete()
          .eq("id", entityId)
          .eq("store_number", action.store_number);
        if (error) throw error;
        return;
      }
      case "delete_appliance_scan": {
        const { error } = await supabase
          .from("appliance_scans")
          .delete()
          .eq("id", entityId)
          .eq("store_number", action.store_number);
        if (error) throw error;
        return;
      }
      case "delete_remnant": {
        const { error } = await supabase
          .from("carpet_remnants")
          .delete()
          .eq("id", entityId)
          .eq("store_number", action.store_number);
        if (error) throw error;
        return;
      }
      case "delete_specialist": {
        const specialistId = String(
          entityId || (payload as { id?: string }).id || ""
        );
        if (!specialistId) throw new Error("Missing specialist id for delete");

        const soft = await supabase
          .from("store_specialists")
          .update({ is_active: false })
          .eq("id", specialistId)
          .eq("store_number", action.store_number);
        if (!soft.error) {
          await supabase
            .from("store_specialists")
            .delete()
            .eq("id", specialistId)
            .eq("store_number", action.store_number);
          return;
        }

        const { error } = await supabase
          .from("store_specialists")
          .delete()
          .eq("id", specialistId)
          .eq("store_number", action.store_number);
        if (error) throw error;
        return;
      }
      default:
        throw new Error(`Unknown sync action: ${action.type as string}`);
    }
  } catch (err) {
    if (isHttpConflict(err) && action.type.startsWith("upsert_")) {
      const server = (await fetchServerVersion(action)) ?? {
        id: entityId,
        updated_at: new Date().toISOString(),
        note: "HTTP 409 conflict from database",
      };
      throw new SyncConflictError("Database reported a write conflict (409)", {
        action,
        local: { ...action.payload },
        server,
      });
    }
    throw err;
  }
}

function scheduleRetry(action: SyncAction, err: unknown): SyncAction {
  const attempts = (action.attempts || 0) + 1;
  const delay = backoffMs(attempts);
  return {
    ...action,
    attempts,
    next_retry_at: new Date(Date.now() + delay).toISOString(),
    last_error:
      err instanceof Error
        ? err.message
        : typeof err === "object" &&
            err &&
            "message" in err &&
            typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : "Sync failed",
    force_overwrite: false,
  };
}

/**
 * Replay queued actions for the current store sequentially.
 * Returns the number of successfully synced actions.
 * Conflicts pause for supervisor choice; transient failures use exponential backoff.
 */
export async function flushSyncQueue(
  storeNumber = getStoreNumber()
): Promise<number> {
  if (flushing) return 0;
  if (!isBrowserOnline()) return 0;
  if (!getSupabase()) return 0;

  flushing = true;
  let synced = 0;

  try {
    const snapshot = readQueue();
    const now = Date.now();
    const pending = snapshot.filter((a) => a.store_number === storeNumber);
    const otherStores = snapshot.filter((a) => a.store_number !== storeNumber);

    if (pending.length === 0) {
      writeQueue(otherStores);
      return 0;
    }

    const deferred: SyncAction[] = [];
    const failed: SyncAction[] = [];

    for (const action of pending) {
      const retryAt = action.next_retry_at
        ? Date.parse(action.next_retry_at)
        : 0;
      if (Number.isFinite(retryAt) && retryAt > now) {
        deferred.push(action);
        continue;
      }

      try {
        await replayAction(action);
        synced += 1;
      } catch (err) {
        if (isSyncConflictError(err)) {
          const choice = await requestConflictResolution({
            action: err.action,
            local: err.local,
            server: err.server,
          });

          if (choice === "local") {
            try {
              await replayAction({
                ...action,
                force_overwrite: true,
                attempts: action.attempts,
                next_retry_at: null,
                last_error: null,
              });
              synced += 1;
            } catch (retryErr) {
              console.error(
                "[sync-queue] force overwrite failed",
                action.type,
                action.id,
                retryErr
              );
              failed.push(scheduleRetry(action, retryErr));
            }
          } else {
            // Accept server — drop local queue item and mirror server into local cache
            const config = UPSERT_CONFLICT_CONFIG[action.type];
            const storageKey = config
              ? LOCAL_KEYS[config.table as keyof typeof LOCAL_KEYS]
              : undefined;
            if (storageKey) {
              applyServerRowToLocal(storageKey, err.server);
            }
            // Dropped from queue (not pushed to failed)
          }
          continue;
        }

        console.error(
          "[sync-queue] replay failed",
          action.type,
          action.id,
          err
        );

        if (isTransientError(err)) {
          failed.push(scheduleRetry(action, err));
        } else {
          // Non-transient: still keep with backoff so it doesn't vanish silently
          failed.push(scheduleRetry(action, err));
        }
      }
    }

    writeQueue([...otherStores, ...deferred, ...failed]);
    scheduleRetryFlush([...deferred, ...failed]);

    if (failed.length === 0 && deferred.length === 0) {
      notifyQueueChanged();
    }

    return synced;
  } finally {
    flushing = false;
  }
}

/**
 * Install global online + visibility/focus flush listeners (idempotent).
 * Call once from OfflineNetworkBanner / app shell.
 */
export function installSyncAutoFlush(options?: {
  getStore?: () => string;
  onFlushStart?: () => void;
  onFlushComplete?: (synced: number) => void;
}): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (autoFlushInstalled) {
    return () => undefined;
  }

  const getStore = options?.getStore ?? getStoreNumber;

  const run = async () => {
    if (!isBrowserOnline()) return;
    options?.onFlushStart?.();
    try {
      const synced = await flushSyncQueue(getStore());
      options?.onFlushComplete?.(synced);
    } catch {
      options?.onFlushComplete?.(0);
    }
  };

  const onOnline = () => {
    void run();
  };
  const onFocus = () => {
    void run();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") void run();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);

  autoFlushInstalled = true;

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    autoFlushInstalled = false;
  };
}

export function isSyncAutoFlushInstalled(): boolean {
  return autoFlushInstalled;
}
