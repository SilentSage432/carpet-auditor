import { sanitizeBarcodeScan } from "./barcode";
import { uid } from "./uid";
import type { CatalogItem, CatalogItemInsert } from "./types";
import { getSupabase } from "./supabase";

const STORAGE_KEY = "carpet_catalog_offline";
const TABLE = "carpet_catalog";

function readLocal(): CatalogItem[] {
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

function writeLocal(records: CatalogItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function mapRow(row: Record<string, unknown>): CatalogItem {
  const upcRaw = row.upc_barcode;
  const upc =
    upcRaw == null || upcRaw === ""
      ? null
      : sanitizeBarcodeScan(String(upcRaw));

  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    carpet_name: String(row.carpet_name ?? ""),
    vendor: String(row.vendor ?? ""),
    roll_width_ft: Number(row.roll_width_ft ?? 12),
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

  const existing = readLocal()
    .filter((r) => r.id !== record.id && r.sku !== record.sku)
    .map((r) => {
      // Keep UPC unique locally when linking
      if (upc && r.upc_barcode && sanitizeBarcodeScan(r.upc_barcode) === upc) {
        return { ...r, upc_barcode: null };
      }
      return r;
    });

  const next = [
    { ...record, upc_barcode: upc && upc.length > 0 ? upc : null },
    ...existing,
  ].sort((a, b) => a.sku.localeCompare(b.sku));
  writeLocal(next);
  return next;
}

export function getLocalCatalog(): CatalogItem[] {
  return readLocal();
}

export function countLocalCatalog(): number {
  return readLocal().length;
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

export async function fetchCatalog(): Promise<CatalogItem[]> {
  const supabase = getSupabase();
  const local = getLocalCatalog();

  if (!supabase) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
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
  const upcRaw = input.upc_barcode;
  const upc =
    upcRaw == null || upcRaw === ""
      ? null
      : sanitizeBarcodeScan(String(upcRaw));

  const record: CatalogItem = {
    id: input.id ?? uid(),
    sku: input.sku.trim(),
    carpet_name: input.carpet_name.trim(),
    vendor: (input.vendor ?? "").trim(),
    roll_width_ft: input.roll_width_ft ?? 12,
    upc_barcode: upc && upc.length > 0 ? upc : null,
    created_at: now,
    updated_at: now,
    offline: false,
  };

  const supabase = getSupabase();

  if (!supabase) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    return { record: offlineRecord, offline: true };
  }

  try {
    // Clear this UPC from other rows remotely when linking
    if (record.upc_barcode) {
      await supabase
        .from(TABLE)
        .update({ upc_barcode: null, updated_at: now })
        .eq("upc_barcode", record.upc_barcode)
        .neq("sku", record.sku);
    }

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          id: record.id,
          sku: record.sku,
          carpet_name: record.carpet_name,
          vendor: record.vendor,
          roll_width_ft: record.roll_width_ft,
          upc_barcode: record.upc_barcode,
          updated_at: record.updated_at,
        },
        { onConflict: "sku" }
      )
      .select("*")
      .single();

    if (error) throw error;

    const saved = mapRow({ ...(data as Record<string, unknown>), offline: false });
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    return { record: offlineRecord, offline: true };
  }
}

export async function clearCatalogBarcode(item: CatalogItem): Promise<{
  record: CatalogItem;
  offline: boolean;
}> {
  return saveCatalogItem({
    id: item.id,
    sku: item.sku,
    carpet_name: item.carpet_name,
    vendor: item.vendor,
    roll_width_ft: item.roll_width_ft,
    upc_barcode: null,
  });
}

export async function deleteCatalogItem(id: string): Promise<void> {
  const local = readLocal();
  writeLocal(local.filter((r) => r.id !== id));

  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from(TABLE).delete().eq("id", id);
  } catch {
    /* local already removed */
  }
}
