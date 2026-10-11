/**
 * ALIGN-SEC-001 — bootstrap requires dedicated BOOTSTRAP_SECRET.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeBootstrapRequest,
  resolveBootstrapSecret,
} from "@/lib/store-ops/bootstrap-authorize";

afterEach(() => {
  vi.unstubAllEnvs();
});

function requestWithBearer(token: string): Request {
  return new Request("http://localhost/api/auth/bootstrap-admin", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("ALIGN-SEC-001 bootstrap authorization", () => {
  it("fails closed when BOOTSTRAP_SECRET is unset", () => {
    vi.stubEnv("BOOTSTRAP_SECRET", "");
    vi.stubEnv("CRON_SECRET", "cron-only");
    expect(resolveBootstrapSecret()).toBeNull();
    expect(authorizeBootstrapRequest(requestWithBearer("cron-only"))).toBe(
      false
    );
  });

  it("does not accept CRON_SECRET as a substitute", () => {
    vi.stubEnv("BOOTSTRAP_SECRET", "bootstrap-only");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(authorizeBootstrapRequest(requestWithBearer("cron-secret"))).toBe(
      false
    );
  });

  it("accepts Bearer BOOTSTRAP_SECRET", () => {
    vi.stubEnv("BOOTSTRAP_SECRET", "bootstrap-only");
    expect(
      authorizeBootstrapRequest(requestWithBearer("bootstrap-only"))
    ).toBe(true);
  });

  it("rejects missing or wrong Bearer", () => {
    vi.stubEnv("BOOTSTRAP_SECRET", "bootstrap-only");
    expect(
      authorizeBootstrapRequest(
        new Request("http://localhost/api/auth/bootstrap-admin", {
          method: "POST",
        })
      )
    ).toBe(false);
    expect(authorizeBootstrapRequest(requestWithBearer("wrong"))).toBe(false);
  });
});
