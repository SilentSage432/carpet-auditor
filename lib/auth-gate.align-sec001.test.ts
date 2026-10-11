/**
 * ALIGN-SEC-001 — hub gate fail-closed + edge Bearer bypass removal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  edgeAllowsRequest,
  mintHubGateToken,
  resolveHubGateSecret,
  verifyHubGateToken,
} from "@/lib/auth-gate";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ALIGN-SEC-001 hub gate secret", () => {
  it("fails closed when HUB_GATE_SECRET is missing", () => {
    vi.stubEnv("HUB_GATE_SECRET", "");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(resolveHubGateSecret()).toBeNull();
  });

  it("does not use cron, service role, anon, or hardcoded fallbacks", async () => {
    vi.stubEnv("HUB_GATE_SECRET", "");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(await mintHubGateToken("spec-1")).toBeNull();
    expect(await verifyHubGateToken("anything.sig")).toBeNull();
  });

  it("mints and verifies when HUB_GATE_SECRET is configured", async () => {
    vi.stubEnv("HUB_GATE_SECRET", "dedicated-hub-gate-secret-for-tests");
    const token = await mintHubGateToken("operator-1");
    expect(token).toBeTruthy();
    const payload = await verifyHubGateToken(token);
    expect(payload?.sid).toBe("operator-1");
    expect(payload?.v).toBe(1);
  });

  it("rejects invalid gate cookies when secret is configured", async () => {
    vi.stubEnv("HUB_GATE_SECRET", "dedicated-hub-gate-secret-for-tests");
    const token = await mintHubGateToken("operator-1");
    expect(await verifyHubGateToken(token + "x")).toBeNull();
    expect(await verifyHubGateToken("not-a-token")).toBeNull();
    expect(await verifyHubGateToken("")).toBeNull();
  });

  it("rejects cookies minted under a different secret", async () => {
    vi.stubEnv("HUB_GATE_SECRET", "secret-a");
    const token = await mintHubGateToken("operator-1");
    vi.stubEnv("HUB_GATE_SECRET", "secret-b");
    expect(await verifyHubGateToken(token)).toBeNull();
  });
});

describe("ALIGN-SEC-001 edge access classification", () => {
  it("allows public auth and invite paths without a gate cookie", async () => {
    expect(
      await edgeAllowsRequest({ pathname: "/api/auth/hub-bridge" })
    ).toBe(true);
    expect(await edgeAllowsRequest({ pathname: "/api/auth/gate" })).toBe(true);
    expect(
      await edgeAllowsRequest({ pathname: "/api/auth/bootstrap-admin" })
    ).toBe(true);
    expect(await edgeAllowsRequest({ pathname: "/login" })).toBe(true);
    expect(await edgeAllowsRequest({ pathname: "/api/invite/x" })).toBe(true);
  });

  it("allows cron paths at the edge (handler still requires CRON_SECRET)", async () => {
    expect(
      await edgeAllowsRequest({ pathname: "/api/cron/weekly-rotation" })
    ).toBe(true);
  });

  it("denies protected API paths without a gate cookie (Bearer alone insufficient)", async () => {
    expect(
      await edgeAllowsRequest({ pathname: "/api/rotations/generate" })
    ).toBe(false);
    expect(
      await edgeAllowsRequest({ pathname: "/api/store-locations" })
    ).toBe(false);
  });

  it("allows protected API paths with a valid gate cookie", async () => {
    vi.stubEnv("HUB_GATE_SECRET", "dedicated-hub-gate-secret-for-tests");
    const cookie = await mintHubGateToken("operator-1");
    expect(
      await edgeAllowsRequest({
        pathname: "/api/rotations/generate",
        gateCookie: cookie,
      })
    ).toBe(true);
  });

  it("denies HTML operate paths without a gate cookie", async () => {
    expect(await edgeAllowsRequest({ pathname: "/dashboard" })).toBe(false);
  });
});
