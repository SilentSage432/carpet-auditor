/**
 * ALIGN-SEC-002 — local readiness contracts for Vercel deploy of ALIGN-SEC-001.
 * Does not touch production, Vercel, or live credentials.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_TIMEOUT_MS,
} from "@/lib/auth-session";
import {
  HUB_GATE_TTL_MS,
  edgeAllowsRequest,
  mintHubGateToken,
  resolveHubGateSecret,
  verifyHubGateToken,
} from "@/lib/auth-gate";
import {
  authorizeBootstrapRequest,
  resolveBootstrapSecret,
} from "@/lib/store-ops/bootstrap-authorize";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ALIGN-SEC-002 session / gate continuity", () => {
  it("keeps hub gate TTL locked to auth session inactivity timeout", () => {
    expect(HUB_GATE_TTL_MS).toBe(AUTH_SESSION_TIMEOUT_MS);
    expect(HUB_GATE_TTL_MS).toBe(8 * 60 * 60 * 1000);
  });

  it("rejects expired gate cookies", async () => {
    vi.stubEnv("HUB_GATE_SECRET", "sec002-readiness-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    const token = await mintHubGateToken("operator-1");
    expect(await verifyHubGateToken(token)).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-10T20:00:01.000Z")); // +8h1s
    expect(await verifyHubGateToken(token)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects cookies from a prior signing secret after rotation", async () => {
    vi.stubEnv("HUB_GATE_SECRET", "previous-fallback-or-old-secret");
    const legacy = await mintHubGateToken("operator-1");
    vi.stubEnv("HUB_GATE_SECRET", "new-dedicated-hub-gate-secret");
    expect(await verifyHubGateToken(legacy)).toBeNull();
    const restored = await mintHubGateToken("operator-1");
    expect(await verifyHubGateToken(restored)).not.toBeNull();
  });

  it("fails closed when HUB_GATE_SECRET missing even if CRON_SECRET exists", () => {
    vi.stubEnv("HUB_GATE_SECRET", "");
    vi.stubEnv("CRON_SECRET", "vercel-cron-secret");
    expect(resolveHubGateSecret()).toBeNull();
  });
});

describe("ALIGN-SEC-002 recovery without hub gate cookie", () => {
  it("allows bootstrap route at the edge without a gate cookie", async () => {
    expect(
      await edgeAllowsRequest({
        pathname: "/api/auth/bootstrap-admin",
        gateCookie: null,
      })
    ).toBe(true);
  });

  it("allows hub-bridge and gate mint routes without a gate cookie", async () => {
    expect(
      await edgeAllowsRequest({ pathname: "/api/auth/hub-bridge" })
    ).toBe(true);
    expect(await edgeAllowsRequest({ pathname: "/api/auth/gate" })).toBe(true);
    expect(await edgeAllowsRequest({ pathname: "/login" })).toBe(true);
  });

  it("requires BOOTSTRAP_SECRET and rejects CRON_SECRET substitute", () => {
    vi.stubEnv("BOOTSTRAP_SECRET", "");
    vi.stubEnv("CRON_SECRET", "cron-only");
    expect(resolveBootstrapSecret()).toBeNull();
    expect(
      authorizeBootstrapRequest(
        new Request("http://localhost/api/auth/bootstrap-admin", {
          headers: { Authorization: "Bearer cron-only" },
        })
      )
    ).toBe(false);

    vi.stubEnv("BOOTSTRAP_SECRET", "dedicated-bootstrap");
    expect(
      authorizeBootstrapRequest(
        new Request("http://localhost/api/auth/bootstrap-admin", {
          headers: { Authorization: "Bearer dedicated-bootstrap" },
        })
      )
    ).toBe(true);
  });
});

describe("ALIGN-SEC-002 cron continuity under new proxy", () => {
  it("allows cron path at edge without gate cookie", async () => {
    expect(
      await edgeAllowsRequest({
        pathname: "/api/cron/weekly-rotation",
        gateCookie: null,
      })
    ).toBe(true);
  });

  it("vercel.json schedules Sunday weekly-rotation cron", () => {
    const cfg = JSON.parse(
      readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> };
    expect(cfg.crons).toEqual([
      { path: "/api/cron/weekly-rotation", schedule: "0 11 * * 0" },
    ]);
  });

  it("cron handler still requires CRON_SECRET Bearer", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../app/api/cron/weekly-rotation/route.ts"),
      "utf8"
    );
    expect(src).toMatch(/CRON_SECRET/);
    expect(src).toMatch(/status:\s*401/);
  });
});

describe("ALIGN-SEC-002 RLS script safety", () => {
  it("contains only read-only SQL operations", () => {
    const sql = readFileSync(
      path.resolve(
        __dirname,
        "../scripts/sql/align-sec001-rls-verify-readonly.sql"
      ),
      "utf8"
    );
    // Strip comments and string literals before scanning for mutating verbs.
    const stripped = sql
      .replace(/--.*$/gm, "")
      .replace(/'[^']*'/g, "''");
    const upper = stripped.toUpperCase();
    for (const banned of [
      /\bINSERT\b/,
      /\bUPDATE\b/,
      /\bDELETE\b/,
      /\bALTER\b/,
      /\bDROP\b/,
      /\bCREATE\b/,
      /\bGRANT\b/,
      /\bREVOKE\b/,
      /\bTRUNCATE\b/,
    ]) {
      expect(upper.search(banned)).toBe(-1);
    }
    expect(sql.toUpperCase()).toMatch(/SELECT/);
    expect(sql).toMatch(/pg_policies/);
    expect(sql).not.toMatch(/pin_code|\bpassword\b/i);
  });
});

describe("ALIGN-SEC-002 proxy Bearer bypass still closed", () => {
  it("denies protected APIs without gate cookie", async () => {
    expect(
      await edgeAllowsRequest({ pathname: "/api/rotations/generate" })
    ).toBe(false);
    expect(
      await edgeAllowsRequest({ pathname: "/api/store-locations" })
    ).toBe(false);
    expect(await edgeAllowsRequest({ pathname: "/dashboard" })).toBe(false);
  });
});
