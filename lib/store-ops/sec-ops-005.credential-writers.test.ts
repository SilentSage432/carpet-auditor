/**
 * DEPTSYNC-SEC-OPS-005 — credential writers never persist plaintext PINs.
 * Synthetic credentials only.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/onboarding/claim-roster-auth", () => ({
  claimRosterMemberForAuthUser: vi.fn(async () => undefined),
}));

import {
  isCanonicalPinHash,
  verifyStoredPin,
} from "@/lib/auth-token";
import { linkAuthUserToSpecialistProfile } from "@/lib/store-ops/link-auth-profile";
import { rosterSecurePinFields } from "@/lib/store-ops/reset-pin";
import type { StoreSpecialist } from "@/lib/types";

const TEST_PIN = "6150";
const TEST_PIN_OTHER = "4821";

function stubSpecialist(
  overrides: Partial<StoreSpecialist> = {}
): StoreSpecialist {
  return {
    id: "spec-secops005-1",
    store_number: "2587",
    name: "Master Admin",
    role: "MasterAdmin",
    pin_code: null,
    pin_hash: null,
    username: "master_admin",
    assigned_department: "all",
    must_change_credentials: false,
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("SEC-OPS-005 rosterSecurePinFields", () => {
  it("never returns plaintext and verifies as canonical scrypt", () => {
    const fields = rosterSecurePinFields(TEST_PIN);
    expect(fields.pin_code).toBe(fields.pin_hash);
    expect(fields.pin_code).not.toBe(TEST_PIN);
    expect(isCanonicalPinHash(fields.pin_code)).toBe(true);
    expect(verifyStoredPin(TEST_PIN, fields.pin_code)).toBe(true);
    expect(verifyStoredPin(TEST_PIN_OTHER, fields.pin_code)).toBe(false);
    expect(/^\d{4,8}$/.test(fields.pin_code)).toBe(false);
  });
});

describe("SEC-OPS-005 linkAuthUserToSpecialistProfile", () => {
  it("does not copy roster PIN material into profiles payload", async () => {
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
      authUserId: "auth-user-1",
      email: "hub.user@deptsync.hub",
      specialist: stubSpecialist({
        pin_code: TEST_PIN,
        pin_hash: TEST_PIN,
      }),
    });

    expect(upserts.length).toBeGreaterThan(0);
    const payload = upserts[0]!;
    expect(payload.pin_code).toBeNull();
    // SEC-OPS-007B: NOT NULL profiles.pin clears as "" (never null / never plaintext).
    expect(payload.pin).toBe("");
    expect(payload.pin_hash).toBeNull();
    expect(payload.specialist_id).toBe("spec-secops005-1");
    expect(payload.store_number).toBe("2587");
    expect(payload.role).toBe("super_admin");
    const serialized = JSON.stringify(payload);
    expect(serialized.includes(TEST_PIN)).toBe(false);
  });
});

describe("SEC-OPS-005 source contracts — no plaintext writers", () => {
  it("reset-pin clears mirror PIN fields and hashes roster writes", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "reset-pin.ts"),
      "utf8"
    );
    expect(source).toMatch(/rosterSecurePinFields/);
    expect(source).toMatch(/pin:\s*""/);
    expect(source).toMatch(/pin_code:\s*null/);
    expect(source).not.toMatch(/pin:\s*null/);
    expect(source).not.toMatch(/pin_code:\s*newPin\b/);
    expect(source).not.toMatch(/pin_code:\s*pin\b/);
    expect(source).toMatch(/\.eq\("store_number", store\)/);
  });

  it("phone-reset confirm uses rosterSecurePinFields", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../app/api/auth/phone-reset/confirm/route.ts"),
      "utf8"
    );
    expect(source).toMatch(/rosterSecurePinFields/);
    expect(source).not.toMatch(/pin_code:\s*newPassword/);
    expect(source).toMatch(/Bearer/);
  });

  it("hub-bridge still verifies store_specialists via verifyStoredPin", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "hub-bridge.ts"),
      "utf8"
    );
    expect(source).toMatch(/verifyStoredPin/);
    expect(source).toMatch(/pin_hash/);
    expect(source).toMatch(/status === "invited"/);
  });

  it("link-auth-profile never assigns specialist.pin_code into profiles", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "link-auth-profile.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/pin_code:\s*input\.specialist\.pin_code/);
    expect(source).toMatch(/pin_code:\s*null/);
    expect(source).toMatch(/pin:\s*""/);
    expect(source).not.toMatch(/pin:\s*null/);
  });
});
