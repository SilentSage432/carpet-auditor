/**
 * DEPTSYNC-SEC-OPS-007G — hub page JWT-first bootstrap decisions.
 */
import { describe, expect, it } from "vitest";
import {
  canFetchProtectedRoster,
  decideHubPageBoot,
} from "@/lib/auth/hub-page-bootstrap";
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

describe("SEC-OPS-007G canFetchProtectedRoster", () => {
  it("allows network roster only with Supabase JWT", () => {
    expect(canFetchProtectedRoster(false)).toBe(false);
    expect(canFetchProtectedRoster(true)).toBe(true);
  });
});

describe("SEC-OPS-007G decideHubPageBoot", () => {
  it("hub session without JWT → unlock (no enter, no anon fetch implied)", () => {
    const out = decideHubPageBoot({
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
  });

  it("42501 / anon denial → unlock + clear local JWT", () => {
    const out = decideHubPageBoot({
      session,
      sessionExpired: false,
      hasJwt: true,
      roster: null,
      rosterError: {
        code: "42501",
        message: "permission denied for table store_specialists",
      },
      matched: member,
      needsSetup: false,
    });
    expect(out.mode).toBe("unlock");
    expect(out.reason).toBe("roster_auth_rejected");
    expect(out.clearSupabaseLocal).toBe(true);
  });

  it("network failure → unlock, keep JWT", () => {
    const out = decideHubPageBoot({
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

  it("valid JWT + roster → enter", () => {
    const out = decideHubPageBoot({
      session,
      sessionExpired: false,
      hasJwt: true,
      roster: [member],
      rosterError: null,
      matched: member,
      needsSetup: false,
    });
    expect(out.mode).toBe("enter");
  });

  it("missing hub session → login", () => {
    const out = decideHubPageBoot({
      session: null,
      sessionExpired: false,
      hasJwt: false,
      roster: null,
      rosterError: null,
      matched: null,
      needsSetup: false,
    });
    expect(out.mode).toBe("login");
  });
});
