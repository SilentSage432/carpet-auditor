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
  | "delete_appliance_scan"
  | "clear_appliance_scans"
  | "lock_appliance_showroom_baseline"
  | "STORE_OPS_COMPLETE_ROTATION"
  | "STORE_OPS_DOWNSTOCK_ADD"
  | "STORE_OPS_SUNDAY_ASSIGN";

export type SyncActionStatus = "pending" | "quarantined";

export type SyncFailureReason =
  | "deterministic_4xx"
  | "max_retries_exceeded"
  | "unknown";

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
  /** Pending items replay on flush; quarantined items require supervisor action. */
  status?: SyncActionStatus;
  quarantined_at?: string | null;
  failure_reason?: SyncFailureReason | null;
  store_number: string;
  type: SyncActionType;
  payload: Record<string, unknown>;
};

export type EnqueueSyncOptions = {
  baseUpdatedAt?: string | null;
  transactionId?: string;
};

export type EnqueueOrExecuteResult = "executed" | "queued";

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
/** Transient replay failures quarantine after this many attempts. */
export const QUARANTINE_THRESHOLD = 3;

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

function normalizeStatus(raw: unknown): SyncActionStatus {
  return raw === "quarantined" ? "quarantined" : "pending";
}

function normalizeFailureReason(raw: unknown): SyncFailureReason | null {
  if (
    raw === "deterministic_4xx" ||
    raw === "max_retries_exceeded" ||
    raw === "unknown"
  ) {
    return raw;
  }
  return null;
}

function isPendingAction(action: SyncAction): boolean {
  return action.status !== "quarantined";
}

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
    status: normalizeStatus(row.status),
    quarantined_at:
      row.quarantined_at == null ? null : String(row.quarantined_at),
    failure_reason: normalizeFailureReason(row.failure_reason),
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

/** Actionable items still eligible for automatic replay. */
export function getPendingSync(storeNumber = getStoreNumber()): SyncAction[] {
  return readQueue().filter(
    (a) => a.store_number === storeNumber && isPendingAction(a)
  );
}

/** Items removed from automatic replay — require retry or discard. */
export function getQuarantinedSync(storeNumber = getStoreNumber()): SyncAction[] {
  return readQueue().filter(
    (a) => a.store_number === storeNumber && a.status === "quarantined"
  );
}

export function countPendingSync(storeNumber = getStoreNumber()): number {
  return getPendingSync(storeNumber).length;
}

export function countQuarantinedSync(storeNumber = getStoreNumber()): number {
  return getQuarantinedSync(storeNumber).length;
}

export type SyncQueueSummary = {
  pending: number;
  quarantined: number;
};

export function getSyncQueueSummary(
  storeNumber = getStoreNumber()
): SyncQueueSummary {
  return {
    pending: countPendingSync(storeNumber),
    quarantined: countQuarantinedSync(storeNumber),
  };
}

/**
 * Re-queue a quarantined action for automatic replay.
 * Resets attempts and clears quarantine metadata.
 */
export function retryQuarantinedAction(id: string): void {
  const queue = readQueue();
  const idx = queue.findIndex((a) => a.id === id && a.status === "quarantined");
  if (idx < 0) return;

  const action = queue[idx];
  queue[idx] = {
    ...action,
    status: "pending",
    attempts: 0,
    next_retry_at: null,
    last_error: null,
    quarantined_at: null,
    failure_reason: null,
    force_overwrite: false,
  };
  writeQueue(queue);

  if (isBrowserOnline() && getSupabase()) {
    void flushSyncQueue(action.store_number);
  }
}

/** Permanently drop a quarantined queue item. */
export function discardQuarantinedAction(id: string): void {
  writeQueue(readQueue().filter((a) => !(a.id === id && a.status === "quarantined")));
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
  const statusFromMessage = Number(
    (/\((\d{3})\)/.exec(message) ?? [])[1] ?? NaN
  );
  const httpStatus =
    Number.isFinite(status) && status > 0 ? status : statusFromMessage;

  if (httpStatus === 409 || code === "409") return false;
  if (httpStatus === 429 || httpStatus === 408 || httpStatus >= 500) return true;
  if (Number.isFinite(httpStatus) && httpStatus >= 400 && httpStatus < 500) {
    return false;
  }
  if (
    /network|fetch|timeout|temporar|unavailable|ECONN|ETIMEDOUT|offline|abort/i.test(
      message
    )
  ) {
    return true;
  }
  if (code === "PGRST301" || code === "57P01" || code === "08006") return true;
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return "Sync failed";
}

function classifyFailureReason(err: unknown): SyncFailureReason {
  if (isSyncConflictError(err)) return "unknown";
  if (isTransientError(err)) return "max_retries_exceeded";
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;
  const statusFromMessage = Number(
    (/\((\d{3})\)/.exec(errorMessage(err)) ?? [])[1] ?? NaN
  );
  const httpStatus =
    Number.isFinite(status) && status > 0 ? status : statusFromMessage;
  if (
    Number.isFinite(httpStatus) &&
    httpStatus >= 400 &&
    httpStatus < 500 &&
    httpStatus !== 408 &&
    httpStatus !== 429
  ) {
    return "deterministic_4xx";
  }
  return "unknown";
}

function quarantineAction(
  action: SyncAction,
  err: unknown,
  reason: SyncFailureReason
): SyncAction {
  return {
    ...action,
    status: "quarantined",
    quarantined_at: new Date().toISOString(),
    failure_reason: reason,
    last_error: errorMessage(err),
    next_retry_at: null,
    force_overwrite: false,
  };
}

function handleReplayFailure(
  action: SyncAction,
  err: unknown
): SyncAction {
  if (isDeterministicNonTransientError(err)) {
    return quarantineAction(action, err, classifyFailureReason(err));
  }

  const retried = scheduleRetry(action, err);
  if (retried.attempts >= QUARANTINE_THRESHOLD) {
    return quarantineAction(retried, err, "max_retries_exceeded");
  }
  return retried;
}

/** Permanent client/auth/validation failures — quarantine immediately. */
function isDeterministicNonTransientError(err: unknown): boolean {
  if (isSyncConflictError(err)) return false;
  return !isTransientError(err);
}

function syncEntityKey(
  type: SyncActionType,
  payload: Record<string, unknown>
): string | null {
  const id = payload.id != null ? String(payload.id).trim() : "";
  if (id) return id;
  if (type === "STORE_OPS_COMPLETE_ROTATION") {
    const rotationId = String(payload.rotation_id ?? "").trim();
    return rotationId || null;
  }
  if (type === "STORE_OPS_DOWNSTOCK_ADD") {
    const rotationId = String(payload.rotation_id ?? "").trim();
    const locationId = String(payload.location_id ?? "").trim();
    return rotationId || locationId || null;
  }
  if (type === "STORE_OPS_SUNDAY_ASSIGN") {
    const assignmentId = String(
      payload.assignment_id ?? payload.bay_id ?? ""
    ).trim();
    const week = String(payload.week ?? payload.week_starting ?? "").trim();
    if (!assignmentId) return null;
    return week ? `${week}:${assignmentId}` : assignmentId;
  }
  return null;
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
    status: "pending",
    quarantined_at: null,
    failure_reason: null,
    store_number: storeNumber,
    type,
    payload: { ...cleanPayload, store_number: storeNumber },
  };

  const entityKey = syncEntityKey(type, payload);
  const existing = readQueue().filter((a) => {
    const priorKey = syncEntityKey(a.type, a.payload);
    if (
      a.type === type &&
      a.store_number === storeNumber &&
      entityKey &&
      priorKey &&
      priorKey === entityKey
    ) {
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

/**
 * Run a live mutation, or enqueue it when offline / the request times out.
 * Permanent validation errors (4xx except 408/429) are rethrown for UI rollback.
 */
export async function enqueueOrExecute(
  type: SyncActionType,
  payload: Record<string, unknown>,
  execute: () => Promise<void>,
  storeNumber = getStoreNumber(),
  options?: EnqueueSyncOptions
): Promise<EnqueueOrExecuteResult> {
  if (shouldSaveOffline()) {
    enqueueSyncAction(type, payload, storeNumber, options);
    return "queued";
  }
  try {
    await execute();
    return "executed";
  } catch (err) {
    if (isTransientError(err) || !isBrowserOnline()) {
      enqueueSyncAction(type, payload, storeNumber, options);
      return "queued";
    }
    throw err;
  }
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
      case "clear_appliance_scans": {
        const preserve = Boolean(
          (payload as { preserve_showroom_baseline?: boolean })
            .preserve_showroom_baseline
        );
        let query = supabase
          .from("appliance_scans")
          .delete()
          .eq("store_number", action.store_number);
        if (preserve) {
          query = query.eq("is_showroom_baseline", false);
        }
        const { error } = await query;
        if (error) throw error;
        return;
      }
      case "lock_appliance_showroom_baseline": {
        await supabase
          .from("appliance_scans")
          .update({ is_showroom_baseline: false })
          .eq("store_number", action.store_number);
        const { error } = await supabase
          .from("appliance_scans")
          .update({ is_showroom_baseline: true })
          .eq("store_number", action.store_number)
          .eq("location_type", "showroom");
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
      case "STORE_OPS_COMPLETE_ROTATION": {
        const { executeCompleteRotationLive } = await import(
          "@/lib/store-ops/client"
        );
        await executeCompleteRotationLive(payload);
        return;
      }
      case "STORE_OPS_DOWNSTOCK_ADD": {
        const { executeDownstockAddLive } = await import(
          "@/lib/store-ops/downstock"
        );
        await executeDownstockAddLive(payload);
        return;
      }
      case "STORE_OPS_SUNDAY_ASSIGN": {
        const { executeSundayAssignLive } = await import(
          "@/lib/store-ops/sunday-audit"
        );
        await executeSundayAssignLive(payload);
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
    status: "pending",
    attempts,
    next_retry_at: new Date(Date.now() + delay).toISOString(),
    last_error: errorMessage(err),
    force_overwrite: false,
    quarantined_at: null,
    failure_reason: null,
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
    const otherStores = snapshot.filter((a) => a.store_number !== storeNumber);
    const forStore = snapshot.filter((a) => a.store_number === storeNumber);
    const heldQuarantined = forStore.filter((a) => a.status === "quarantined");
    const pending = forStore.filter(isPendingAction);

    if (pending.length === 0) {
      return 0;
    }

    const deferred: SyncAction[] = [];
    const failed: SyncAction[] = [];
    const newlyQuarantined: SyncAction[] = [];

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
              const outcome = handleReplayFailure(action, retryErr);
              if (outcome.status === "quarantined") {
                newlyQuarantined.push(outcome);
              } else {
                failed.push(outcome);
              }
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

        const outcome = handleReplayFailure(action, err);
        if (outcome.status === "quarantined") {
          newlyQuarantined.push(outcome);
        } else {
          failed.push(outcome);
        }
      }
    }

    writeQueue([
      ...otherStores,
      ...heldQuarantined,
      ...newlyQuarantined,
      ...deferred,
      ...failed,
    ]);
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
