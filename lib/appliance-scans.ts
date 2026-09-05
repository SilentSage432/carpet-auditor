/**
 * Appliance floor scans — owns public.appliance_scans.
 * Flooring cycle audits stay in lib/storage.ts (carpet_audits).
 *
 * Online saves go through POST /api/appliances/scans (service role) and throw
 * on failure — never silently report success via the offline queue.
 */

import { createDebouncedPersist } from "./debounced-persist";
import { storeOpsAuthHeadersAsync } from "./store-ops/auth";
import { getStoreNumber, sameStoreNumber, storeNumberQueryValues } from "./store";
import { getSupabase } from "./supabase";
import { enqueueSyncAction, isBrowserOnline } from "./sync-queue";
import { uid } from "./uid";
import {
  isValidApplianceSubCategory,
  normalizeApplianceCategory,
  normalizeApplianceConditionTag,
  normalizeApplianceLocationType,
  resolveApplianceCategoryPair,
  type ApplianceCategory,
  type ApplianceConditionTag,
  type ApplianceLocationType,
  type ApplianceScan,
  type ApplianceScanInsert,
} from "./types";

const STORAGE_KEY = "appliance_scans_offline";
const DRAFT_KEY = "carpet_hub_appliance_scan_draft";
const TABLE = "appliance_scans";

/** Mid-scan appliance form — survives refresh / tab switches. */
export type ApplianceScanDraft = {
  store_number: string;
  itemNumber: string;
  serialNumber: string;
  location: string;
  locationType: ApplianceLocationType;
  description: string;
};

export function loadApplianceScanDraft(
  store = getStoreNumber()
): ApplianceScanDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApplianceScanDraft;
    if (parsed.store_number !== store) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveApplianceScanDraft(draft: ApplianceScanDraft): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

const applianceDraftPersist = createDebouncedPersist(saveApplianceScanDraft, 300);

export function scheduleApplianceScanDraftSave(draft: ApplianceScanDraft): void {
  applianceDraftPersist.schedule(draft);
}

export function flushApplianceScanDraftSave(): void {
  applianceDraftPersist.flush();
}

export function clearApplianceScanDraft(): void {
  applianceDraftPersist.cancel();
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_KEY);
}

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
  return readAllLocal().filter((r) => sameStoreNumber(r.store_number, store));
}

export function getLocalApplianceScans(store = getStoreNumber()): ApplianceScan[] {
  return forStore(store);
}

export function countLocalApplianceScans(store = getStoreNumber()): number {
  return forStore(store).length;
}

/** Drop locally cached appliance scans for a store (keeps other stores). */
export function clearLocalApplianceScans(store = getStoreNumber()): void {
  writeAllLocal(readAllLocal().filter((r) => r.store_number !== store));
}

export function mapApplianceScanRow(row: Record<string, unknown>): ApplianceScan {
  const pair = resolveApplianceCategoryPair(row.category, row.sub_category);
  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    item_number: String(row.item_number ?? row.sku ?? "").trim(),
    serial_number: String(row.serial_number ?? "").trim(),
    location: String(row.location ?? row.sims_location ?? "").trim(),
    location_type: normalizeApplianceLocationType(row.location_type),
    condition_tag: normalizeApplianceConditionTag(row.condition_tag),
    category: pair.category,
    sub_category: pair.sub_category || undefined,
    scanned_by: String(row.scanned_by ?? row.audited_by ?? "").trim(),
    scanned_at: String(
      row.scanned_at ?? row.created_at ?? new Date().toISOString()
    ),
    offline: Boolean(row.offline),
    is_showroom_baseline: Boolean(row.is_showroom_baseline),
    location_id: row.location_id ? String(row.location_id) : null,
    aisle: row.aisle != null ? String(row.aisle) : null,
    bay_number:
      row.bay_number == null || row.bay_number === ""
        ? null
        : Math.floor(Number(row.bay_number)),
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
  location_type: string;
  condition_tag: string;
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
    location_type: string;
    condition_tag: string;
    category: string;
    sub_category: string;
    scanned_by: string;
    scanned_at: string;
    location_id?: string;
    aisle?: string;
    bay_number?: number;
    id?: string;
  } = {
    store_number: store,
    item_number: String(input.item_number).trim(),
    serial_number: String(input.serial_number ?? "").trim(),
    location: String(input.location ?? "").trim(),
    location_type: normalizeApplianceLocationType(input.location_type),
    condition_tag: normalizeApplianceConditionTag(input.condition_tag),
    category,
    sub_category,
    scanned_by: String(input.scanned_by ?? "").trim(),
    scanned_at: input.scanned_at ?? new Date().toISOString(),
  };

  if (input.id) {
    payload.id = input.id;
  }
  const locationId = String(input.location_id ?? "").trim();
  if (locationId) payload.location_id = locationId;
  const aisle = String(input.aisle ?? "").trim();
  if (aisle) payload.aisle = aisle;
  const bayNumber = Number(input.bay_number);
  if (Number.isFinite(bayNumber)) payload.bay_number = Math.floor(bayNumber);

  return payload;
}

async function fetchScansViaApi(store: string): Promise<ApplianceScan[]> {
  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch(
    `/api/appliances/scans?store_number=${encodeURIComponent(store)}`,
    {
      method: "GET",
      headers: { ...authHeaders, "x-store-number": store },
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
        const keys = storeNumberQueryValues(store);
        const { data, error } = await supabase
          .from(TABLE)
          .select("*")
          .in("store_number", keys.length ? keys : [store])
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
      location_type: normalizeApplianceLocationType(payload.location_type),
      condition_tag: normalizeApplianceConditionTag(payload.condition_tag),
      category: normalizeApplianceCategory(payload.category),
      sub_category: payload.sub_category || undefined,
      scanned_by: payload.scanned_by,
      scanned_at: payload.scanned_at,
      offline: true,
      is_showroom_baseline: false,
    };
    upsertLocal(offlineRecord);
    enqueueSyncAction("upsert_appliance_scan", { ...payload, id: offlineRecord.id }, store);
    return { record: offlineRecord, offline: true };
  }

  try {
    const authHeaders = await storeOpsAuthHeadersAsync();
    const res = await fetch("/api/appliances/scans", {
      method: "POST",
      headers: {
        ...authHeaders,
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

  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch(
    `/api/appliances/scans?id=${encodeURIComponent(id)}&store_number=${encodeURIComponent(store)}`,
    {
      method: "DELETE",
      headers: { ...authHeaders, "x-store-number": store },
    }
  );
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    const message = json.error || `HTTP ${res.status}`;
    console.error("[appliance_scans] delete failed", message);
    throw new Error(message);
  }
}

/** Clear appliance scans for the active store (audit session reset). */
export async function clearAllApplianceScans(
  options: {
    store?: string;
    /** When true, locked showroom baseline rows are kept. */
    preserveShowroomBaseline?: boolean;
  } = {}
): Promise<{ deleted: number; preserved: number }> {
  const store = options.store ?? getStoreNumber();
  const preserve = options.preserveShowroomBaseline ?? false;
  const local = forStore(store);
  const toDelete = preserve
    ? local.filter((r) => !r.is_showroom_baseline)
    : local;
  const preserved = preserve
    ? local.filter((r) => Boolean(r.is_showroom_baseline))
    : [];

  writeAllLocal([
    ...readAllLocal().filter((r) => r.store_number !== store),
    ...preserved,
  ]);
  clearApplianceScanDraft();

  if (!isBrowserOnline()) {
    enqueueSyncAction(
      "clear_appliance_scans",
      { store_number: store, preserve_showroom_baseline: preserve },
      store
    );
    return { deleted: toDelete.length, preserved: preserved.length };
  }

  const qs = new URLSearchParams({
    scope: "store",
    store_number: store,
  });
  if (preserve) qs.set("preserve_baseline", "true");

  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch(`/api/appliances/scans?${qs.toString()}`, {
    method: "DELETE",
    headers: { ...authHeaders, "x-store-number": store },
  });
  const json = (await res.json().catch(() => ({}))) as {
    deleted?: number;
    preserved?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return {
    deleted: json.deleted ?? toDelete.length,
    preserved: json.preserved ?? preserved.length,
  };
}

/** Mark current showroom display scans as the locked MST baseline. */
export async function lockApplianceShowroomBaseline(
  store = getStoreNumber()
): Promise<{ locked: number }> {
  const local = forStore(store);
  const showroomIds = new Set(
    local
      .filter((s) => s.location_type === "showroom")
      .map((s) => s.id)
  );
  const nextLocal = local.map((s) =>
    showroomIds.has(s.id)
      ? { ...s, is_showroom_baseline: true }
      : { ...s, is_showroom_baseline: false }
  );
  writeAllLocal([
    ...readAllLocal().filter((r) => r.store_number !== store),
    ...nextLocal,
  ]);

  if (!isBrowserOnline()) {
    enqueueSyncAction(
      "lock_appliance_showroom_baseline",
      { store_number: store },
      store
    );
    return { locked: showroomIds.size };
  }

  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch("/api/appliances/scans", {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "x-store-number": store,
    },
    body: JSON.stringify({
      action: "lock_showroom_baseline",
      store_number: store,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    locked?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return { locked: json.locked ?? showroomIds.size };
}

export function countLockedShowroomBaseline(
  scans: ApplianceScan[]
): number {
  return scans.filter((s) => Boolean(s.is_showroom_baseline)).length;
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

/** One SKU roll-up for high-volume scan log UI + summary export. */
export type AggregatedApplianceScan = {
  item_number: string;
  category: ApplianceCategory;
  sub_category?: string;
  description: string;
  quantity: number;
  locations: string[];
  scans: ApplianceScan[];
  hasOffline: boolean;
};

export type ApplianceScanCsvOptions = {
  /** item_number → catalog description for the summary sheet. */
  descriptions?: Record<string, string>;
};

export type ApplianceUnitEdit = {
  serial: string;
  condition_tag: ApplianceConditionTag;
};

export type ApplianceGroupEditInput = {
  item_number: string;
  category: ApplianceCategory | string;
  sub_category?: string;
  targetQuantity: number;
  location: string;
  location_type: ApplianceLocationType;
  /** Per-unit serial + condition (pad/truncate to quantity). */
  units: ApplianceUnitEdit[];
  scanned_by: string;
  existingScans: ApplianceScan[];
};

/** Category / suite chips for the sticky scan-log filter bar. */
export const APPLIANCE_SCAN_LOG_FILTERS = [
  { id: "all", label: "All" },
  { id: "ranges-cooktops", label: "Ranges/Cooktops" },
  { id: "wall-ovens", label: "Wall Ovens" },
  { id: "refrigeration", label: "Refrigeration" },
  { id: "laundry", label: "Laundry" },
  { id: "dishwashers", label: "Dishwashers" },
  { id: "microwaves", label: "Microwaves / Venting" },
] as const;

export type ApplianceScanLogFilterId =
  (typeof APPLIANCE_SCAN_LOG_FILTERS)[number]["id"];

export function matchesApplianceScanLogFilter(
  scan: Pick<ApplianceScan, "category" | "sub_category">,
  filterId: ApplianceScanLogFilterId
): boolean {
  const sub = String(scan.sub_category ?? "").trim();
  switch (filterId) {
    case "all":
      return true;
    case "ranges-cooktops":
      return (
        scan.category === "Cooking / Ranges" &&
        (sub === "Range / Stove" || sub === "Cooktop" || !sub)
      );
    case "wall-ovens":
      return sub === "Wall Oven";
    case "refrigeration":
      return scan.category === "Refrigeration";
    case "laundry":
      return scan.category === "Laundry";
    case "dishwashers":
      return scan.category === "Dishwashers";
    case "microwaves":
      return scan.category === "Microwaves / Venting";
    default:
      return true;
  }
}

export function aggregateApplianceScans(
  scans: ApplianceScan[],
  descriptions: Record<string, string> = {}
): AggregatedApplianceScan[] {
  const byItem = new Map<string, ApplianceScan[]>();
  for (const scan of scans) {
    const key = scan.item_number.trim() || "(unknown)";
    const list = byItem.get(key);
    if (list) list.push(scan);
    else byItem.set(key, [scan]);
  }

  const groups: AggregatedApplianceScan[] = [];
  for (const [item_number, rows] of byItem) {
    const sorted = [...rows].sort((a, b) =>
      b.scanned_at.localeCompare(a.scanned_at)
    );
    const head = sorted[0];
    const locations = [
      ...new Set(
        sorted.map((s) => s.location.trim()).filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));

    groups.push({
      item_number,
      category: head.category,
      sub_category: head.sub_category,
      description: descriptions[item_number] ?? "",
      quantity: sorted.length,
      locations,
      scans: sorted,
      hasOffline: sorted.some((s) => Boolean(s.offline)),
    });
  }

  return groups.sort((a, b) => {
    const qty = b.quantity - a.quantity;
    if (qty !== 0) return qty;
    return a.item_number.localeCompare(b.item_number);
  });
}

/** Accordion page size for SKU cards inside an expanded category. */
export const APPLIANCE_SCAN_LOG_PAGE_SIZE = 10;

export type ApplianceScanSubCategoryGroup = {
  sub_category: string;
  unitCount: number;
  items: AggregatedApplianceScan[];
};

/** Top-level category accordion roll-up for the scan log. */
export type ApplianceScanCategoryAccordion = {
  category: string;
  unitCount: number;
  skuCount: number;
  subGroups: ApplianceScanSubCategoryGroup[];
  /** Flat SKU list used for pagination inside the expanded accordion. */
  items: AggregatedApplianceScan[];
};

const CATEGORY_ACCORDION_EMOJI: Record<string, string> = {
  Laundry: "🧺",
  Refrigeration: "❄️",
  "Cooking / Ranges": "🍳",
  Dishwashers: "🍽️",
  "Microwaves / Venting": "📡",
};

export function applianceCategoryEmoji(category: string): string {
  return CATEGORY_ACCORDION_EMOJI[category] ?? "🔌";
}

/**
 * Nest aggregated SKU cards under main category → sub_category for the
 * collapsible scan-log summary view.
 */
export function groupApplianceScansByCategory(
  items: AggregatedApplianceScan[]
): ApplianceScanCategoryAccordion[] {
  const byCategory = new Map<string, AggregatedApplianceScan[]>();
  for (const item of items) {
    const key = String(item.category || "Uncategorized");
    const list = byCategory.get(key);
    if (list) list.push(item);
    else byCategory.set(key, [item]);
  }

  const accordions: ApplianceScanCategoryAccordion[] = [];
  for (const [category, categoryItems] of byCategory) {
    const bySub = new Map<string, AggregatedApplianceScan[]>();
    for (const item of categoryItems) {
      const sub = String(item.sub_category ?? "").trim() || "Unspecified";
      const list = bySub.get(sub);
      if (list) list.push(item);
      else bySub.set(sub, [item]);
    }

    const subGroups: ApplianceScanSubCategoryGroup[] = [...bySub.entries()]
      .map(([sub_category, subItems]) => ({
        sub_category,
        unitCount: subItems.reduce((sum, i) => sum + i.quantity, 0),
        items: subItems.sort((a, b) => b.quantity - a.quantity),
      }))
      .sort((a, b) => b.unitCount - a.unitCount);

    const flatItems = subGroups.flatMap((g) => g.items);
    accordions.push({
      category,
      unitCount: flatItems.reduce((sum, i) => sum + i.quantity, 0),
      skuCount: flatItems.length,
      subGroups,
      items: flatItems,
    });
  }

  return accordions.sort((a, b) => {
    const byUnits = b.unitCount - a.unitCount;
    if (byUnits !== 0) return byUnits;
    return a.category.localeCompare(b.category);
  });
}

export async function updateApplianceScan(
  id: string,
  patch: Partial<
    Pick<
      ApplianceScan,
      | "serial_number"
      | "location"
      | "location_type"
      | "condition_tag"
      | "scanned_by"
      | "category"
      | "sub_category"
    >
  >
): Promise<ApplianceScan> {
  const store = getStoreNumber();
  const existing = readAllLocal().find((r) => r.id === id);
  if (!existing) {
    throw new Error("Scan not found");
  }

  const next: ApplianceScan = {
    ...existing,
    serial_number:
      patch.serial_number !== undefined
        ? String(patch.serial_number).trim()
        : existing.serial_number,
    location:
      patch.location !== undefined
        ? String(patch.location).trim()
        : existing.location,
    location_type:
      patch.location_type !== undefined
        ? normalizeApplianceLocationType(patch.location_type)
        : existing.location_type,
    condition_tag:
      patch.condition_tag !== undefined
        ? normalizeApplianceConditionTag(patch.condition_tag)
        : existing.condition_tag,
    scanned_by:
      patch.scanned_by !== undefined
        ? String(patch.scanned_by).trim()
        : existing.scanned_by,
    category: patch.category
      ? normalizeApplianceCategory(patch.category)
      : existing.category,
    sub_category:
      patch.sub_category !== undefined
        ? String(patch.sub_category).trim() || undefined
        : existing.sub_category,
  };

  if (!isBrowserOnline()) {
    upsertLocal({ ...next, offline: true });
    enqueueSyncAction(
      "upsert_appliance_scan",
      {
        id: next.id,
        store_number: next.store_number,
        item_number: next.item_number,
        serial_number: next.serial_number,
        location: next.location,
        location_type: next.location_type,
        condition_tag: next.condition_tag,
        category: next.category,
        sub_category: next.sub_category ?? "",
        scanned_by: next.scanned_by,
        scanned_at: next.scanned_at,
      },
      store
    );
    return { ...next, offline: true };
  }

  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch("/api/appliances/scans", {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "x-store-number": store,
    },
    body: JSON.stringify({
      id,
      store_number: store,
      serial_number: next.serial_number,
      location: next.location,
      location_type: next.location_type,
      condition_tag: next.condition_tag,
      scanned_by: next.scanned_by,
      category: next.category,
      sub_category: next.sub_category ?? "",
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    scan?: Record<string, unknown>;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  if (!json.scan) {
    throw new Error("API returned no scan row");
  }
  const saved = mapRow(json.scan);
  upsertLocal({ ...saved, offline: false });
  return saved;
}

/**
 * Apply quantity / serial / location edits for one SKU group.
 * Increments create new scan rows; decrements delete newest excess rows.
 */
export async function applyApplianceGroupEdit(
  input: ApplianceGroupEditInput
): Promise<ApplianceScan[]> {
  const qty = Math.max(0, Math.floor(input.targetQuantity));
  const location = input.location.trim();
  const location_type = normalizeApplianceLocationType(input.location_type);
  const units = input.units.map((u) => ({
    serial: String(u.serial ?? "").trim(),
    condition_tag: normalizeApplianceConditionTag(u.condition_tag),
  }));
  while (units.length < qty) {
    units.push({ serial: "", condition_tag: "NEW_BOXED" });
  }
  units.length = qty;

  const existing = [...input.existingScans].sort((a, b) =>
    a.scanned_at.localeCompare(b.scanned_at)
  );

  const keep = existing.slice(0, qty);
  const drop = existing.slice(qty);

  for (const scan of drop) {
    await deleteApplianceScan(scan.id);
  }

  const keptUpdated: ApplianceScan[] = [];
  for (let i = 0; i < keep.length; i++) {
    const scan = keep[i];
    const unit = units[i] ?? { serial: "", condition_tag: "NEW_BOXED" as const };
    if (
      scan.serial_number === unit.serial &&
      scan.location === location &&
      scan.location_type === location_type &&
      scan.condition_tag === unit.condition_tag
    ) {
      keptUpdated.push(scan);
      continue;
    }
    const updated = await updateApplianceScan(scan.id, {
      serial_number: unit.serial,
      location,
      location_type,
      condition_tag: unit.condition_tag,
    });
    keptUpdated.push(updated);
  }

  const created: ApplianceScan[] = [];
  const category = normalizeApplianceCategory(input.category);
  for (let i = keep.length; i < qty; i++) {
    const unit = units[i] ?? { serial: "", condition_tag: "NEW_BOXED" as const };
    const { record } = await saveApplianceScan({
      item_number: input.item_number,
      serial_number: unit.serial,
      location,
      location_type,
      condition_tag: unit.condition_tag,
      category,
      sub_category: input.sub_category,
      scanned_by: input.scanned_by,
    });
    created.push(record);
  }

  return [...keptUpdated, ...created].sort((a, b) =>
    b.scanned_at.localeCompare(a.scanned_at)
  );
}

function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Aggregated inventory CSV: SUMMARY sheet columns + RAW DETAIL audit trail.
 * Spreadsheet apps open this as one workbook sheet with two labeled blocks.
 */
export function applianceScansToCsv(
  scans: ApplianceScan[],
  options: ApplianceScanCsvOptions = {}
): string {
  const descriptions = options.descriptions ?? {};
  const groups = aggregateApplianceScans(scans, descriptions);

  const summaryHeader = [
    "Item Number",
    "Description",
    "Category",
    "Total Count Scanned",
    "Locations Found",
  ];
  const summaryRows = groups.map((g) =>
    [
      g.item_number,
      g.description,
      g.sub_category ? `${g.category} · ${g.sub_category}` : g.category,
      g.quantity,
      g.locations.join("; "),
    ]
      .map(csvEscape)
      .join(",")
  );

  const detailHeader = [
    "Category",
    "Sub-Category",
    "Item #",
    "Serial #",
    "Location Type",
    "Condition",
    "Location",
    "Scanned By",
    "Scanned At",
    "Store #",
  ];
  const detailRows = [...scans]
    .sort((a, b) => {
      const item = a.item_number.localeCompare(b.item_number);
      if (item !== 0) return item;
      return a.scanned_at.localeCompare(b.scanned_at);
    })
    .map((s) =>
      [
        s.category,
        s.sub_category ?? "",
        s.item_number,
        s.serial_number,
        s.location_type,
        s.condition_tag,
        s.location,
        s.scanned_by,
        s.scanned_at,
        s.store_number,
      ]
        .map(csvEscape)
        .join(",")
    );

  return [
    "SUMMARY",
    summaryHeader.join(","),
    ...summaryRows,
    "",
    "RAW DETAIL",
    detailHeader.join(","),
    ...detailRows,
  ].join("\n");
}
