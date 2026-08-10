import { calculateSquareFeet, calculateSquareYards } from "./calc";
import { uid } from "./uid";
import type { Remnant, RemnantInsert, RemnantStatus } from "./types";
import { normalizeCategory } from "./types";
import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import {
  enqueueSyncAction,
  shouldSaveOffline,
} from "./sync-queue";

const STORAGE_KEY = "carpet_remnants_offline";
const TABLE = "carpet_remnants";

function readAllLocal(): Remnant[] {
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

function writeAllLocal(records: Remnant[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function forStore(store = getStoreNumber()): Remnant[] {
  return readAllLocal().filter((r) => r.store_number === store);
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: Record<string, unknown>): Remnant {
  const width = Number(row.width_ft ?? 12);
  const length = Number(row.length_ft ?? 0);
  const sqFt = Number(row.square_feet ?? calculateSquareFeet(width, length));
  const status = String(row.status ?? "available") as RemnantStatus;

  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    sku: String(row.sku ?? ""),
    carpet_name: String(row.carpet_name ?? ""),
    category: normalizeCategory(row.category),
    tag_number: String(row.tag_number ?? ""),
    width_ft: width,
    length_ft: length,
    square_feet: sqFt,
    square_yards: Number(row.square_yards ?? calculateSquareYards(sqFt)),
    location: String(row.location ?? ""),
    notes: String(row.notes ?? ""),
    status:
      status === "reserved" || status === "sold" || status === "available"
        ? status
        : "available",
    reserved_for: String(row.reserved_for ?? ""),
    logged_by: String(row.logged_by ?? ""),
    estimated_value: nullableNumber(row.estimated_value),
    markdown_percent: nullableNumber(row.markdown_percent),
    markdown_price: nullableNumber(row.markdown_price),
    markdown_notes: String(row.markdown_notes ?? ""),
    markdown_by: String(row.markdown_by ?? ""),
    markdown_at:
      row.markdown_at == null || row.markdown_at === ""
        ? null
        : String(row.markdown_at),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    offline: Boolean(row.offline),
  };
}

function upsertLocal(record: Remnant): Remnant[] {
  const existing = readAllLocal().filter((r) => r.id !== record.id);
  const next = [record, ...existing].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  writeAllLocal(next);
  return forStore(record.store_number);
}

export function getLocalRemnants(): Remnant[] {
  return forStore();
}

export function countLocalRemnants(): number {
  return forStore().length;
}

function remnantPayload(record: Remnant) {
  return {
    id: record.id,
    store_number: record.store_number,
    sku: record.sku,
    carpet_name: record.carpet_name,
    category: record.category,
    tag_number: record.tag_number,
    width_ft: record.width_ft,
    length_ft: record.length_ft,
    square_feet: record.square_feet,
    square_yards: record.square_yards,
    location: record.location,
    notes: record.notes,
    status: record.status,
    reserved_for: record.reserved_for,
    logged_by: record.logged_by,
    estimated_value: record.estimated_value,
    markdown_percent: record.markdown_percent,
    markdown_price: record.markdown_price,
    markdown_notes: record.markdown_notes,
    markdown_by: record.markdown_by,
    markdown_at: record.markdown_at,
    updated_at: record.updated_at,
    created_at: record.created_at,
  };
}

export async function fetchRemnants(): Promise<Remnant[]> {
  const store = getStoreNumber();
  const local = forStore(store);
  const supabase = getSupabase();

  if (!supabase || shouldSaveOffline()) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("store_number", store)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const remote = (data ?? []).map((row) =>
      mapRow({ ...(row as Record<string, unknown>), offline: false })
    );
    const remoteIds = new Set(remote.map((r) => r.id));
    const offlineOnly = local.filter((r) => r.offline && !remoteIds.has(r.id));

    return [...offlineOnly, ...remote].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  } catch {
    return local;
  }
}

function buildRemnant(input: RemnantInsert, existing?: Remnant): Remnant {
  const now = new Date().toISOString();
  const width = input.width_ft;
  const length = input.length_ft;
  const sqFt = input.square_feet ?? calculateSquareFeet(width, length);
  const sqYd = input.square_yards ?? calculateSquareYards(sqFt);
  const store = input.store_number ?? existing?.store_number ?? getStoreNumber();

  return {
    id: input.id ?? existing?.id ?? uid(),
    store_number: store,
    sku: input.sku.trim(),
    carpet_name: input.carpet_name.trim(),
    category: normalizeCategory(input.category ?? existing?.category),
    tag_number: input.tag_number.trim(),
    width_ft: width,
    length_ft: length,
    square_feet: sqFt,
    square_yards: sqYd,
    location: input.location.trim(),
    notes: input.notes.trim(),
    status: input.status,
    reserved_for: (input.reserved_for ?? "").trim(),
    logged_by: (input.logged_by ?? existing?.logged_by ?? "").trim(),
    estimated_value:
      input.estimated_value !== undefined
        ? input.estimated_value
        : (existing?.estimated_value ?? null),
    markdown_percent:
      input.markdown_percent !== undefined
        ? input.markdown_percent
        : (existing?.markdown_percent ?? null),
    markdown_price:
      input.markdown_price !== undefined
        ? input.markdown_price
        : (existing?.markdown_price ?? null),
    markdown_notes:
      input.markdown_notes !== undefined
        ? input.markdown_notes
        : (existing?.markdown_notes ?? ""),
    markdown_by:
      input.markdown_by !== undefined
        ? input.markdown_by
        : (existing?.markdown_by ?? ""),
    markdown_at:
      input.markdown_at !== undefined
        ? input.markdown_at
        : (existing?.markdown_at ?? null),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    offline: false,
  };
}

export async function saveRemnant(
  input: RemnantInsert,
  existing?: Remnant
): Promise<{ record: Remnant; offline: boolean }> {
  const record = buildRemnant(input, existing);
  const supabase = getSupabase();
  const store = record.store_number;

  if (!supabase || shouldSaveOffline()) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_remnant", remnantPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(remnantPayload(record), { onConflict: "id" })
      .select("*")
      .single();

    if (error) throw error;

    const saved = mapRow({ ...(data as Record<string, unknown>), offline: false });
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_remnant", remnantPayload(offlineRecord), store);
    return { record: offlineRecord, offline: true };
  }
}

export async function deleteRemnant(id: string): Promise<void> {
  const store = getStoreNumber();
  writeAllLocal(readAllLocal().filter((r) => r.id !== id));
  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    enqueueSyncAction("delete_remnant", { id }, store);
    return;
  }
  try {
    await supabase.from(TABLE).delete().eq("id", id).eq("store_number", store);
  } catch {
    enqueueSyncAction("delete_remnant", { id }, store);
  }
}
