import { sanitizeBarcodeScan } from "./barcode";
import { uid } from "./uid";
import type { CatalogItem, CatalogItemInsert } from "./types";
import {
  isApplianceCategory,
  normalizeCategory,
  resolveApplianceCategoryPair,
} from "./types";
import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import {
  enqueueSyncAction,
  shouldSaveOffline,
} from "./sync-queue";

const STORAGE_KEY = "carpet_catalog_offline";
const TABLE = "carpet_catalog";

function readAllLocal(): CatalogItem[] {
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

function writeAllLocal(records: CatalogItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function forStore(store = getStoreNumber()): CatalogItem[] {
  return readAllLocal().filter((r) => r.store_number === store);
}

function mapRow(row: Record<string, unknown>): CatalogItem {
  const upcRaw = row.upc_barcode;
  const upc =
    upcRaw == null || upcRaw === ""
      ? null
      : sanitizeBarcodeScan(String(upcRaw));

  const sqftRaw = row.sqft_per_box;
  const sqftPerBox =
    sqftRaw == null || sqftRaw === ""
      ? null
      : Number(sqftRaw);

  const category = normalizeCategory(row.category);
  const sub_category = isApplianceCategory(category)
    ? resolveApplianceCategoryPair(row.category, row.sub_category).sub_category
    : String(row.sub_category ?? "").trim();

  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    sku: String(row.sku ?? ""),
    carpet_name: String(row.carpet_name ?? ""),
    vendor: String(row.vendor ?? ""),
    category,
    sub_category,
    default_sims_location: String(
      row.default_sims_location ?? row.sims_location ?? ""
    ),
    roll_width_ft: Number(row.roll_width_ft ?? 12),
    sqft_per_box:
      sqftPerBox != null && Number.isFinite(sqftPerBox) ? sqftPerBox : null,
    upc_barcode: upc && upc.length > 0 ? upc : null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    offline: Boolean(row.offline),
  };
}

function upsertLocal(record: CatalogItem): CatalogItem[] {
  const upc = record.upc_barcode
    ? sanitizeBarcodeScan(record.upc_barcode)
    : null;

  const existing = readAllLocal()
    .filter(
      (r) =>
        !(
          r.store_number === record.store_number &&
          (r.id === record.id || r.sku === record.sku)
        )
    )
    .map((r) => {
      if (
        upc &&
        r.store_number === record.store_number &&
        r.upc_barcode &&
        sanitizeBarcodeScan(r.upc_barcode) === upc
      ) {
        return { ...r, upc_barcode: null };
      }
      return r;
    });

  const next = [
    { ...record, upc_barcode: upc && upc.length > 0 ? upc : null },
    ...existing,
  ].sort((a, b) => a.sku.localeCompare(b.sku));
  writeAllLocal(next);
  return forStore(record.store_number);
}

export function getLocalCatalog(): CatalogItem[] {
  return forStore();
}

export function countLocalCatalog(): number {
  return forStore().length;
}

export function findCatalogBySku(
  items: CatalogItem[],
  sku: string
): CatalogItem | undefined {
  const key = sanitizeBarcodeScan(sku);
  if (!key) return undefined;
  return items.find((i) => sanitizeBarcodeScan(i.sku) === key);
}

export { findCatalogBySkuOrBarcode } from "./barcode";

function catalogPayload(record: CatalogItem) {
  return {
    id: record.id,
    store_number: record.store_number,
    sku: record.sku,
    carpet_name: record.carpet_name,
    vendor: record.vendor,
    category: record.category,
    sub_category: record.sub_category ?? "",
    default_sims_location: record.default_sims_location,
    roll_width_ft: record.roll_width_ft,
    sqft_per_box: record.sqft_per_box,
    upc_barcode: record.upc_barcode,
    updated_at: record.updated_at,
    created_at: record.created_at,
  };
}

export async function fetchCatalog(): Promise<CatalogItem[]> {
  const store = getStoreNumber();
  const local = forStore(store);
  const supabase = getSupabase();

  if (!supabase || shouldSaveOffline()) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("store_number", store)
      .order("sku", { ascending: true });

    if (error) throw error;

    const remote = (data ?? []).map((row) =>
      mapRow({ ...(row as Record<string, unknown>), offline: false })
    );
    const remoteSkus = new Set(remote.map((r) => r.sku));
    const offlineOnly = local.filter((r) => r.offline && !remoteSkus.has(r.sku));

    return [...offlineOnly, ...remote].sort((a, b) => a.sku.localeCompare(b.sku));
  } catch {
    return local;
  }
}

export async function saveCatalogItem(input: CatalogItemInsert): Promise<{
  record: CatalogItem;
  offline: boolean;
}> {
  const now = new Date().toISOString();
  const store = input.store_number ?? getStoreNumber();
  const upcRaw = input.upc_barcode;
  const upc =
    upcRaw == null || upcRaw === ""
      ? null
      : sanitizeBarcodeScan(String(upcRaw));

  const record: CatalogItem = {
    id: input.id ?? uid(),
    store_number: store,
    sku: input.sku.trim(),
    carpet_name: input.carpet_name.trim(),
    vendor: (input.vendor ?? "").trim(),
    category: normalizeCategory(input.category),
    sub_category: isApplianceCategory(input.category)
      ? resolveApplianceCategoryPair(input.category, input.sub_category)
          .sub_category
      : String(input.sub_category ?? "").trim(),
    default_sims_location: (input.default_sims_location ?? "").trim(),
    roll_width_ft: input.roll_width_ft ?? 12,
    sqft_per_box:
      input.sqft_per_box != null && Number.isFinite(input.sqft_per_box)
        ? input.sqft_per_box
        : null,
    upc_barcode: upc && upc.length > 0 ? upc : null,
    created_at: now,
    updated_at: now,
    offline: false,
  };

  const supabase = getSupabase();

  if (!supabase || shouldSaveOffline()) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_catalog", catalogPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }

  try {
    if (record.upc_barcode) {
      await supabase
        .from(TABLE)
        .update({ upc_barcode: null, updated_at: now })
        .eq("store_number", store)
        .eq("upc_barcode", record.upc_barcode)
        .neq("sku", record.sku);
    }

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(catalogPayload(record), { onConflict: "store_number,sku" })
      .select("*")
      .single();

    if (error) throw error;

    const saved = mapRow({ ...(data as Record<string, unknown>), offline: false });
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_catalog", catalogPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }
}

export async function clearCatalogBarcode(item: CatalogItem): Promise<{
  record: CatalogItem;
  offline: boolean;
}> {
  return saveCatalogItem({
    id: item.id,
    store_number: item.store_number,
    sku: item.sku,
    carpet_name: item.carpet_name,
    vendor: item.vendor,
    category: item.category,
    sub_category: item.sub_category,
    default_sims_location: item.default_sims_location,
    roll_width_ft: item.roll_width_ft,
    sqft_per_box: item.sqft_per_box,
    upc_barcode: null,
  });
}

export async function deleteCatalogItem(id: string): Promise<void> {
  const store = getStoreNumber();
  writeAllLocal(readAllLocal().filter((r) => r.id !== id));

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    enqueueSyncAction("delete_catalog", { id }, store);
    return;
  }
  try {
    await supabase.from(TABLE).delete().eq("id", id).eq("store_number", store);
  } catch {
    enqueueSyncAction("delete_catalog", { id }, store);
  }
}
