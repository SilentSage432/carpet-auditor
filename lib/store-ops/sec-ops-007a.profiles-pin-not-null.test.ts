/**
 * DEPTSYNC-SEC-OPS-007A/B — profiles.pin NOT NULL contract.
 * After 007B hotfix: writers must clear with "" (never null).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/onboarding/claim-roster-auth", () => ({
  claimRosterMemberForAuthUser: vi.fn(async () => undefined),
}));

import { linkAuthUserToSpecialistProfile } from "@/lib/store-ops/link-auth-profile";
import type { StoreSpecialist } from "@/lib/types";

function stubSpecialist(
  overrides: Partial<StoreSpecialist> = {}
): StoreSpecialist {
  return {
    id: "f9e36630-9793-40cd-9d3c-53b5ee450b1c",
    store_number: "2587",
    name: "Master Admin",
    role: "MasterAdmin",
    pin_code: "scrypt1$n=16384$r=8$p=1$synthetic",
    pin_hash: "scrypt1$n=16384$r=8$p=1$synthetic",
    username: "master_admin",
    assigned_department: "all",
    must_change_credentials: false,
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("SEC-OPS-007A/B profiles.pin NOT NULL contract", () => {
  it("linkAuthUserToSpecialistProfile clears pin with empty string (not null)", async () => {
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

    await linkAuthUserToSpecialistProfile(admin as never, {
      authUserId: "0f3b20ce-85bf-4d1b-8103-4b81648d396d",
      email: "hub@deptsync.hub",
      specialist: stubSpecialist(),
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.pin).toBe("");
    expect(upserts[0]?.pin).not.toBeNull();
  });

  it("source contracts: hub-bridge links profiles; writers use pin: \"\"", async () => {
    const hub = await readFile(
      path.resolve(__dirname, "hub-bridge.ts"),
      "utf8"
    );
    const link = await readFile(
      path.resolve(__dirname, "link-auth-profile.ts"),
      "utf8"
    );
    const reset = await readFile(
      path.resolve(__dirname, "reset-pin.ts"),
      "utf8"
    );

    expect(hub).toMatch(/mintSessionForSpecialist/);
    expect(hub).toMatch(/linkAuthUserToSpecialistProfile/);
    expect(link).toMatch(/pin:\s*""/);
    expect(link).not.toMatch(/pin:\s*null/);
    expect(reset).toMatch(/pin:\s*""/);
    expect(reset).not.toMatch(/pin:\s*null/);
  });
});
