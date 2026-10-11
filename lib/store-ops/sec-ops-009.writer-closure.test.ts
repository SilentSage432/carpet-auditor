/**
 * DEPTSYNC-SEC-OPS-009 — credential writer closure + plaintext fallback gates.
 * Synthetic credentials only. Never production PIN values.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  hashPin,
  hashPinSha256Legacy,
  isCanonicalPinHash,
  plaintextPinVerifyEnabled,
  verifyStoredPin,
} from "@/lib/auth-token";
import { AUTH_RATE_LIMIT_MAX_FAILURES } from "@/lib/store-ops/auth-rate-limit";
import {
  rosterSecurePinFields,
  updateHubCredentials,
} from "@/lib/store-ops/reset-pin";

const TEST_PIN = "6150";
const TEST_PIN_WRONG = "0000";
const TEST_PASSWORD = "secure-pass-91";
const TEST_LEGACY_PLAIN = "7391";
const UNKNOWN_BLOB = "not-a-known-credential-format!!";

function mockAdminForCredentials(opts: {
  storedPin: string;
  allowUpdate?: boolean;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const allowUpdate = opts.allowUpdate !== false;
  const admin = {
    from: (table: string) => {
      if (table !== "store_specialists") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "spec-009-1",
                store_number: "2587",
                name: "Master Admin",
                role: "MasterAdmin",
                username: "master_admin",
                pin_code: opts.storedPin,
                pin_hash: opts.storedPin,
                is_active: true,
                status: "active",
                must_change_credentials: true,
                assigned_department: "all",
              },
              error: null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          if (!allowUpdate) {
            throw new Error("update must not run");
          }
          updates.push(payload);
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: "spec-009-1",
                    store_number: "2587",
                    name: "Master Admin",
                    role: "MasterAdmin",
                    username: payload.username,
                    pin_code: payload.pin_code,
                    pin_hash: payload.pin_hash,
                    pin_updated_at: payload.pin_updated_at,
                    is_active: true,
                    status: "active",
                    must_change_credentials: false,
                    must_change_pin: false,
                    phone_number: payload.phone_number ?? null,
                    assigned_department: "all",
                  },
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    },
    _updates: updates,
  };
  return admin as unknown as ReturnType<
    typeof import("@/lib/supabase/admin").createAdminClient
  > & { _updates: Array<Record<string, unknown>> };
}

describe("SEC-OPS-009 verifyStoredPin fallback matrix", () => {
  const prevPlain = process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY;

  afterEach(() => {
    if (prevPlain === undefined) {
      delete process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY;
    } else {
      process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = prevPlain;
    }
  });

  it("scrypt1 verifies with fallback enabled", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "1";
    expect(plaintextPinVerifyEnabled()).toBe(true);
    const stored = hashPin(TEST_PIN);
    expect(isCanonicalPinHash(stored)).toBe(true);
    expect(verifyStoredPin(TEST_PIN, stored)).toBe(true);
  });

  it("scrypt1 verifies with fallback disabled", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "0";
    expect(plaintextPinVerifyEnabled()).toBe(false);
    const stored = hashPin(TEST_PIN);
    expect(verifyStoredPin(TEST_PIN, stored)).toBe(true);
    expect(verifyStoredPin(TEST_PIN_WRONG, stored)).toBe(false);
  });

  it("salted SHA-256 verifies with fallback enabled and disabled", () => {
    const legacy = hashPinSha256Legacy(
      TEST_PIN,
      "00112233445566778899aabbccddeeff"
    );

    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "1";
    expect(verifyStoredPin(TEST_PIN, legacy)).toBe(true);

    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "0";
    expect(verifyStoredPin(TEST_PIN, legacy)).toBe(true);
    expect(verifyStoredPin(TEST_PIN_WRONG, legacy)).toBe(false);
  });

  it("plaintext equality succeeds only when explicitly enabled", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "1";
    expect(verifyStoredPin(TEST_LEGACY_PLAIN, TEST_LEGACY_PLAIN)).toBe(true);
  });

  it("plaintext equality fails when disabled", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "0";
    expect(verifyStoredPin(TEST_LEGACY_PLAIN, TEST_LEGACY_PLAIN)).toBe(false);
  });

  it("empty-string credentials never verify", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "1";
    expect(verifyStoredPin(TEST_PIN, "")).toBe(false);
    expect(verifyStoredPin(TEST_PIN, null)).toBe(false);
    expect(verifyStoredPin("", "")).toBe(false);
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "0";
    expect(verifyStoredPin(TEST_PIN, "")).toBe(false);
  });

  it("unknown credential formats fail when fallback disabled", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "0";
    expect(verifyStoredPin(TEST_PIN, UNKNOWN_BLOB)).toBe(false);
    expect(verifyStoredPin(UNKNOWN_BLOB, UNKNOWN_BLOB)).toBe(false);
  });

  it("incorrect PINs fail for scrypt and SHA-256", () => {
    const scrypt = hashPin(TEST_PIN);
    const legacy = hashPinSha256Legacy(
      TEST_PIN,
      "aabbccddeeff00112233445566778899"
    );
    expect(verifyStoredPin(TEST_PIN_WRONG, scrypt)).toBe(false);
    expect(verifyStoredPin(TEST_PIN_WRONG, legacy)).toBe(false);
  });
});

describe("SEC-OPS-009 credential writers never persist plaintext", () => {
  it("rosterSecurePinFields returns scrypt only", () => {
    const fields = rosterSecurePinFields(TEST_PASSWORD);
    expect(fields.pin_code).toBe(fields.pin_hash);
    expect(fields.pin_code).not.toBe(TEST_PASSWORD);
    expect(isCanonicalPinHash(fields.pin_code)).toBe(true);
    expect(verifyStoredPin(TEST_PASSWORD, fields.pin_code)).toBe(true);
  });

  it("updateHubCredentials writes scrypt under actor authorization", async () => {
    const prior = rosterSecurePinFields("prior-secret-42");
    const admin = mockAdminForCredentials({ storedPin: prior.pin_code });
    const result = await updateHubCredentials({
      specialist_id: "spec-009-1",
      username: "custom_admin",
      password: TEST_PASSWORD,
      phone: "+15551234567",
      actor_authorized: true,
      admin,
    });

    expect(admin._updates.length).toBe(1);
    const payload = admin._updates[0]!;
    expect(isCanonicalPinHash(String(payload.pin_code))).toBe(true);
    expect(payload.pin_code).toBe(payload.pin_hash);
    expect(payload.pin_code).not.toBe(TEST_PASSWORD);
    expect(String(payload.pin_code).includes(TEST_PASSWORD)).toBe(false);
    expect(payload.username).toBe("custom_admin");
    expect(payload.must_change_credentials).toBe(false);
    expect(verifyStoredPin(TEST_PASSWORD, String(payload.pin_code))).toBe(true);
    expect(result.specialist.username).toBe("custom_admin");
  });

  it("unauthorized credential update fails without current_password", async () => {
    const prior = rosterSecurePinFields("prior-secret-42");
    const admin = mockAdminForCredentials({
      storedPin: prior.pin_code,
      allowUpdate: false,
    });
    await expect(
      updateHubCredentials({
        specialist_id: "spec-009-1",
        username: "custom_admin",
        password: TEST_PASSWORD,
        actor_authorized: false,
        current_password: TEST_PIN_WRONG,
        admin,
      })
    ).rejects.toThrow(/current pin is incorrect/i);
  });

  it("client updateSpecialistCredentials routes to update-credentials API", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../specialists.ts"),
      "utf8"
    );
    expect(source).toMatch(/\/api\/auth\/update-credentials/);
    expect(source).not.toMatch(/pin_code:\s*password/);
    expect(source).toMatch(
      /Credential changes require a live DeptSync connection/
    );
  });

  it("client specialistPayload / insert never assign pin_code", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../specialists.ts"),
      "utf8"
    );
    expect(source).toMatch(/never touch credential columns/);
    expect(source).not.toMatch(/pin_code:\s*record\.pin_code/);
    expect(source).not.toMatch(/pin_code:\s*nextLocal\.pin_code/);
  });

  it("update-credentials route requires actor or current_password", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(
        __dirname,
        "../../app/api/auth/update-credentials/route.ts"
      ),
      "utf8"
    );
    expect(source).toMatch(/resolveStoreOpsActor/);
    expect(source).toMatch(/updateHubCredentials/);
    expect(source).toMatch(/actor_authorized/);
    expect(source).toMatch(/current_password/);
    expect(source).toMatch(/401/);
  });

  it("rate-limit defaults remain intact", () => {
    expect(AUTH_RATE_LIMIT_MAX_FAILURES).toBe(8);
  });
});
