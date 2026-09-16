/**
 * Appliance master catalog — owns public.appliance_catalog.
 * Flooring catalog stays in lib/catalog.ts (carpet_catalog).
 *
 * APP-UPC-001A: canonical identity is (store_number, item_number).
 * Physical scan identifiers (UPC/ESL/aliases) are NOT stored on catalog items
 * or in appliance_catalog_offline. Local resolve matches item_number only.
 * Physical barcode matching is server-side via /api/appliances/catalog/resolve-scan
 * and teach via /api/appliances/catalog/teach-scan (opaque fingerprints).
 */

import {
  canonicalApplianceItemNumber,
  canonicalApplianceScanIdentifier,
  isPhysicalApplianceScanIdentifier,
} from "./appliances/scan-identity";
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

/** Public catalog row shape (no physical scan identifiers). */
export type ApplianceCatalogPublicItem = ApplianceCatalogItem;

/** Raised when a scannable identifier is already linked to a different catalog item. */
export class ApplianceCatalogConflictError extends Error {
  readonly conflict: ApplianceCatalogItem;

  constructor(message: string, conflict: ApplianceCatalogItem) {
    super(message);
    this.name = "ApplianceCatalogConflictError";
    this.conflict = conflict;
  }
}

/**
 * @deprecated Use canonicalApplianceScanIdentifier from @/lib/appliances/scan-identity.
 * Kept as a thin alias so older imports do not break immediately.
 */
export function normalizeApplianceIdentifier(raw: unknown): string {
  return canonicalApplianceScanIdentifier(raw);
}

/**
 * Lookup keys for local item_number resolution (canonical form only).
 * Physical barcode dual-key / digit fallback was removed in APP-UPC-001A.
 */
export function applianceIdentifierLookupKeys(raw: unknown): string[] {
  const normalized = canonicalApplianceScanIdentifier(raw);
  return normalized ? [normalized] : [];
}

function uniqueCatalogItems(
  hits: ApplianceCatalogItem[]
): ApplianceCatalogItem[] {
  const byItem = new Map<string, ApplianceCatalogItem>();
  for (const hit of hits) {
    const key = `${hit.store_number}::${hit.item_number}`;
    if (!byItem.has(key)) byItem.set(key, hit);
  }
  return [...byItem.values()];
}

export type ApplianceCatalogResolveResult =
  | { status: "matched"; item: ApplianceCatalogItem }
  | { status: "ambiguous" }
  | { status: "none" };

/**
 * Local catalog resolution (APP-UPC-001A).
 *
 * Exact canonical match on item_number only. Physical scan identifiers are
 * resolved server-side (opaque fingerprints) — never against local UPC/aliases.
 */
export function resolveApplianceCatalogItem(
  items: ApplianceCatalogItem[],
  raw: string
): ApplianceCatalogResolveResult {
  const exact = canonicalApplianceItemNumber(raw);
  if (!exact) return { status: "none" };

  const itemNumberHits = uniqueCatalogItems(
    items.filter(
      (item) => canonicalApplianceItemNumber(item.item_number) === exact
    )
  );
  if (itemNumberHits.length === 1) {
    return { status: "matched", item: itemNumberHits[0]! };
  }
  if (itemNumberHits.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}

/**
 * Physical taught identifiers are server-only fingerprints — clients never hold
 * raw taught ids. Always empty (API retained for call-site compatibility).
 */
export function listApplianceTaughtIdentifiers(
  _item?: unknown
): string[] {
  void _item;
  return [];
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
  const pair = resolveApplianceCategoryPair(row.category, row.sub_category);

  // Never map upc / identifiers into client objects (APP-UPC-001A).
  return {
    id: String(row.id),
    store_number: String(row.store_number ?? getStoreNumber()),
    item_number: canonicalApplianceItemNumber(row.item_number ?? row.sku),
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
 * Local conflict helper retained for call-site compatibility.
 * Only detects item_number collisions — never physical barcode / UPC plaintext.
 */
export function findApplianceUpcConflict(
  items: ApplianceCatalogItem[],
  upcRaw: string | null | undefined,
  options?: { excludeId?: string; excludeItemNumber?: string }
): ApplianceCatalogItem | undefined {
  return findApplianceIdentifierConflict(items, upcRaw, options);
}

/**
 * Detects when `identifierRaw` collides with another item's public item_number.
 * Physical scan identity conflicts are server-side only (fingerprint teach).
 */
export function findApplianceIdentifierConflict(
  items: ApplianceCatalogItem[],
  identifierRaw: string | null | undefined,
  options?: { excludeId?: string; excludeItemNumber?: string }
): ApplianceCatalogItem | undefined {
  const exact = canonicalApplianceItemNumber(identifierRaw);
  if (!exact) return undefined;
  const excludeItem = options?.excludeItemNumber
    ? canonicalApplianceItemNumber(options.excludeItemNumber)
    : "";

  return items.find((item) => {
    if (options?.excludeId && item.id === options.excludeId) return false;
    const itemKey = canonicalApplianceItemNumber(item.item_number);
    if (excludeItem && itemKey === excludeItem) return false;
    return itemKey === exact;
  });
}

/** Search Item #, description, category, and sub-category for manage UI. */
export function filterApplianceCatalog(
  catalog: ApplianceCatalogItem[],
  query: string
): ApplianceCatalogItem[] {
  const sorted = [...catalog].sort((a, b) =>
    a.item_number.localeCompare(b.item_number)
  );
  const q = query.trim().toLowerCase();
  if (!q) return sorted;

  return sorted.filter(
    (item) =>
      item.item_number.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.sub_category ?? "").toLowerCase().includes(q)
  );
}

function upsertLocal(record: ApplianceCatalogItem): ApplianceCatalogItem[] {
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
      .select(
        "id, store_number, item_number, description, category, sub_category, created_at, updated_at"
      )
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

/**
 * The server answered and rejected an appliance identity write (APP-CAT-001A-FIX-001).
 *
 * This is the contract that separates "received a server response" from "no server
 * response". An application rejection must stay a visible failure and must never be
 * queued as offline intent; only a network/no-response failure may queue catalog
 * metadata. Physical scan teaching never queues raw identifiers (APP-UPC-001A).
 * HTTP 409 keeps its richer ApplianceCatalogConflictError instead.
 */
export class ApplianceServerRejectionError extends Error {
  httpStatus: number;

  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "ApplianceServerRejectionError";
    this.httpStatus = httpStatus;
  }
}

/** Server rejected the scan-identity teach write. */
export class ApplianceIdentifierHttpError extends ApplianceServerRejectionError {
  constructor(message: string, httpStatus: number) {
    super(message, httpStatus);
    this.name = "ApplianceIdentifierHttpError";
  }
}

/**
 * Server rejected ensuring the canonical parent catalog item
 * (APP-CAT-001A-FIX-001A). The teach-scan step must not be attempted.
 */
export class ApplianceCatalogParentHttpError extends ApplianceServerRejectionError {
  constructor(message: string, httpStatus: number) {
    super(message, httpStatus);
    this.name = "ApplianceCatalogParentHttpError";
  }
}

export function isApplianceIdentifierHttpError(
  err: unknown
): err is ApplianceIdentifierHttpError {
  return err instanceof ApplianceIdentifierHttpError;
}

/**
 * Positive evidence that a catalog item is persisted server-side for its store.
 *
 * `offline` is truthful about what this device believed at write time, but it is not
 * proof of server presence for `(store_number, item_number)` — the fail-closed
 * store_number re-stamp (APP-FIELD-001) moved local rows into a new canonical store
 * scope without re-persisting them. Treat this as a hint only; the authoritative
 * check is the idempotent ensure-parent call.
 */
export function isApplianceCatalogItemLocalOnly(
  item: Pick<ApplianceCatalogItem, "offline">
): boolean {
  return item.offline === true;
}

/**
 * Ensure the canonical parent catalog item exists server-side (APP-CAT-001A-FIX-001A).
 *
 * Idempotent: an existing server parent is left untouched. Exactly one explicitly
 * chosen item is ensured — never bulk device-catalog promotion.
 * Does not write upc or physical scan identifiers (APP-UPC-001A).
 */
async function ensureApplianceCatalogParentOnline(
  item: ApplianceCatalogItem
): Promise<{ created: boolean }> {
  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch("/api/appliances/catalog/ensure", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      "x-store-number": item.store_number,
    },
    body: JSON.stringify({
      id: item.id,
      store_number: item.store_number,
      item_number: item.item_number,
      description: item.description,
      category: item.category,
      sub_category: item.sub_category ?? "",
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    created?: boolean;
    error?: string;
    conflict?: Record<string, unknown>;
  };

  if (res.status === 409) {
    const conflictRow = json.conflict ? mapRow(json.conflict) : null;
    throw new ApplianceCatalogConflictError(
      json.error ||
        `Item ${item.item_number} conflicts with an existing catalog item.`,
      conflictRow ?? item
    );
  }
  if (!res.ok) {
    throw new ApplianceCatalogParentHttpError(
      json.error ||
        `Could not confirm Item ${item.item_number} in the store catalog (${res.status})`,
      res.status
    );
  }

  return { created: Boolean(json.created) };
}

async function teachScanOnline(input: {
  store_number: string;
  item_number: string;
  scan_identifier: string;
}): Promise<ApplianceCatalogItem | null> {
  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch("/api/appliances/catalog/teach-scan", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      "x-store-number": input.store_number,
    },
    body: JSON.stringify({
      item_number: input.item_number,
      scan_identifier: input.scan_identifier,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    conflict?: Record<string, unknown>;
    item?: Record<string, unknown>;
  };
  if (res.status === 409) {
    const conflictRow = json.conflict ? mapRow(json.conflict) : null;
    throw new ApplianceCatalogConflictError(
      json.error ||
        `Scan identity is already linked to another item.`,
      conflictRow ??
        ({
          id: "unknown",
          store_number: input.store_number,
          item_number: "?",
          description: "",
          category: "Laundry",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } satisfies ApplianceCatalogItem)
    );
  }
  if (!res.ok) {
    throw new ApplianceIdentifierHttpError(
      json.error || `Scan teach failed (${res.status})`,
      res.status
    );
  }
  return json.item ? mapRow(json.item) : null;
}

/**
 * Teach a physical scan identifier onto an existing canonical item (link path).
 * Online only: POST /api/appliances/catalog/teach-scan. Raw identifier is sent
 * in the request only — never stored in the local catalog cache.
 */
export async function linkApplianceCatalogIdentifier(input: {
  item: ApplianceCatalogItem;
  identifier: string;
}): Promise<{ record: ApplianceCatalogItem; offline: boolean }> {
  const store = input.item.store_number || getStoreNumber();
  const identifier = canonicalApplianceScanIdentifier(input.identifier);
  if (!identifier) {
    throw new Error("identifier is required");
  }

  if (!isBrowserOnline()) {
    throw new Error(
      "Teaching scan identity requires a network connection"
    );
  }

  const updated: ApplianceCatalogItem = {
    ...input.item,
    store_number: store,
  };

  // Parent first: teach-scan against an absent parent is a 404.
  try {
    await ensureApplianceCatalogParentOnline(updated);
  } catch (err) {
    if (err instanceof ApplianceCatalogConflictError) throw err;
    if (err instanceof ApplianceServerRejectionError) throw err;
    throw new Error(
      "Teaching scan identity requires a network connection"
    );
  }

  try {
    const taught = await teachScanOnline({
      store_number: store,
      item_number: input.item.item_number,
      scan_identifier: identifier,
    });
    const record = taught ?? { ...updated, offline: false };
    const existing = readAllLocal().filter(
      (r) =>
        !(
          r.store_number === record.store_number &&
          (r.id === record.id || r.item_number === record.item_number)
        )
    );
    writeAllLocal(
      [...existing, { ...record, offline: false }].sort((a, b) =>
        a.item_number.localeCompare(b.item_number)
      )
    );
    return { record: { ...record, offline: false }, offline: false };
  } catch (err) {
    if (err instanceof ApplianceCatalogConflictError) throw err;
    if (err instanceof ApplianceServerRejectionError) throw err;
    throw new Error(
      "Teaching scan identity requires a network connection"
    );
  }
}

export async function saveApplianceCatalogItem(
  input: ApplianceCatalogItemInsert & {
    teach_scan_identifier?: string | null;
    /** @deprecated Use teach_scan_identifier — durable plaintext teach is removed. */
    teach_identifier?: string | null;
  }
): Promise<{ record: ApplianceCatalogItem; offline: boolean }> {
  const now = new Date().toISOString();
  const store = input.store_number ?? getStoreNumber();
  const teachScanRaw =
    input.teach_scan_identifier ?? input.teach_identifier ?? null;
  const teachScanIdentifier =
    teachScanRaw == null || teachScanRaw === ""
      ? null
      : canonicalApplianceScanIdentifier(teachScanRaw) || null;
  const pair = resolveApplianceCategoryPair(
    input.category,
    input.sub_category
  );

  const record: ApplianceCatalogItem = {
    id: input.id ?? uid(),
    store_number: store,
    item_number: canonicalApplianceItemNumber(input.item_number),
    description: String(input.description ?? "").trim(),
    category: pair.category,
    sub_category: pair.sub_category || undefined,
    created_at: now,
    updated_at: now,
    offline: false,
  };

  /**
   * Online: actor-bound catalog API only.
   * Application responses MUST remain failures — never fall through to
   * direct client Supabase upsert. Network unavailable → offline queue for
   * public catalog metadata only. Physical teach is online-only.
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
          json.error || `Item conflicts with an existing catalog item.`,
          conflictRow ??
            ({
              id: "unknown",
              store_number: store,
              item_number: "?",
              description: "",
              category: "Laundry",
              created_at: now,
              updated_at: now,
            } satisfies ApplianceCatalogItem)
        );
      }

      if (!res.ok) {
        const rawMsg = json.error || `Catalog save failed (${res.status})`;
        if (/store_number/i.test(rawMsg)) {
          throw new Error(
            "Appliance catalog is missing store_number on the server. Apply migration 20260907_appliance_catalog_store_number.sql, then retry teach."
          );
        }
        throw new Error(rawMsg);
      }
      if (!json.item) {
        throw new Error("API returned no catalog item");
      }

      let saved = mapRow(json.item);

      if (teachScanIdentifier) {
        const taught = await teachScanOnline({
          store_number: store,
          item_number: saved.item_number,
          scan_identifier: teachScanIdentifier,
        });
        if (taught) saved = taught;
      }

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
      if (err instanceof ApplianceServerRejectionError) throw err;
      if (gotHttpResponse) throw err;
      const offlineRecord = { ...record, offline: true };
      upsertLocal(offlineRecord);
      enqueueSyncAction(
        "upsert_appliance_catalog",
        catalogPayload(offlineRecord),
        store
      );
      // Physical teach requires network — do not enqueue plaintext identifiers.
      return { record: offlineRecord, offline: true };
    }
  }

  const offlineRecord = { ...record, offline: true };
  upsertLocal(offlineRecord);
  enqueueSyncAction(
    "upsert_appliance_catalog",
    catalogPayload(offlineRecord),
    store
  );
  // Offline: catalog metadata only — fingerprint teach requires the server.
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

/**
 * Resolve raw scan → catalog item by public item_number only (APP-UPC-001A).
 * Physical barcodes are not matched locally — use resolve-scan API online.
 */
export function findApplianceByItemOrUpc(
  items: ApplianceCatalogItem[],
  raw: string
): ApplianceCatalogItem | undefined {
  const result = resolveApplianceCatalogItem(items, raw);
  return result.status === "matched" ? result.item : undefined;
}

export type ApplianceScanResolution =
  | { kind: "matched"; item: ApplianceCatalogItem; scanned: string }
  | { kind: "ambiguous"; scanned: string }
  | { kind: "unlinked_barcode"; scanned: string }
  | { kind: "unknown_sku"; scanned: string }
  | { kind: "empty" };

/**
 * Local scan disposition (APP-UPC-001A).
 * Matches item_number only. Physical-length scans that do not match become
 * unlinked_barcode / unknown_sku for the teach / resolve-scan path.
 */
export function resolveApplianceScan(
  items: ApplianceCatalogItem[],
  raw: string
): ApplianceScanResolution {
  const scanned = canonicalApplianceScanIdentifier(raw);
  if (!scanned) return { kind: "empty" };

  const result = resolveApplianceCatalogItem(items, scanned);
  if (result.status === "matched") {
    return { kind: "matched", item: result.item, scanned };
  }
  if (result.status === "ambiguous") {
    return { kind: "ambiguous", scanned };
  }

  if (isPhysicalApplianceScanIdentifier(scanned)) {
    return { kind: "unlinked_barcode", scanned };
  }
  return { kind: "unknown_sku", scanned };
}

export function applianceCategoryLabel(
  category: ApplianceCategory | string
): string {
  return normalizeApplianceCategory(category);
}
