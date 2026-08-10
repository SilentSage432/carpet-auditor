/**
 * Appliance floor scans — owns public.appliance_scans.
 * Flooring cycle audits stay in lib/storage.ts (carpet_audits).
 */

import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import { enqueueSyncAction, shouldSaveOffline } from "./sync-queue";
import { uid } from "./uid";
import {
  normalizeApplianceCategory,
  resolveApplianceCategoryPair,
  type ApplianceScan,
  type ApplianceScanInsert,
} from "./types";

const STORAGE_KEY = "appliance_scans_offline";
const TABLE = "appliance_scans";

function readAllLocal(): ApplianceScan[] {
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

function writeAllLocal(records: ApplianceScan[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function forStore(store = getStoreNumber()): ApplianceScan[] {
  return readAllLocal().filter((r) => r.store_number === store);
}

export function mapApplianceScanRow(row: Record<string, unknown>): ApplianceScan {
  const pair = resolveApplianceCategoryPair(row.category, row.sub_category);
  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    item_number: String(row.item_number ?? row.sku ?? "").trim(),
    serial_number: String(row.serial_number ?? "").trim(),
    location: String(row.location ?? row.sims_location ?? "").trim(),
    category: pair.category,
    sub_category: pair.sub_category || undefined,
    scanned_by: String(row.scanned_by ?? row.audited_by ?? "").trim(),
    scanned_at: String(
      row.scanned_at ?? row.created_at ?? new Date().toISOString()
    ),
    offline: Boolean(row.offline),
  };
}

function mapRow(row: Record<string, unknown>): ApplianceScan {
  return mapApplianceScanRow(row);
}

function upsertLocal(record: ApplianceScan): void {
  const next = [
    record,
    ...readAllLocal().filter(
      (r) => !(r.id === record.id && r.store_number === record.store_number)
    ),
  ].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
  writeAllLocal(next);
}

function scanPayload(record: ApplianceScan) {
  return {
    id: record.id,
    store_number: record.store_number,
    item_number: record.item_number,
    serial_number: record.serial_number,
    location: record.location,
    category: record.category,
    sub_category: record.sub_category ?? "",
    scanned_by: record.scanned_by,
    scanned_at: record.scanned_at,
  };
}

export async function fetchApplianceScans(): Promise<ApplianceScan[]> {
  const store = getStoreNumber();
  const local = forStore(store);
  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) return local;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("store_number", store)
      .order("scanned_at", { ascending: false });
    if (error) throw error;
    const remote = (data ?? []).map((row) =>
      mapRow(row as Record<string, unknown>)
    );
    const offlineOnly = local.filter((r) => r.offline);
    const merged = [
      ...remote.filter((r) => !offlineOnly.some((o) => o.id === r.id)),
      ...offlineOnly,
    ].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
    writeAllLocal([
      ...readAllLocal().filter((r) => r.store_number !== store),
      ...merged,
    ]);
    return merged;
  } catch {
    return local;
  }
}

export async function saveApplianceScan(
  input: ApplianceScanInsert
): Promise<{ record: ApplianceScan; offline: boolean }> {
  const now = new Date().toISOString();
  const store = input.store_number ?? getStoreNumber();
  const pair = resolveApplianceCategoryPair(
    input.category,
    input.sub_category
  );

  const record: ApplianceScan = {
    id: input.id ?? uid(),
    store_number: store,
    item_number: String(input.item_number).trim(),
    serial_number: String(input.serial_number ?? "").trim(),
    location: String(input.location ?? "").trim(),
    category: normalizeApplianceCategory(pair.category),
    sub_category: pair.sub_category || undefined,
    scanned_by: String(input.scanned_by ?? "").trim(),
    scanned_at: input.scanned_at ?? now,
    offline: false,
  };

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction(
      "upsert_appliance_scan",
      scanPayload(offlineRecord),
      store
    );
    return { record: offlineRecord, offline: true };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(scanPayload(record), { onConflict: "id" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const saved = data ? mapRow(data as Record<string, unknown>) : record;
    upsertLocal(saved);
    return { record: saved, offline: false };
  } catch {
    const offlineRecord = { ...record, offline: true };
    upsertLocal(offlineRecord);
    enqueueSyncAction(
      "upsert_appliance_scan",
      scanPayload(offlineRecord),
      store
    );
    return { record: offlineRecord, offline: true };
  }
}

export async function deleteApplianceScan(id: string): Promise<void> {
  const store = getStoreNumber();
  writeAllLocal(readAllLocal().filter((r) => r.id !== id));

  const supabase = getSupabase();
  if (!supabase || shouldSaveOffline()) {
    enqueueSyncAction("delete_appliance_scan", { id }, store);
    return;
  }

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("store_number", store);
  if (error) {
    enqueueSyncAction("delete_appliance_scan", { id }, store);
  }
}

export function isApplianceScanToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** CSV for appliance inventory / audit sheets. */
export function applianceScansToCsv(scans: ApplianceScan[]): string {
  const header = [
    "Category",
    "Sub-Category",
    "Item #",
    "Serial #",
    "Location",
    "Scanned By",
    "Scanned At",
    "Store #",
  ];

  const escape = (value: string | number | null | undefined) => {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const rows = scans.map((s) =>
    [
      s.category,
      s.sub_category ?? "",
      s.item_number,
      s.serial_number,
      s.location,
      s.scanned_by,
      s.scanned_at,
      s.store_number,
    ]
      .map(escape)
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}
