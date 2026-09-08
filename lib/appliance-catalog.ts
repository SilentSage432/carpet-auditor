/**
 * Appliance master catalog — owns public.appliance_catalog.
 * Flooring catalog stays in lib/catalog.ts (carpet_catalog).
 *
 * APP-CAT-001A: canonical identity is (store_number, item_number).
 * Scannable identifiers (legacy upc + appliance_catalog_identifiers) resolve
 * to that identity. One identifier → one item per store.
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
const IDENTIFIERS_TABLE = "appliance_catalog_identifiers";

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
 * Stable storage form for a taught scannable identifier (APP-CAT-001A).
 * Trims scanner framing/whitespace only — does NOT strip non-digits or
 * leading zeros (those remain field-test / transport concerns).
 */
export function normalizeApplianceIdentifier(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, "")
    .trim();
}

/**
 * Lookup keys for dual-read resolution: exact normalized form plus digit-sanitized
 * form used by legacy upc / current wedge transport.
 *
 * IMPORTANT: callers must NOT treat key intersection as a match across items.
 * Use resolveApplianceCatalogItem — exact match first; sanitized fallback only
 * when it uniquely identifies one canonical item.
 */
export function applianceIdentifierLookupKeys(raw: unknown): string[] {
  const normalized = normalizeApplianceIdentifier(raw);
  const keys: string[] = [];
  if (normalized) keys.push(normalized);
  const digits = sanitizeBarcodeScan(String(raw ?? ""));
  if (digits && digits !== normalized) keys.push(digits);
  else if (digits && !normalized) keys.push(digits);
  return keys;
}

function exactIdentifierMatch(
  stored: string | null | undefined,
  rawExact: string
): boolean {
  if (!rawExact || stored == null || stored === "") return false;
  return normalizeApplianceIdentifier(stored) === rawExact;
}

function digitIdentifierMatch(
  stored: string | null | undefined,
  digitKey: string
): boolean {
  if (!digitKey || stored == null || stored === "") return false;
  const storedDigits = sanitizeBarcodeScan(stored);
  return Boolean(storedDigits && storedDigits === digitKey);
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
 * Deterministic catalog resolution (APP-CAT-001A).
 *
 * Order:
 * 1. Exact normalized match on item_number
 * 2. Exact normalized match on legacy upc
 * 3. Exact normalized match on taught identifiers
 * 4. Digit-sanitized compatibility fallback (legacy wedge / UPC) — ONLY if
 *    exactly one canonical item matches; otherwise unresolved (no arbitrary pick)
 */
export function resolveApplianceCatalogItem(
  items: ApplianceCatalogItem[],
  raw: string
): ApplianceCatalogResolveResult {
  const exact = normalizeApplianceIdentifier(raw);
  const digitKey = sanitizeBarcodeScan(raw);
  if (!exact && !digitKey) return { status: "none" };

  if (exact) {
    const itemNumberHits = uniqueCatalogItems(
      items.filter((item) => exactIdentifierMatch(item.item_number, exact))
    );
    if (itemNumberHits.length === 1) {
      return { status: "matched", item: itemNumberHits[0]! };
    }
    if (itemNumberHits.length > 1) return { status: "ambiguous" };

    const upcHits = uniqueCatalogItems(
      items.filter((item) => exactIdentifierMatch(item.upc, exact))
    );
    if (upcHits.length === 1) return { status: "matched", item: upcHits[0]! };
    if (upcHits.length > 1) return { status: "ambiguous" };

    const aliasHits = uniqueCatalogItems(
      items.filter((item) =>
        (item.identifiers ?? []).some((id) => exactIdentifierMatch(id, exact))
      )
    );
    if (aliasHits.length === 1) return { status: "matched", item: aliasHits[0]! };
    if (aliasHits.length > 1) return { status: "ambiguous" };
  }

  if (!digitKey) return { status: "none" };

  const digitHits = uniqueCatalogItems(
    items.filter((item) => {
      if (digitIdentifierMatch(item.item_number, digitKey)) return true;
      if (digitIdentifierMatch(item.upc, digitKey)) return true;
      return (item.identifiers ?? []).some((id) =>
        digitIdentifierMatch(id, digitKey)
      );
    })
  );
  if (digitHits.length === 1) return { status: "matched", item: digitHits[0]! };
  if (digitHits.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}

/**
 * Conflict helper: another item already owns this exact identifier, OR owns an
 * identifier/upc/item_number whose digit-sanitized form collapses to the same
 * key (would make future sanitized fallback ambiguous).
 */
function identifierConflictsWithItem(
  item: ApplianceCatalogItem,
  identifierRaw: string
): boolean {
  const exact = normalizeApplianceIdentifier(identifierRaw);
  const digitKey = sanitizeBarcodeScan(identifierRaw);
  if (exact) {
    if (exactIdentifierMatch(item.item_number, exact)) return true;
    if (exactIdentifierMatch(item.upc, exact)) return true;
    if ((item.identifiers ?? []).some((id) => exactIdentifierMatch(id, exact))) {
      return true;
    }
  }
  if (digitKey) {
    if (digitIdentifierMatch(item.item_number, digitKey)) return true;
    if (digitIdentifierMatch(item.upc, digitKey)) return true;
    if (
      (item.identifiers ?? []).some((id) => digitIdentifierMatch(id, digitKey))
    ) {
      return true;
    }
  }
  return false;
}

/** Union of legacy upc + taught identifiers (stable, de-duped). */
export function listApplianceTaughtIdentifiers(
  item: Pick<ApplianceCatalogItem, "upc" | "identifiers" | "item_number">
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string | null | undefined) => {
    const n = normalizeApplianceIdentifier(v);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  push(item.upc);
  for (const id of item.identifiers ?? []) push(id);
  return out;
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
      : normalizeApplianceIdentifier(upcRaw) ||
        sanitizeBarcodeScan(String(upcRaw)) ||
        null;
  const pair = resolveApplianceCategoryPair(row.category, row.sub_category);
  const identifiersRaw = row.identifiers;
  const identifiers = Array.isArray(identifiersRaw)
    ? identifiersRaw
        .map((v) => normalizeApplianceIdentifier(v))
        .filter(Boolean)
    : undefined;

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
    identifiers,
  };
}

function mapRow(row: Record<string, unknown>): ApplianceCatalogItem {
  return mapApplianceCatalogRow(row);
}

function withIdentifierOnItem(
  item: ApplianceCatalogItem,
  identifier: string
): ApplianceCatalogItem {
  const next = normalizeApplianceIdentifier(identifier);
  if (!next) return item;
  const existing = listApplianceTaughtIdentifiers(item);
  if (existing.some((id) => normalizeApplianceIdentifier(id) === next)) {
    return {
      ...item,
      identifiers: existing,
    };
  }
  return {
    ...item,
    identifiers: [...existing, next],
  };
}

/**
 * Find another catalog row that already owns this scannable identifier
 * (legacy upc or taught alias). Same item id / item_number is not a conflict.
 */
export function findApplianceUpcConflict(
  items: ApplianceCatalogItem[],
  upcRaw: string | null | undefined,
  options?: { excludeId?: string; excludeItemNumber?: string }
): ApplianceCatalogItem | undefined {
  return findApplianceIdentifierConflict(items, upcRaw, options);
}

export function findApplianceIdentifierConflict(
  items: ApplianceCatalogItem[],
  identifierRaw: string | null | undefined,
  options?: { excludeId?: string; excludeItemNumber?: string }
): ApplianceCatalogItem | undefined {
  const exact = normalizeApplianceIdentifier(identifierRaw);
  const digitKey = sanitizeBarcodeScan(String(identifierRaw ?? ""));
  if (!exact && !digitKey) return undefined;
  const excludeItem = options?.excludeItemNumber
    ? normalizeApplianceIdentifier(options.excludeItemNumber) ||
      sanitizeBarcodeScan(options.excludeItemNumber)
    : "";

  return items.find((item) => {
    if (options?.excludeId && item.id === options.excludeId) return false;
    const itemKey =
      normalizeApplianceIdentifier(item.item_number) ||
      sanitizeBarcodeScan(item.item_number);
    if (excludeItem && itemKey === excludeItem) return false;
    return identifierConflictsWithItem(item, String(identifierRaw ?? ""));
  });
}

/** Search Item #, identifiers, description, category, and sub-category for manage UI. */
export function filterApplianceCatalog(
  catalog: ApplianceCatalogItem[],
  query: string
): ApplianceCatalogItem[] {
  const sorted = [...catalog].sort((a, b) =>
    a.item_number.localeCompare(b.item_number)
  );
  const q = query.trim().toLowerCase();
  if (!q && !normalizeApplianceIdentifier(query) && !sanitizeBarcodeScan(query)) {
    return sorted;
  }

  return sorted.filter((item) => {
    if (
      item.item_number.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.sub_category ?? "").toLowerCase().includes(q)
    ) {
      return true;
    }
    if (!q && !normalizeApplianceIdentifier(query)) return false;
    const resolved = resolveApplianceCatalogItem([item], query);
    return resolved.status === "matched";
  });
}

function assertNoIdentifierConflict(
  store: string,
  record: Pick<ApplianceCatalogItem, "id" | "item_number" | "upc">,
  identifier?: string | null
): void {
  const checkValue = identifier ?? record.upc;
  const conflict = findApplianceIdentifierConflict(forStore(store), checkValue, {
    excludeId: record.id,
    excludeItemNumber: record.item_number,
  });
  if (conflict) {
    throw new ApplianceCatalogConflictError(
      `Identifier ${normalizeApplianceIdentifier(checkValue)} is already linked to Item ${conflict.item_number}. Clear or change that link first.`,
      conflict
    );
  }
}

function upsertLocal(record: ApplianceCatalogItem): ApplianceCatalogItem[] {
  if (record.upc) {
    assertNoIdentifierConflict(record.store_number, record, record.upc);
  }

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

function attachIdentifiers(
  items: ApplianceCatalogItem[],
  rows: { store_number: string; item_number: string; identifier: string }[]
): ApplianceCatalogItem[] {
  const byItem = new Map<string, string[]>();
  for (const row of rows) {
    const key = `${row.store_number}::${row.item_number}`;
    const list = byItem.get(key) ?? [];
    const id = normalizeApplianceIdentifier(row.identifier);
    if (id && !list.includes(id)) list.push(id);
    byItem.set(key, list);
  }
  return items.map((item) => {
    const extra = byItem.get(`${item.store_number}::${item.item_number}`) ?? [];
    const merged = listApplianceTaughtIdentifiers({
      ...item,
      identifiers: extra,
    });
    return { ...item, identifiers: merged };
  });
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
    let remote = (data ?? []).map((row) =>
      mapRow(row as Record<string, unknown>)
    );

    const { data: idRows, error: idError } = await supabase
      .from(IDENTIFIERS_TABLE)
      .select("store_number, item_number, identifier")
      .eq("store_number", store);
    if (!idError && idRows) {
      remote = attachIdentifiers(
        remote,
        idRows as {
          store_number: string;
          item_number: string;
          identifier: string;
        }[]
      );
    }

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
 * queued as offline intent; only a network/no-response failure may queue.
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

/** Server rejected the identifier alias write. */
export class ApplianceIdentifierHttpError extends ApplianceServerRejectionError {
  constructor(message: string, httpStatus: number) {
    super(message, httpStatus);
    this.name = "ApplianceIdentifierHttpError";
  }
}

/**
 * Server rejected ensuring the canonical parent catalog item
 * (APP-CAT-001A-FIX-001A). The identifier alias must not be attempted.
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
 * `appliance_catalog_identifiers_item_fkey` references
 * `appliance_catalog (store_number, item_number)`, so an alias written against an
 * absent parent is rejected — as a 404 through the identifiers API, or as a raw
 * foreign-key violation when a queued alias replays directly against the database.
 *
 * Idempotent: an existing server parent is left untouched. Exactly one explicitly
 * chosen item is ensured — never bulk device-catalog promotion.
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
      upc: item.upc,
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

async function persistIdentifierOnline(input: {
  store_number: string;
  item_number: string;
  identifier: string;
  id?: string;
}): Promise<void> {
  const authHeaders = await storeOpsAuthHeadersAsync();
  const res = await fetch("/api/appliances/catalog/identifiers", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      "x-store-number": input.store_number,
    },
    body: JSON.stringify({
      id: input.id,
      store_number: input.store_number,
      item_number: input.item_number,
      identifier: input.identifier,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    conflict?: Record<string, unknown>;
  };
  if (res.status === 409) {
    const conflictRow = json.conflict ? mapRow(json.conflict) : null;
    throw new ApplianceCatalogConflictError(
      json.error ||
        `Identifier ${input.identifier} is already linked to another item.`,
      conflictRow ??
        ({
          id: "unknown",
          store_number: input.store_number,
          item_number: "?",
          upc: null,
          description: "",
          category: "Laundry",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } satisfies ApplianceCatalogItem)
    );
  }
  if (!res.ok) {
    throw new ApplianceIdentifierHttpError(
      json.error || `Identifier save failed (${res.status})`,
      res.status
    );
  }
}

/**
 * Teach a scannable identifier onto an existing canonical item (link path).
 * Does not rewrite catalog metadata or legacy upc.
 */
export async function linkApplianceCatalogIdentifier(input: {
  item: ApplianceCatalogItem;
  identifier: string;
}): Promise<{ record: ApplianceCatalogItem; offline: boolean }> {
  const store = input.item.store_number || getStoreNumber();
  const identifier = normalizeApplianceIdentifier(input.identifier);
  if (!identifier) {
    throw new Error("identifier is required");
  }

  assertNoIdentifierConflict(
    store,
    {
      id: input.item.id,
      item_number: input.item.item_number,
      upc: input.item.upc,
    },
    identifier
  );

  const now = new Date().toISOString();
  const id = uid();
  const updated = withIdentifierOnItem(
    { ...input.item, store_number: store },
    identifier
  );

  /**
   * Queue the teaching intent in FK dependency order: the canonical parent catalog
   * item must replay before its identifier alias, or the alias hits
   * `appliance_catalog_identifiers_item_fkey` and quarantines.
   */
  const queueOfflineLink = (parentConfirmed: boolean) => {
    const offlineRecord = { ...updated, offline: true, updated_at: now };
    upsertLocal(offlineRecord);
    if (!parentConfirmed) {
      enqueueSyncAction(
        "upsert_appliance_catalog",
        catalogPayload({ ...input.item, store_number: store }),
        store
      );
    }
    enqueueSyncAction(
      "upsert_appliance_catalog_identifier",
      {
        id,
        store_number: store,
        item_number: input.item.item_number,
        identifier,
        created_at: now,
        updated_at: now,
      },
      store
    );
    return { record: offlineRecord, offline: true };
  };

  if (isBrowserOnline()) {
    // Parent first: an alias against an absent parent is a guaranteed FK rejection.
    // Only the network call may be classified as "no response" — a local write
    // failure after the server accepted must never re-queue the same identifier.
    try {
      await ensureApplianceCatalogParentOnline({
        ...input.item,
        store_number: store,
      });
    } catch (err) {
      // Server responded and rejected: keep it visible, never attempt the alias.
      if (err instanceof ApplianceCatalogConflictError) throw err;
      if (err instanceof ApplianceServerRejectionError) throw err;
      // No server response — queue parent then alias.
      return queueOfflineLink(false);
    }

    try {
      await persistIdentifierOnline({
        id,
        store_number: store,
        item_number: input.item.item_number,
        identifier,
      });
    } catch (err) {
      // Server responded and rejected: keep it a visible failure, never queue.
      if (err instanceof ApplianceCatalogConflictError) throw err;
      if (err instanceof ApplianceServerRejectionError) throw err;
      // No server response, but the parent is already persisted — queue the alias only.
      return queueOfflineLink(true);
    }

    const existing = readAllLocal().filter(
      (r) =>
        !(
          r.store_number === updated.store_number &&
          (r.id === updated.id || r.item_number === updated.item_number)
        )
    );
    writeAllLocal(
      [...existing, { ...updated, offline: false }].sort((a, b) =>
        a.item_number.localeCompare(b.item_number)
      )
    );
    return { record: { ...updated, offline: false }, offline: false };
  }

  return queueOfflineLink(false);
}

export async function saveApplianceCatalogItem(
  input: ApplianceCatalogItemInsert & { teach_identifier?: string | null }
): Promise<{ record: ApplianceCatalogItem; offline: boolean }> {
  const now = new Date().toISOString();
  const store = input.store_number ?? getStoreNumber();
  const upcRaw = input.upc;
  const upc =
    upcRaw == null || upcRaw === ""
      ? null
      : normalizeApplianceIdentifier(upcRaw) ||
        sanitizeBarcodeScan(String(upcRaw)) ||
        null;
  const teachIdentifier =
    input.teach_identifier == null || input.teach_identifier === ""
      ? upc
      : normalizeApplianceIdentifier(input.teach_identifier) || upc;
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
    identifiers: teachIdentifier ? [teachIdentifier] : [],
  };

  if (teachIdentifier) {
    assertNoIdentifierConflict(store, record, teachIdentifier);
  } else if (record.upc) {
    assertNoIdentifierConflict(store, record, record.upc);
  }

  /**
   * Online: actor-bound catalog API only.
   * Application responses MUST remain failures — never fall through to
   * direct client Supabase upsert. Network unavailable → offline queue.
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
          teach_identifier: teachIdentifier,
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
          json.error || `Identifier is already linked to another item.`,
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

      const saved = mapRow(json.item);
      const withIds = teachIdentifier
        ? withIdentifierOnItem(saved, teachIdentifier)
        : saved;
      const existing = readAllLocal().filter(
        (r) =>
          !(
            r.store_number === withIds.store_number &&
            (r.id === withIds.id || r.item_number === withIds.item_number)
          )
      );
      writeAllLocal(
        [...existing, withIds].sort((a, b) =>
          a.item_number.localeCompare(b.item_number)
        )
      );
      return { record: withIds, offline: false };
    } catch (err) {
      if (err instanceof ApplianceCatalogConflictError) throw err;
      if (gotHttpResponse) throw err;
      const offlineRecord = { ...record, offline: true };
      upsertLocal(offlineRecord);
      enqueueSyncAction(
        "upsert_appliance_catalog",
        catalogPayload(offlineRecord),
        store
      );
      if (teachIdentifier) {
        enqueueSyncAction(
          "upsert_appliance_catalog_identifier",
          {
            id: uid(),
            store_number: store,
            item_number: record.item_number,
            identifier: teachIdentifier,
            created_at: now,
            updated_at: now,
          },
          store
        );
      }
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
  if (teachIdentifier) {
    enqueueSyncAction(
      "upsert_appliance_catalog_identifier",
      {
        id: uid(),
        store_number: store,
        item_number: record.item_number,
        identifier: teachIdentifier,
        created_at: now,
        updated_at: now,
      },
      store
    );
  }
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
 * Resolve raw scan → one canonical catalog item via item_number, legacy upc,
 * or taught identifiers (APP-CAT-001A). Ambiguous sanitized collapses → undefined.
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

export function resolveApplianceScan(
  items: ApplianceCatalogItem[],
  raw: string
): ApplianceScanResolution {
  const normalized = normalizeApplianceIdentifier(raw);
  const digits = sanitizeBarcodeScan(raw);
  // Prefer preserving exact normalized form for teach/display when present;
  // wedge transport today usually supplies digits-only already.
  const scanned = normalized || digits;
  if (!scanned) return { kind: "empty" };

  const result = resolveApplianceCatalogItem(items, scanned);
  if (result.status === "matched") {
    return { kind: "matched", item: result.item, scanned };
  }
  if (result.status === "ambiguous") {
    return { kind: "ambiguous", scanned };
  }

  const lengthProbe = digits || normalized;
  if (lengthProbe.length >= 8) {
    return { kind: "unlinked_barcode", scanned };
  }
  return { kind: "unknown_sku", scanned };
}

export function applianceCategoryLabel(
  category: ApplianceCategory | string
): string {
  return normalizeApplianceCategory(category);
}
