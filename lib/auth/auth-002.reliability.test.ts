/**
 * DEPTSYNC-AUTH-002 — reliability contracts (timeouts, slim mint, honest biometric).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_REQUEST_TIMEOUT_MS,
  AuthRequestTimeoutError,
  authNetworkErrorMessage,
  boundedFetch,
  isAuthRequestTimeoutError,
} from "@/lib/auth/bounded-fetch";

describe("AUTH-002 bounded fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("exports a 15s default timeout", () => {
    expect(AUTH_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it("times out and surfaces AuthRequestTimeoutError", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          })
      )
    );

    const pending = boundedFetch("/api/auth/hub-bridge", { method: "POST" }, 100);
    const expectation = expect(pending).rejects.toSatisfy(
      (err: unknown) =>
        isAuthRequestTimeoutError(err) &&
        String((err as Error).message).includes("timed out")
    );
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });

  it("maps network failures to operator-safe copy", () => {
    expect(authNetworkErrorMessage(new TypeError("Failed to fetch"))).toMatch(
      /Network error/i
    );
    expect(
      authNetworkErrorMessage(new AuthRequestTimeoutError(15_000))
    ).toMatch(/timed out/i);
  });
});

describe("AUTH-002 hub-bridge mint slim path", () => {
  it("uses generateLink + verifyOtp and does not rotate password per login", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../store-ops/hub-bridge.ts"),
      "utf8"
    );
    expect(source).toMatch(/generateLink/);
    expect(source).toMatch(/verifyOtp/);
    expect(source).toMatch(/ensureAuthProfileLinked/);
    expect(source).not.toMatch(/listUsers\(\{\s*page:\s*1,\s*perPage:\s*1000/);
    // mintSessionForSpecialist must not call signInWithPassword / per-login updateUserById password.
    const mintStart = source.indexOf("async function mintSessionForSpecialist");
    expect(mintStart).toBeGreaterThan(-1);
    const mintBody = source.slice(mintStart, mintStart + 1800);
    expect(mintBody).toMatch(/generateLink/);
    expect(mintBody).toMatch(/verifyOtp/);
    expect(mintBody).toMatch(/session identity mismatch|identity mismatch/);
    expect(mintBody).not.toMatch(/signInWithPassword/);
    expect(mintBody).not.toMatch(/updateUserById/);
    // hashed_token / action_link must never be returned from the HTTP route.
    const route = await readFile(
      path.resolve(__dirname, "../../app/api/auth/hub-bridge/route.ts"),
      "utf8"
    );
    expect(route).not.toMatch(/hashed_token|action_link/);
    expect(route).toMatch(/timings/);
  });

  it("hub-bridge client uses boundedFetch and does not auto-retry", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../store-ops/hub-bridge-client.ts"),
      "utf8"
    );
    expect(source).toMatch(/boundedFetch/);
    expect(source).toMatch(/AUTH_REQUEST_TIMEOUT/);
    expect(source).toMatch(/retryable/);
    expect(source).not.toMatch(/for\s*\(.*retry/);
    expect(source).not.toMatch(/while\s*\(.*retry/);
  });

  it("startAuthSession does not fire-and-forget hub-gate sync", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../auth-session.ts"),
      "utf8"
    );
    expect(source).toMatch(/does NOT mint the hub-gate cookie/);
    expect(source).not.toMatch(/void syncHubGateCookie/);
  });
});

describe("AUTH-002 AuthWall terminal busy + honest biometric", () => {
  it("guards duplicate submission and clears busy in finally", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../components/auth/AuthWall.tsx"),
      "utf8"
    );
    expect(source).toMatch(/submittingRef/);
    expect(source).toMatch(/finally \{\s*submittingRef\.current = false/);
    expect(source).toMatch(/setBusy\(false\)/);
    expect(source).toMatch(/resolveLiveSupabaseSession/);
    expect(source).toMatch(/hasStoredSupabaseAuthHint/);
    expect(source).toMatch(/Resume with fingerprint/);
    expect(source).toMatch(/not a separate\s+password/);
    expect(source).not.toMatch(/Login with Fingerprint/);
  });

  it("AccessGate fails closed when hub-gate mint fails", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../components/auth/AccessGate.tsx"),
      "utf8"
    );
    expect(source).toMatch(/syncHubGateCookie/);
    expect(source).toMatch(/if \(!gated\)/);
    expect(source).toMatch(/homeHrefForSpecialist/);
  });
});
