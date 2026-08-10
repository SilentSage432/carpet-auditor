/**
 * Appliance master catalog — owns public.appliance_catalog.
 * Flooring catalog stays in lib/catalog.ts (carpet_catalog).
 */

import { sanitizeBarcodeScan } from "./barcode";
import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import { enqueueSyncAction, shouldSaveOffline } from "./sync-queue";
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

function upsertLocal(record: ApplianceCatalogItem): ApplianceCatalogItem[] {
  const upc = record.upc ? sanitizeBarcodeScan(record.upc) : null;
  const existing = readAllLocal()
    .filter(
      (r) =>
        !(
          r.store_number === record.store_number &&
          (r.id === record.id || r.item_number === record.item_number)
        )
    )
    .map((r) => {
      if (
        upc &&
        r.store_number === record.store_number &&
        r.upc &&
        sanitizeBarcodeScan(r.upc) === upc
      ) {
        return { ...r, upc: null };
      }
      return r;
    });

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

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction(
      "upsert_appliance_catalog",
      catalogPayload(offlineRecord),
      store
    );
    return { record: offlineRecord, offline: true };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(catalogPayload(record), { onConflict: "store_number,item_number" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const saved = data
      ? mapRow(data as Record<string, unknown>)
      : record;
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
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
