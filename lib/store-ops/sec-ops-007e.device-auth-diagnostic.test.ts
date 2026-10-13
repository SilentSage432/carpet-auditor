/**
 * DEPTSYNC-SEC-OPS-007E — device auth diagnostic contracts (no production fix).
 *
 * Documents: current AccessGate recovers; hub page still hangs; SW can retain
 * obsolete hashed JS when stale HTML is served; fetchSpecialists rethrows
 * plain PostgREST error objects (matches "Uncaught (in promise) Object").
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideAccessGateBoot,
  isLikelyAuthRejection,
} from "@/lib/auth/access-gate-bootstrap";
import type { AuthSession } from "@/lib/auth-session";
import type { StoreSpecialist } from "@/lib/types";

const member = {
  id: "spec-1",
  store_number: "2587",
  name: "Master Admin",
  role: "MasterAdmin",
  username: "master_admin",
  assigned_department: "all",
  must_change_credentials: false,
  is_active: true,
  created_at: new Date().toISOString(),
} as StoreSpecialist;

const session: AuthSession = {
  specialist: member,
  sessionToken: "tok-1",
  lastActiveTimestamp: Date.now(),
};

describe("SEC-OPS-007E current AccessGate recovery (case A)", () => {
  it("rejected store_specialists (401-shaped object) → unlock, not booting", () => {
    // PostgREST / supabase-js often rejects with a plain object, not Error.
    const rosterError = {
      message: "JWT expired",
      status: 401,
      code: "PGRST301",
    };
    expect(isLikelyAuthRejection(rosterError)).toBe(true);
    const out = decideAccessGateBoot({
      session,
      sessionExpired: false,
      hasJwt: true,
      roster: null,
      rosterError,
      matched: member,
      needsSetup: false,
    });
    expect(out.mode).toBe("unlock");
    expect(out.reason).toBe("roster_auth_rejected");
    expect(out.clearSupabaseLocal).toBe(true);
  });

  it("AccessGate source catches fetchSpecialists (007D shipped)", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../components/auth/AccessGate.tsx"),
      "utf8"
    );
    expect(source).toMatch(/decideAccessGateBoot/);
    expect(source).toMatch(/rosterError/);
    expect(source).toMatch(/catch\s*\(\s*err\s*\)/);
    expect(source).toMatch(/setMode\(\s*"unlock"\s*\)/);
  });
});

describe("SEC-OPS-007E residual hang surfaces (case B / hub)", () => {
  it("hub app/page.tsx repaired by 007G (JWT-first + decideHubPageBoot)", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../app/page.tsx"),
      "utf8"
    );
    expect(source).toMatch(/Loading DeptSync secure session/);
    expect(source).toMatch(/decideHubPageBoot/);
    expect(source).toMatch(/canFetchProtectedRoster/);
    expect(source).toMatch(/bootGenRef/);
  });

  it("WorkflowTabShell fetchSpecialists has no .catch (post-auth only)", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../components/hub/WorkflowTabShell.tsx"),
      "utf8"
    );
    const idx = source.indexOf("void fetchSpecialists()");
    expect(idx).toBeGreaterThan(-1);
    const window = source.slice(idx, idx + 220);
    expect(window).not.toMatch(/\.catch\s*\(/);
  });
});

describe("SEC-OPS-007E service worker stale-client risk", () => {
  it("caches /_next/static with cache-first and precaches /login", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8"
    );
    // 007G bumps cache name so phones drop v6 shells after activate.
    expect(source).toMatch(/deptsync-shell-v8-auth-002/);
    expect(source).toMatch(/"\/login"/);
    expect(source).toMatch(/path\.startsWith\("\/_next\/static\/"\)/);
    expect(source).toMatch(/async function cacheFirst/);
    expect(source).toMatch(/isStaticAsset\(url\)[\s\S]*cacheFirst/);
    expect(source).toMatch(/skipWaiting/);
    expect(source).toMatch(/clients\.claim/);
  });
});

describe("SEC-OPS-007E fetchSpecialists rejection shape", () => {
  it("rethrows select failures after console.error (device console signature)", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../specialists.ts"),
      "utf8"
    );
    expect(source).toMatch(
      /\[fetchSpecialists\] store_specialists select failed/
    );
    expect(source).toMatch(/throw err/);
  });
});
