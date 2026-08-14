/**
 * Debounced local persistence — compose from domain owners (audit drafts, etc.).
 * Does not own keys or serialization.
 */

export const DEFAULT_DRAFT_DEBOUNCE_MS = 300;

export type DebouncedPersist<T> = {
  schedule: (value: T) => void;
  flush: () => void;
  cancel: () => void;
};

export function createDebouncedPersist<T>(
  write: (value: T) => void,
  delayMs = DEFAULT_DRAFT_DEBOUNCE_MS
): DebouncedPersist<T> {
  let timer: number | null = null;
  let pending: T | null = null;

  function flush() {
    if (timer != null && typeof window !== "undefined") {
      window.clearTimeout(timer);
      timer = null;
    }
    if (pending == null) return;
    const value = pending;
    pending = null;
    write(value);
  }

  function cancel() {
    if (timer != null && typeof window !== "undefined") {
      window.clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  function schedule(value: T) {
    pending = value;
    if (typeof window === "undefined") {
      write(value);
      pending = null;
      return;
    }
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      flush();
    }, delayMs);
  }

  return { schedule, flush, cancel };
}
