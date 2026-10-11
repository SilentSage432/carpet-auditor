/**
 * DEPTSYNC-SEC-OPS-007D — AccessGate bootstrap recovery decisions.
 */
import { describe, expect, it } from "vitest";
import {
  decideAccessGateBoot,
  isLikelyAuthRejection,
  isLikelyNetworkFailure,
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

describe("SEC-OPS-007D decideAccessGateBoot", () => {
  it("clean/missing session → login (PIN)", () => {
    const out = decideAccessGateBoot({
      session: null,
      sessionExpired: false,
      hasJwt: false,
      roster: null,
      rosterError: null,
      matched: null,
      needsSetup: false,
    });
    expect(out.mode).toBe("login");
    expect(out.reason).toBe("missing_session");
    expect(out.clearHubSession).toBe(false);
  });

  it("expired session → login and clear hub session", () => {
    const out = decideAccessGateBoot({
      session,
      sessionExpired: true,
      hasJwt: true,
      roster: null,
      rosterError: null,
      matched: null,
      needsSetup: false,
    });
    expect(out.mode).toBe("login");
    expect(out.clearHubSession).toBe(true);
    expect(out.reason).toBe("expired_session");
  });

  it("valid session without JWT → unlock (never enter)", () => {
    const out = decideAccessGateBoot({
      session,
      sessionExpired: false,
      hasJwt: false,
      roster: [],
      rosterError: null,
      matched: member,
      needsSetup: false,
    });
    expect(out.mode).toBe("unlock");
    expect(out.reason).toBe("no_jwt");
    expect(out.clearSupabaseLocal).toBe(false);
  });

  it("valid session + JWT + roster → enter", () => {
    const out = decideAccessGateBoot({
      session,
      sessionExpired: false,
      hasJwt: true,
      roster: [member],
      rosterError: null,
      matched: member,
      needsSetup: false,
    });
    expect(out.mode).toBe("enter");
    expect(out.reason).toBe("enter");
  });

  it("fetchSpecialists auth rejection → unlock, clear JWT, never enter", () => {
    const out = decideAccessGateBoot({
      session,
      sessionExpired: false,
      hasJwt: true,
      roster: null,
      rosterError: { message: "JWT expired", code: "401" },
      matched: member,
      needsSetup: false,
    });
    expect(out.mode).toBe("unlock");
    expect(out.reason).toBe("roster_auth_rejected");
    expect(out.clearSupabaseLocal).toBe(true);
    expect(out.clearHubSession).toBe(false);
  });

  it("fetchSpecialists network failure → unlock, keep JWT for retry", () => {
    const out = decideAccessGateBoot({
      session,
      sessionExpired: false,
      hasJwt: true,
      roster: null,
      rosterError: new TypeError("Failed to fetch"),
      matched: member,
      needsSetup: false,
    });
    expect(out.mode).toBe("unlock");
    expect(out.reason).toBe("roster_network_error");
    expect(out.clearSupabaseLocal).toBe(false);
  });

  it("setup required → setup (not enter)", () => {
    const out = decideAccessGateBoot({
      session,
      sessionExpired: false,
      hasJwt: true,
      roster: [member],
      rosterError: null,
      matched: { ...member, must_change_credentials: true },
      needsSetup: true,
    });
    expect(out.mode).toBe("setup");
  });
});

describe("SEC-OPS-007D error classifiers", () => {
  it("classifies auth vs network", () => {
    expect(isLikelyAuthRejection({ code: "401" })).toBe(true);
    expect(isLikelyAuthRejection({ message: "JWT expired" })).toBe(true);
    expect(isLikelyNetworkFailure(new TypeError("Failed to fetch"))).toBe(
      true
    );
    expect(isLikelyNetworkFailure({ code: "401" })).toBe(false);
  });
});
