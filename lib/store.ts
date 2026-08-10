/** Active Lowe's store number — owns multi-store session context. */

const STORE_KEY = "carpet_hub_store_number";
export const STORE_CHANGED_EVENT = "carpet-store-changed";

/**
 * Normalize a user-entered store number.
 * Digits-only preference for Lowe's store #s, but never invents a default
 * like "1234" / "1852" when blank.
 */
export function normalizeStoreNumber(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[^\d]/g, "");
}

/** Active store from localStorage — empty string when unset (no hardcoded default). */
export function getStoreNumber(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw == null) return "";
    return normalizeStoreNumber(raw);
  } catch {
    return "";
  }
}

/**
 * Persist store number. Allows blank. Fires STORE_CHANGED_EVENT only when the
 * stored value actually changes.
 */
export function setStoreNumber(raw: string): string {
  const next = normalizeStoreNumber(raw);
  if (typeof window === "undefined") return next;
  const prev = normalizeStoreNumber(localStorage.getItem(STORE_KEY) ?? "");
  if (next) {
    localStorage.setItem(STORE_KEY, next);
  } else {
    localStorage.removeItem(STORE_KEY);
  }
  if (prev !== next) {
    window.dispatchEvent(
      new CustomEvent(STORE_CHANGED_EVENT, { detail: next })
    );
  }
  return next;
}

export function formatStoreLabel(storeNumber = getStoreNumber()): string {
  const n = normalizeStoreNumber(storeNumber);
  return n ? `Lowe's #${n}` : "Lowe's (set store #)";
}

/** @deprecated No hardcoded default — use empty string when unset. */
export const DEFAULT_STORE_NUMBER = "";
