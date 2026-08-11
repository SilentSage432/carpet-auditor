/**
 * Appliance floor scans — owns public.appliance_scans.
 * Flooring cycle audits stay in lib/storage.ts (carpet_audits).
 *
 * Online saves go through POST /api/appliances/scans (service role) and throw
 * on failure — never silently report success via the offline queue.
 */

import { getStoreNumber } from "./store";
import { getSupabase } from "./supabase";
import { enqueueSyncAction, isBrowserOnline } from "./sync-queue";
import { uid } from "./uid";
import {
  isValidApplianceSubCategory,
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

/** Schema-aligned payload for appliance_scans insert / API body. */
export function buildApplianceScanPayload(
  input: ApplianceScanInsert,
  store = input.store_number ?? getStoreNumber()
): {
  store_number: string;
  item_number: string;
  serial_number: string;
  location: string;
  category: string;
  sub_category: string;
  scanned_by: string;
  scanned_at: string;
  id?: string;
} {
  const pair = resolveApplianceCategoryPair(
    input.category,
    input.sub_category
  );
  const category = normalizeApplianceCategory(pair.category);
  const sub_category = pair.sub_category;

  if (!String(input.item_number ?? "").trim()) {
    throw new Error("item_number is required");
  }
  if (!isValidApplianceSubCategory(category, sub_category)) {
    throw new Error(
      "Valid sub_category is required for the selected category"
    );
  }

  const payload: {
    store_number: string;
    item_number: string;
    serial_number: string;
    location: string;
    category: string;
    sub_category: string;
    scanned_by: string;
    scanned_at: string;
    id?: string;
  } = {
    store_number: store,
    item_number: String(input.item_number).trim(),
    serial_number: String(input.serial_number ?? "").trim(),
    location: String(input.location ?? "").trim(),
    category,
    sub_category,
    scanned_by: String(input.scanned_by ?? "").trim(),
    scanned_at: input.scanned_at ?? new Date().toISOString(),
  };

  if (input.id) {
    payload.id = input.id;
  }

  return payload;
}

async function fetchScansViaApi(store: string): Promise<ApplianceScan[]> {
  const res = await fetch(
    `/api/appliances/scans?store_number=${encodeURIComponent(store)}`,
    {
      method: "GET",
      headers: { "x-store-number": store },
      cache: "no-store",
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    scans?: unknown[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `Failed to load scans (${res.status})`);
  }
  return (json.scans ?? []).map((row) =>
    mapRow(row as Record<string, unknown>)
  );
}

export async function fetchApplianceScans(): Promise<ApplianceScan[]> {
  const store = getStoreNumber();
  const local = forStore(store);

  if (isBrowserOnline()) {
    try {
      const remote = await fetchScansViaApi(store);
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
    } catch (err) {
      console.error("[appliance_scans] API fetch failed, trying client", err);
    }

    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from(TABLE)
          .select("*")
          .eq("store_number", store)
          .order("scanned_at", { ascending: false });
        if (error) {
          console.error("[appliance_scans] client fetch error", error);
          throw error;
        }
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
      } catch (err) {
        console.error("[appliance_scans] client fetch failed", err);
      }
    }
  }

  return local;
}

/**
 * Persist a floor scan. Online: direct POST /api/appliances/scans (throws on failure).
 * Offline only: local queue — never pretends a failed online write succeeded.
 */
export async function saveApplianceScan(
  input: ApplianceScanInsert
): Promise<{ record: ApplianceScan; offline: boolean }> {
  const store = input.store_number ?? getStoreNumber();
  const payload = buildApplianceScanPayload(input, store);

  console.log("[appliance_scans] save payload", payload);

  // Truly offline — queue for later. Do not use this path to hide DB errors.
  if (!isBrowserOnline()) {
    const offlineRecord: ApplianceScan = {
      id: payload.id ?? uid(),
      store_number: payload.store_number,
      item_number: payload.item_number,
      serial_number: payload.serial_number,
      location: payload.location,
      category: normalizeApplianceCategory(payload.category),
      sub_category: payload.sub_category || undefined,
      scanned_by: payload.scanned_by,
      scanned_at: payload.scanned_at,
      offline: true,
    };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_appliance_scan", { ...payload, id: offlineRecord.id }, store);
    return { record: offlineRecord, offline: true };
  }

  try {
    const res = await fetch("/api/appliances/scans", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-store-number": store,
      },
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => ({}))) as {
      scan?: Record<string, unknown>;
      error?: string;
    };

    if (!res.ok) {
      const message = json.error || `HTTP ${res.status}`;
      console.error("[appliance_scans] API insert failed", message, json);
      throw new Error(message);
    }

    if (!json.scan) {
      console.error("[appliance_scans] API returned no scan row", json);
      throw new Error("API returned no scan row");
    }

    const saved = mapRow(json.scan);
    upsertLocal({ ...saved, offline: false });
    console.log("[appliance_scans] saved", saved.id, saved.item_number);
    return { record: saved, offline: false };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown save error";
    console.error("[appliance_scans] save failed — not falling back to silent offline", err);
    throw new Error(message);
  }
}

export async function deleteApplianceScan(id: string): Promise<void> {
  const store = getStoreNumber();
  writeAllLocal(readAllLocal().filter((r) => r.id !== id));

  if (!isBrowserOnline()) {
    enqueueSyncAction("delete_appliance_scan", { id }, store);
    return;
  }

  const res = await fetch(
    `/api/appliances/scans?id=${encodeURIComponent(id)}&store_number=${encodeURIComponent(store)}`,
    {
      method: "DELETE",
      headers: { "x-store-number": store },
    }
  );
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    const message = json.error || `HTTP ${res.status}`;
    console.error("[appliance_scans] delete failed", message);
    throw new Error(message);
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
