/**
 * In-memory TTL + in-flight dedupe for Store Ops list GETs.
 * Presentation must not recompute; this only caches transport results.
 */

type Entry<T> = { key: string; at: number; data: T };

export function createTtlCache<T>(ttlMs: number) {
  let entry: Entry<T> | null = null;
  const inflight = new Map<string, Promise<T>>();

  return {
    invalidate() {
      entry = null;
      inflight.clear();
    },
    async get(key: string, loader: () => Promise<T>): Promise<T> {
      const now = Date.now();
      if (entry && entry.key === key && now - entry.at < ttlMs) {
        return entry.data;
      }
      const pending = inflight.get(key);
      if (pending) return pending;
      const next = loader()
        .then((data) => {
          entry = { key, at: Date.now(), data };
          return data;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, next);
      return next;
    },
  };
}
