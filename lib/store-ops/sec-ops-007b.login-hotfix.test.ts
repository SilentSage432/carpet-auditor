/**
 * DEPTSYNC-SEC-OPS-007B — emergency login hotfix: NOT NULL pin clears as "".
 * Synthetic credentials only.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/onboarding/claim-roster-auth", () => ({
  claimRosterMemberForAuthUser: vi.fn(async () => undefined),
}));

import {
  hashPin,
  verifyStoredPin,
} from "@/lib/auth-token";
import { linkAuthUserToSpecialistProfile } from "@/lib/store-ops/link-auth-profile";
import type { StoreSpecialist } from "@/lib/types";

const TEST_PIN = "6150";

function stubSpecialist(
  overrides: Partial<StoreSpecialist> = {}
): StoreSpecialist {
  const hashed = hashPin(TEST_PIN);
  return {
    id: "f9e36630-9793-40cd-9d3c-53b5ee450b1c",
    store_number: "2587",
    name: "Master Admin",
    role: "MasterAdmin",
    pin_code: hashed,
    pin_hash: hashed,
    username: "master_admin",
    assigned_department: "all",
    must_change_credentials: false,
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("SEC-OPS-007B empty-string cannot authenticate", () => {
  it("verifyStoredPin rejects empty stored credentials", () => {
    expect(verifyStoredPin(TEST_PIN, "")).toBe(false);
    expect(verifyStoredPin(TEST_PIN, null)).toBe(false);
    expect(verifyStoredPin(TEST_PIN, undefined)).toBe(false);
    expect(verifyStoredPin("", "")).toBe(false);
    expect(verifyStoredPin("", "scrypt1$n=1$r=1$p=1$x$y")).toBe(false);
  });

  it("canonical scrypt still verifies; empty mirror is not a credential", () => {
    const stored = hashPin(TEST_PIN);
    expect(verifyStoredPin(TEST_PIN, stored)).toBe(true);
    expect(verifyStoredPin(TEST_PIN, "")).toBe(false);
    // Plaintext fallback equality cannot succeed against empty stored.
    expect(verifyStoredPin("", "")).toBe(false);
  });
});

describe("SEC-OPS-007B profile linking respects NOT NULL", () => {
  it("linkAuthUserToSpecialistProfile writes pin: \"\" and nullable nulls", async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const admin = {
      from: (table: string) => {
        if (table === "stores" || table === "departments") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            upsert: async (payload: Record<string, unknown>) => {
              upserts.push(payload);
              if (payload.pin === null) {
                return {
                  error: {
                    message:
                      'null value in column "pin" of relation "profiles" violates not-null constraint',
                    code: "23502",
                  },
                };
              }
              return { error: null };
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      },
      auth: {
        admin: {
          updateUserById: async () => ({ error: null }),
        },
      },
    };

    await expect(
      linkAuthUserToSpecialistProfile(admin as never, {
        authUserId: "0f3b20ce-85bf-4d1b-8103-4b81648d396d",
        email: "hub@deptsync.hub",
        specialist: stubSpecialist(),
      })
    ).resolves.toBeUndefined();

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.pin).toBe("");
    expect(upserts[0]?.pin_code).toBeNull();
    expect(upserts[0]?.pin_hash).toBeNull();
    expect(JSON.stringify(upserts[0])).not.toContain(TEST_PIN);
  });

  it("source writers never assign pin: null", async () => {
    const link = await readFile(
      path.resolve(__dirname, "link-auth-profile.ts"),
      "utf8"
    );
    const reset = await readFile(
      path.resolve(__dirname, "reset-pin.ts"),
      "utf8"
    );
    expect(link).toMatch(/pin:\s*""/);
    expect(link).not.toMatch(/pin:\s*null/);
    expect(reset).toMatch(/pin:\s*""/);
    expect(reset).not.toMatch(/pin:\s*null/);
    expect(reset).toMatch(/pin_code:\s*null/);
  });
});
