/**
 * Appliance master catalog — owns public.appliance_catalog.
 * Flooring catalog stays in lib/catalog.ts (carpet_catalog).
 *
 * Teach-once identity: UPC ↔ Lowe's item # ↔ category ↔ sub-category ↔ description.
 * UPC is not DB-unique; application layer refuses ambiguous UPC remaps.
 */

import { sanitizeBarcodeScan } from "./barcode";
import { getStoreNumber } from "./store";
import { storeOpsAuthHeadersAsync } from "./store-ops/auth";
import { getSupabase } from "./supabase";
import {
  enqueueSyncAction,
  isBrowserOnline,
  shouldSaveOffline,
} from "./sync-queue";
import { uid } from "./uid";
import {
  normalizeApplianceCategory,
  resolveApplianceCategoryPair,
  type ApplianceCatalogItem,
  type ApplianceCatalogItemInsert,
  type ApplianceCategory,
} from "./types";

const STORAGE_KEY = "appliance_catalog_offline";
const TABLE = "appliance_catalog";

/** Raised when a UPC is already linked to a different catalog item. */
export class ApplianceCatalogConflictError extends Error {
  readonly conflict: ApplianceCatalogItem;

  constructor(message: string, conflict: ApplianceCatalogItem) {
    super(message);
    this.name = "ApplianceCatalogConflictError";
    this.conflict = conflict;
  }
}

function readAllLocal(): ApplianceCatalogItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => mapRow(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

function writeAllLocal(records: ApplianceCatalogItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function forStore(store = getStoreNumber()): ApplianceCatalogItem[] {
  return readAllLocal().filter((r) => r.store_number === store);
}

export function mapApplianceCatalogRow(
  row: Record<string, unknown>
): ApplianceCatalogItem {
  const upcRaw = row.upc ?? row.upc_barcode;
  const upc =
    upcRaw == null || upcRaw === ""
      ? null
      : sanitizeBarcodeScan(String(upcRaw));
  const pair = resolveApplianceCategoryPair(row.category, row.sub_category);

  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    item_number: String(row.item_number ?? row.sku ?? "").trim(),
    upc: upc && upc.length > 0 ? upc : null,
    description: String(row.description ?? row.carpet_name ?? "").trim(),
    category: pair.category,
    sub_category: pair.sub_category || undefined,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(
      row.updated_at ?? row.created_at ?? new Date().toISOString()
    ),
    offline: Boolean(row.offline),
  };
}

function mapRow(row: Record<string, unknown>): ApplianceCatalogItem {
  return mapApplianceCatalogRow(row);
}

/**
 * Find another catalog row that already owns this UPC.
 * Same item id / item_number is not a conflict (self-update).
 */
export function findApplianceUpcConflict(
  items: ApplianceCatalogItem[],
  upcRaw: string | null | undefined,
  options?: { excludeId?: string; excludeItemNumber?: string }
): ApplianceCatalogItem | undefined {
  const upc = upcRaw ? sanitizeBarcodeScan(upcRaw) : "";
  if (!upc) return undefined;
  const excludeItem = options?.excludeItemNumber
    ? sanitizeBarcodeScan(options.excludeItemNumber)
    : "";

  return items.find((item) => {
    if (options?.excludeId && item.id === options.excludeId) return false;
    if (
      excludeItem &&
      sanitizeBarcodeScan(item.item_number) === excludeItem
    ) {
      return false;
    }
    return (
      item.upc != null &&
      item.upc !== "" &&
      sanitizeBarcodeScan(item.upc) === upc
    );
  });
}

/** Search Item #, UPC, description, category, and sub-category for manage UI. */
export function filterApplianceCatalog(
  catalog: ApplianceCatalogItem[],
  query: string
): ApplianceCatalogItem[] {
  const sorted = [...catalog].sort((a, b) =>
    a.item_number.localeCompare(b.item_number)
  );
  const q = query.trim().toLowerCase();
  const qDigits = sanitizeBarcodeScan(query);
  if (!q && !qDigits) return sorted;

  return sorted.filter((item) => {
    if (
      item.item_number.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.sub_category ?? "").toLowerCase().includes(q)
    ) {
      return true;
    }
    if (!qDigits) return false;
    return (
      sanitizeBarcodeScan(item.item_number).includes(qDigits) ||
      (item.upc != null && sanitizeBarcodeScan(item.upc).includes(qDigits))
    );
  });
}

function assertNoUpcConflict(
  store: string,
  record: Pick<ApplianceCatalogItem, "id" | "item_number" | "upc">
): void {
  const conflict = findApplianceUpcConflict(forStore(store), record.upc, {
    excludeId: record.id,
    excludeItemNumber: record.item_number,
  });
  if (conflict) {
    throw new ApplianceCatalogConflictError(
      `UPC ${record.upc} is already linked to Item ${conflict.item_number}. Open Manage mappings and clear or change that link first.`,
      conflict
    );
  }
}

function upsertLocal(record: ApplianceCatalogItem): ApplianceCatalogItem[] {
  assertNoUpcConflict(record.store_number, record);

  const existing = readAllLocal().filter(
    (r) =>
      !(
        r.store_number === record.store_number &&
        (r.id === record.id || r.item_number === record.item_number)
      )
  );

  const next = [...existing, record].sort((a, b) =>
    a.item_number.localeCompare(b.item_number)
  );
  writeAllLocal(next);
  return forStore(record.store_number);
}

function catalogPayload(record: ApplianceCatalogItem) {
  return {
    id: record.id,
    store_number: record.store_number,
    item_number: record.item_number,
    upc: record.upc,
    description: record.description,
    category: record.category,
    sub_category: record.sub_category ?? "",
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export async function fetchApplianceCatalog(): Promise<ApplianceCatalogItem[]> {
  const store = getStoreNumber();
  const local = forStore(store);
  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("store_number", store)
      .order("item_number");
    if (error) throw error;
    const remote = (data ?? []).map((row) =>
      mapRow(row as Record<string, unknown>)
    );
    const offlineOnly = local.filter((r) => r.offline);
    const merged = [
      ...remote.filter((r) => !offlineOnly.some((o) => o.id === r.id)),
      ...offlineOnly,
    ].sort((a, b) => a.item_number.localeCompare(b.item_number));
    writeAllLocal([
      ...readAllLocal().filter((r) => r.store_number !== store),
      ...merged,
    ]);
    return merged;
  } catch {
    return local;
  }
}

export async function saveApplianceCatalogItem(
  input: ApplianceCatalogItemInsert
): Promise<{ record: ApplianceCatalogItem; offline: boolean }> {
  const now = new Date().toISOString();
  const store = input.store_number ?? getStoreNumber();
  const upcRaw = input.upc;
  const upc =
    upcRaw == null || upcRaw === ""
      ? null
      : sanitizeBarcodeScan(String(upcRaw));
  const pair = resolveApplianceCategoryPair(
    input.category,
    input.sub_category
  );

  const record: ApplianceCatalogItem = {
    id: input.id ?? uid(),
    store_number: store,
    item_number: String(input.item_number).trim(),
    upc: upc && upc.length > 0 ? upc : null,
    description: String(input.description ?? "").trim(),
    category: pair.category,
    sub_category: pair.sub_category || undefined,
    created_at: now,
    updated_at: now,
    offline: false,
  };

  assertNoUpcConflict(store, record);

  /**
   * Online: actor-bound catalog API only.
   * Application responses (400/401/403/409/5xx) MUST remain failures —
   * never fall through to direct client Supabase upsert.
   * Network unavailable (no HTTP response): intentional offline teach queue.
   */
  if (isBrowserOnline()) {
    let gotHttpResponse = false;
    try {
      const authHeaders = await storeOpsAuthHeadersAsync();
      const res = await fetch("/api/appliances/catalog", {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          "x-store-number": store,
        },
        body: JSON.stringify({
          id: record.id,
          store_number: store,
          item_number: record.item_number,
          upc: record.upc,
          description: record.description,
          category: record.category,
          sub_category: record.sub_category ?? "",
        }),
      });
      gotHttpResponse = true;
      const json = (await res.json().catch(() => ({}))) as {
        item?: Record<string, unknown>;
        error?: string;
        conflict?: Record<string, unknown>;
      };

      if (res.status === 409) {
        const conflictRow = json.conflict ? mapRow(json.conflict) : null;
        throw new ApplianceCatalogConflictError(
          json.error ||
            `UPC ${record.upc} is already linked to another item.`,
          conflictRow ??
            ({
              id: "unknown",
              store_number: store,
              item_number: "?",
              upc: record.upc,
              description: "",
              category: "Laundry",
              created_at: now,
              updated_at: now,
            } satisfies ApplianceCatalogItem)
        );
      }

      if (!res.ok) {
        const raw = json.error || `Catalog save failed (${res.status})`;
        if (/store_number/i.test(raw)) {
          throw new Error(
            "Appliance catalog is missing store_number on the server. Apply migration 20260907_appliance_catalog_store_number.sql, then retry teach."
          );
        }
        throw new Error(raw);
      }
      if (!json.item) {
        throw new Error("API returned no catalog item");
      }

      const saved = mapRow(json.item);
      const existing = readAllLocal().filter(
        (r) =>
          !(
            r.store_number === saved.store_number &&
            (r.id === saved.id || r.item_number === saved.item_number)
          )
      );
      writeAllLocal(
        [...existing, saved].sort((a, b) =>
          a.item_number.localeCompare(b.item_number)
        )
      );
      return { record: saved, offline: false };
    } catch (err) {
      if (err instanceof ApplianceCatalogConflictError) throw err;
      // HTTP application/auth/validation failures stay failures.
      if (gotHttpResponse) throw err;
      // No HTTP response (network down / aborted) → offline teach queue.
      const offlineRecord = { ...record, offline: true };
      upsertLocal(offlineRecord);
      enqueueSyncAction(
        "upsert_appliance_catalog",
        catalogPayload(offlineRecord),
        store
      );
      return { record: offlineRecord, offline: true };
    }
  }

  // Explicit browser offline (or offline-forced): queue for replay.
  const offlineRecord = { ...record, offline: true };
  upsertLocal(offlineRecord);
  enqueueSyncAction(
    "upsert_appliance_catalog",
    catalogPayload(offlineRecord),
    store
  );
  return { record: offlineRecord, offline: true };
}

export async function deleteApplianceCatalogItem(id: string): Promise<void> {
  const store = getStoreNumber();
  writeAllLocal(readAllLocal().filter((r) => r.id !== id));

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    enqueueSyncAction("delete_appliance_catalog", { id }, store);
    return;
  }

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("store_number", store);
  if (error) {
    enqueueSyncAction("delete_appliance_catalog", { id }, store);
  }
}

export function findApplianceByItemOrUpc(
  items: ApplianceCatalogItem[],
  raw: string
): ApplianceCatalogItem | undefined {
  const key = sanitizeBarcodeScan(raw);
  if (!key) return undefined;
  return items.find(
    (item) =>
      sanitizeBarcodeScan(item.item_number) === key ||
      (item.upc != null &&
        item.upc !== "" &&
        sanitizeBarcodeScan(item.upc) === key)
  );
}

export type ApplianceScanResolution =
  | { kind: "matched"; item: ApplianceCatalogItem; scanned: string }
  | { kind: "unlinked_barcode"; scanned: string }
  | { kind: "unknown_sku"; scanned: string }
  | { kind: "empty" };

export function resolveApplianceScan(
  items: ApplianceCatalogItem[],
  raw: string
): ApplianceScanResolution {
  const scanned = sanitizeBarcodeScan(raw);
  if (!scanned) return { kind: "empty" };

  const item = findApplianceByItemOrUpc(items, scanned);
  if (item) return { kind: "matched", item, scanned };

  if (scanned.length >= 8) {
    return { kind: "unlinked_barcode", scanned };
  }
  return { kind: "unknown_sku", scanned };
}

export function applianceCategoryLabel(
  category: ApplianceCategory | string
): string {
  return normalizeApplianceCategory(category);
}
