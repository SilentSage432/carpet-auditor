/**
 * Durable stale-while-revalidate for Store Map / Floor.
 * Owns IndexedDB persistence only (Dexie-style object stores).
 * ttl-cache.ts owns in-memory TTL; client.ts composes L1 + L2 + network.
 * Presentation hydrates from peek, then applies network only when the fingerprint changes.
 */

const DB_NAME = "deptsync-store-ops";
const DB_VERSION = 1;

export type DurableKind =
  | "store_locations"
  | "weekly_rotations"
  | "shift_briefings";

export type DurableRecord<T> = {
  key: string;
  fingerprint: string;
  updatedAt: number;
  data: T;
};

const STORES: DurableKind[] = [
  "store_locations",
  "weekly_rotations",
  "shift_briefings",
];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "key" });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Stable djb2 fingerprint — skip React setState when upstream is unchanged. */
export function fingerprintValue(value: unknown): string {
  const text = typeof value === "string" ? value : stableSerialize(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${text.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

function stableSerialize(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

export function fingerprintsEqual(
  a: unknown,
  b: unknown
): boolean {
  if (a === b) return true;
  return fingerprintValue(a) === fingerprintValue(b);
}

export function durableListKey(
  kind: DurableKind,
  specialistId: string,
  storeNumber: string,
  extra = ""
): string {
  return `${kind}:${specialistId}:${storeNumber}:${extra}`;
}

export async function peekDurable<T>(
  kind: DurableKind,
  key: string
): Promise<DurableRecord<T> | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    const tx = db.transaction(kind, "readonly");
    const row = (await requestToPromise(
      tx.objectStore(kind).get(key)
    )) as DurableRecord<T> | undefined;
    return row?.data === undefined ? undefined : row;
  } catch {
    return undefined;
  }
}

export async function putDurable<T>(
  kind: DurableKind,
  key: string,
  data: T
): Promise<string> {
  const fingerprint = fingerprintValue(data);
  const db = await openDb();
  if (!db) return fingerprint;
  const row: DurableRecord<T> = {
    key,
    fingerprint,
    updatedAt: Date.now(),
    data,
  };
  try {
    const tx = db.transaction(kind, "readwrite");
    tx.objectStore(kind).put(row);
    await requestToPromise(tx.objectStore(kind).get(key));
  } catch {
    /* private mode / quota — in-memory TTL still serves the tab */
  }
  return fingerprint;
}

export async function clearDurable(kind?: DurableKind): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const names = kind ? [kind] : STORES;
  try {
    const tx = db.transaction(names, "readwrite");
    await Promise.all(
      names.map((name) => requestToPromise(tx.objectStore(name).clear()))
    );
  } catch {
    /* ignore */
  }
}

/**
 * Instant cache paint, then background loader. Calls `apply` immediately on
 * IndexedDB hit (<20ms typical) and again only when the network fingerprint differs.
 */
export async function hydrateThenRevalidate<T>(options: {
  kind: DurableKind;
  key: string;
  load: () => Promise<T>;
  apply: (data: T, meta: { source: "cache" | "network"; changed: boolean }) => void;
}): Promise<T> {
  const cached = await peekDurable<T>(options.kind, options.key);
  if (cached) {
    options.apply(cached.data, { source: "cache", changed: false });
  }

  const fresh = await options.load();
  const changed = !cached || cached.fingerprint !== fingerprintValue(fresh);
  if (changed) {
    options.apply(fresh, { source: "network", changed: true });
  }
  void putDurable(options.kind, options.key, fresh);
  return fresh;
}
