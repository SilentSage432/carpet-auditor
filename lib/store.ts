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

/** Digit-equal store numbers (leading zeros ignored): "1852" and "01852" are the same Lowe's. */
export function sameStoreNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeStoreNumber(a ?? "").replace(/^0+/, "") || "";
  const right = normalizeStoreNumber(b ?? "").replace(/^0+/, "") || "";
  return Boolean(left && left === right);
}

/** True when a roster row belongs to the hub session store (`2587` matches `02587`). */
export function belongsToStore(
  memberStore: string | null | undefined,
  store: string | null | undefined
): boolean {
  const target = normalizeStoreNumber(store ?? "");
  if (!target) return true;
  return sameStoreNumber(memberStore, target);
}

/** Values to use in `.in("store_number", …)` so padded JWT claims still match hub session. */
export function storeNumberQueryValues(store: string): string[] {
  const n = normalizeStoreNumber(store);
  if (!n) return [];
  const stripped = n.replace(/^0+/, "") || "0";
  const padded4 = stripped.padStart(4, "0");
  return [...new Set([n, stripped, padded4])];
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

/** Compact header tag — always shows the digits (`#2587`), no Lowe's prefix. */
export function formatStoreHeaderTag(storeNumber = getStoreNumber()): string {
  const n = normalizeStoreNumber(storeNumber).replace(/^0+/, "") || "";
  return n ? `#${n}` : "";
}

/** @deprecated No hardcoded default — use empty string when unset. */
export const DEFAULT_STORE_NUMBER = "";
