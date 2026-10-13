/**
 * AUTH-002 — bounded browser fetches for authentication.
 * Owns AbortController timeouts only; callers own retry policy.
 */

export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export class AuthRequestTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly code = "AUTH_REQUEST_TIMEOUT" as const;

  constructor(timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
    super(
      `Sign-in timed out after ${Math.round(timeoutMs / 1000)}s. Check your connection and try again.`
    );
    this.name = "AuthRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isAuthRequestTimeoutError(
  err: unknown
): err is AuthRequestTimeoutError {
  return (
    err instanceof AuthRequestTimeoutError ||
    (err instanceof Error &&
      (err.name === "AuthRequestTimeoutError" ||
        (err as { code?: string }).code === "AUTH_REQUEST_TIMEOUT"))
  );
}

/**
 * fetch() with a hard timeout. Does not auto-retry (non-idempotent auth).
 */
export async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const external = init?.signal;
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener(
        "abort",
        () => controller.abort(external.reason),
        { once: true }
      );
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new AuthRequestTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (isAuthRequestTimeoutError(err)) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      const reason = controller.signal.reason;
      if (isAuthRequestTimeoutError(reason)) throw reason;
      throw new AuthRequestTimeoutError(timeoutMs);
    }
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message))
    ) {
      throw new AuthRequestTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function authNetworkErrorMessage(err: unknown): string {
  if (isAuthRequestTimeoutError(err)) return err.message;
  const message = String(
    (err as { message?: string })?.message ?? err ?? ""
  ).toLowerCase();
  if (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("offline")
  ) {
    return "Network error during sign-in. Check your connection and try again.";
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Sign-in failed. Try again.";
}
