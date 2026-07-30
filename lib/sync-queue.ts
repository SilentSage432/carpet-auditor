/**
 * Offline sync queue — owns pending Supabase writes and auto-replay.
 * Domain modules enqueue when offline; this module does not own domain knowledge.
 */

import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import { uid } from "./uid";

export const SYNC_QUEUE_KEY = "carpet_hub_sync_queue";

export type SyncActionType =
  | "upsert_audit"
  | "upsert_catalog"
  | "upsert_remnant"
  | "upsert_specialist"
  | "delete_audit"
  | "delete_catalog"
  | "delete_remnant"
  | "delete_specialist";

export type SyncAction = {
  id: string;
  created_at: string;
  store_number: string;
  type: SyncActionType;
  payload: Record<string, unknown>;
};

const LOCAL_KEYS: Record<string, string> = {
  carpet_audits: "carpet_audits_offline",
  carpet_catalog: "carpet_catalog_offline",
  carpet_remnants: "carpet_remnants_offline",
  store_specialists: "carpet_specialists_offline",
};

let flushing = false;

function readQueue(): SyncAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SyncAction[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(actions: SyncAction[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(actions));
  window.dispatchEvent(new CustomEvent("carpet-sync-queue-changed"));
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

export function enqueueSyncAction(
  type: SyncActionType,
  payload: Record<string, unknown>,
  storeNumber = getStoreNumber()
): SyncAction {
  const action: SyncAction = {
    id: uid("sync"),
    created_at: new Date().toISOString(),
    store_number: storeNumber,
    type,
    payload: { ...payload, store_number: storeNumber },
  };

  const existing = readQueue().filter((a) => {
    // Collapse duplicate upserts for the same entity id
    if (
      a.type === type &&
      a.store_number === storeNumber &&
      a.payload.id != null &&
      payload.id != null &&
      String(a.payload.id) === String(payload.id)
    ) {
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

async function replayAction(action: SyncAction): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");

  const payload: Record<string, unknown> = {
    ...action.payload,
    store_number: action.store_number,
  };
  const entityId = String(payload.id ?? "");

  switch (action.type) {
    case "upsert_audit": {
      const { error } = await supabase.from("carpet_audits").upsert(payload);
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
    case "upsert_remnant": {
      const { error } = await supabase.from("carpet_remnants").upsert(payload);
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

      // Soft-delete first so FK history cannot block removal.
      const soft = await supabase
        .from("store_specialists")
        .update({ is_active: false })
        .eq("id", specialistId)
        .eq("store_number", action.store_number);
      if (!soft.error) {
        // Best-effort hard delete when no FK blocks it.
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
}

/**
 * Replay queued actions for the current store sequentially.
 * Returns the number of successfully synced actions.
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
    const pending = readQueue().filter((a) => a.store_number === storeNumber);
    const remaining = readQueue().filter((a) => a.store_number !== storeNumber);

    for (const action of pending) {
      try {
        await replayAction(action);
        synced += 1;
      } catch {
        remaining.push(action);
      }
    }

    writeQueue(remaining);
    return synced;
  } finally {
    flushing = false;
  }
}
