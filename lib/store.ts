/** Active Lowe's store number — owns multi-store session context. */

const STORE_KEY = "carpet_hub_store_number";
export const DEFAULT_STORE_NUMBER = "1234";
export const STORE_CHANGED_EVENT = "carpet-store-changed";

export const STORE_PRESETS = ["1234", "0567", "2891", "4120"] as const;

export function normalizeStoreNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length > 0 ? digits : DEFAULT_STORE_NUMBER;
}

export function getStoreNumber(): string {
  if (typeof window === "undefined") return DEFAULT_STORE_NUMBER;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_STORE_NUMBER;
    return normalizeStoreNumber(raw);
  } catch {
    return DEFAULT_STORE_NUMBER;
  }
}

export function setStoreNumber(raw: string): string {
  const next = normalizeStoreNumber(raw);
  if (typeof window === "undefined") return next;
  localStorage.setItem(STORE_KEY, next);
  window.dispatchEvent(
    new CustomEvent(STORE_CHANGED_EVENT, { detail: next })
  );
  return next;
}

export function formatStoreLabel(storeNumber = getStoreNumber()): string {
  return `Lowe's #${storeNumber}`;
}
