/**
 * DEPTSYNC-AUTH-HARDEN-001 — PIN hashing, login-time upgrade, rate limiting.
 * Test credentials only. Never production PIN values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyPinCredential,
  hashPin,
  hashPinScrypt,
  hashPinSha256Legacy,
  isCanonicalPinHash,
  isSaltedPinHash,
  isScryptPinHash,
  needsPinCredentialUpgrade,
  plaintextPinVerifyEnabled,
  verifyStoredPin,
} from "@/lib/auth-token";
import {
  AUTH_RATE_LIMIT_MAX_FAILURES,
  buildAuthRateLimitBucket,
  extractClientIp,
  touchAuthRateLimit,
} from "@/lib/store-ops/auth-rate-limit";
import { persistPinCredentialUpgrade } from "@/lib/store-ops/pin-credential-upgrade";

const TEST_PIN = "4821";
const TEST_PIN_WRONG = "0000";
const TEST_LEGACY_PLAIN = "7391";
const TEST_SCRYPT_PIN = "6150";

describe("AUTH-HARDEN-001 PIN credential formats", () => {
  const prevPlain = process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY;

  afterEach(() => {
    if (prevPlain === undefined) {
      delete process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY;
    } else {
      process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = prevPlain;
    }
  });

  it("successful current-format (scrypt) authentication", () => {
    const stored = hashPinScrypt(TEST_SCRYPT_PIN);
    expect(isScryptPinHash(stored)).toBe(true);
    expect(isCanonicalPinHash(stored)).toBe(true);
    expect(verifyStoredPin(TEST_SCRYPT_PIN, stored)).toBe(true);
    expect(verifyStoredPin(TEST_PIN_WRONG, stored)).toBe(false);
    expect(needsPinCredentialUpgrade(stored)).toBe(false);
  });

  it("hashPin writes canonical scrypt", () => {
    const stored = hashPin(TEST_PIN);
    expect(stored.startsWith("scrypt1$")).toBe(true);
    expect(isSaltedPinHash(stored)).toBe(false);
    expect(verifyStoredPin(TEST_PIN, stored)).toBe(true);
  });

  it("successful legacy salted SHA-256 authentication", () => {
    const legacy = hashPinSha256Legacy(
      TEST_PIN,
      "00112233445566778899aabbccddeeff"
    );
    expect(isSaltedPinHash(legacy)).toBe(true);
    expect(classifyPinCredential(legacy)).toBe("sha256_salted");
    expect(verifyStoredPin(TEST_PIN, legacy)).toBe(true);
    expect(needsPinCredentialUpgrade(legacy)).toBe(true);
  });

  it("successful legacy plaintext authentication while allowlist enabled", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "1";
    expect(plaintextPinVerifyEnabled()).toBe(true);
    expect(verifyStoredPin(TEST_LEGACY_PLAIN, TEST_LEGACY_PLAIN)).toBe(true);
    expect(verifyStoredPin(TEST_PIN_WRONG, TEST_LEGACY_PLAIN)).toBe(false);
    expect(needsPinCredentialUpgrade(TEST_LEGACY_PLAIN)).toBe(true);
  });

  it("plaintext fallback rejects when retirement flag disables it", () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "0";
    expect(plaintextPinVerifyEnabled()).toBe(false);
    expect(verifyStoredPin(TEST_LEGACY_PLAIN, TEST_LEGACY_PLAIN)).toBe(false);
    expect(needsPinCredentialUpgrade(TEST_LEGACY_PLAIN)).toBe(false);
  });

  it("incorrect PIN rejection for all formats", () => {
    const scrypt = hashPin(TEST_PIN);
    const legacy = hashPinSha256Legacy(TEST_PIN, "aabbccddeeff00112233445566778899");
    expect(verifyStoredPin(TEST_PIN_WRONG, scrypt)).toBe(false);
    expect(verifyStoredPin(TEST_PIN_WRONG, legacy)).toBe(false);
    expect(verifyStoredPin(TEST_PIN_WRONG, TEST_PIN)).toBe(false);
  });
});

function mockAdminForUpgrade(opts: {
  /** Which conditional column match succeeds (none ⇒ conflict). */
  matchOn?: "pin_code" | "pin_hash" | "none";
  error?: { message: string; code?: string } | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const matchOn = opts.matchOn ?? "pin_code";

  const admin = {
    from: () => {
      let filterCol: string | null = null;
      const chain = {
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return chain;
        },
        eq: (col: string, _val: unknown) => {
          if (col === "pin_code" || col === "pin_hash") filterCol = col;
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => {
          if (opts.error) {
            return { data: null, error: opts.error };
          }
          if (matchOn !== "none" && filterCol === matchOn) {
            return { data: { id: "spec-test-1" }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
    _updates: updates,
  };
  return admin as unknown as ReturnType<
    typeof import("@/lib/supabase/admin").createAdminClient
  > & { _updates: Array<Record<string, unknown>> };
}

describe("AUTH-HARDEN-001 atomic login-time upgrade", () => {
  it("upgrades legacy SHA-256 to scrypt on successful conditional update", async () => {
    const previous = hashPinSha256Legacy(
      TEST_PIN,
      "11223344556677889900aabbccddeeff"
    );
    const admin = mockAdminForUpgrade({ matchOn: "pin_code" });
    const result = await persistPinCredentialUpgrade({
      specialistId: "spec-test-1",
      pin: TEST_PIN,
      previousStored: previous,
      admin,
    });
    expect(result.status).toBe("upgraded");
    const payload = (admin as { _updates: Array<Record<string, unknown>> })
      ._updates[0]!;
    expect(isScryptPinHash(String(payload.pin_code))).toBe(true);
    expect(payload.pin_code).toBe(payload.pin_hash);
    expect(verifyStoredPin(TEST_PIN, String(payload.pin_code))).toBe(true);
  });

  it("upgrades plaintext legacy to scrypt", async () => {
    process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY = "1";
    const admin = mockAdminForUpgrade({ matchOn: "pin_code" });
    const result = await persistPinCredentialUpgrade({
      specialistId: "spec-test-1",
      pin: TEST_LEGACY_PLAIN,
      previousStored: TEST_LEGACY_PLAIN,
      admin,
    });
    expect(result.status).toBe("upgraded");
  });

  it("skips when already canonical", async () => {
    const stored = hashPin(TEST_PIN);
    const result = await persistPinCredentialUpgrade({
      specialistId: "spec-test-1",
      pin: TEST_PIN,
      previousStored: stored,
      admin: mockAdminForUpgrade({ matchOn: "pin_code" }),
    });
    expect(result).toEqual({ status: "skipped", reason: "already_canonical" });
  });

  it("concurrent upgrade attempts: second sees conflict when credential changed", async () => {
    const previous = hashPinSha256Legacy(
      TEST_PIN,
      "99887766554433221100ffeeddccbbaa"
    );
    const admin = mockAdminForUpgrade({ matchOn: "none" });
    const result = await persistPinCredentialUpgrade({
      specialistId: "spec-test-1",
      pin: TEST_PIN,
      previousStored: previous,
      admin,
    });
    expect(result.status).toBe("conflict");
    expect(result).toMatchObject({ reason: "credential_changed" });
  });

  it("does not claim success when persistence fails", async () => {
    const previous = hashPinSha256Legacy(
      TEST_PIN,
      "aabbccddeeff00112233445566778899"
    );
    const result = await persistPinCredentialUpgrade({
      specialistId: "spec-test-1",
      pin: TEST_PIN,
      previousStored: previous,
      admin: mockAdminForUpgrade({
        matchOn: "pin_code",
        error: { message: "db down", code: "57014" },
      }),
    });
    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ reason: "persist_error" });
  });
});

describe("AUTH-HARDEN-001A rate limiting (fail-closed)", () => {
  it("builds opaque IP bucket — ignores client store_number (bypass resistance)", () => {
    const a = buildAuthRateLimitBucket({
      storeId: "1234",
      clientIp: "203.0.113.9",
    });
    const b = buildAuthRateLimitBucket({
      storeId: "9999",
      clientIp: "203.0.113.9",
    });
    expect(a).toBe(b);
    expect(a.startsWith("hb:")).toBe(true);
    expect(a.includes("1234")).toBe(false);
    expect(a.includes("203.0.113.9")).toBe(false);
    expect(a.includes(TEST_PIN)).toBe(false);
  });

  it("extractClientIp prefers x-real-ip over spoofable XFF left hops", () => {
    const req = new Request("https://example.test/api/auth/hub-bridge", {
      headers: {
        "x-forwarded-for": "198.51.100.4, 10.0.0.1",
        "x-real-ip": "203.0.113.50",
      },
    });
    expect(extractClientIp(req)).toBe("203.0.113.50");
  });

  it("extractClientIp uses rightmost XFF hop when platform IP headers absent", () => {
    const req = new Request("https://example.test/api/auth/hub-bridge", {
      headers: {
        "x-forwarded-for": "198.51.100.4, 10.0.0.1",
      },
    });
    expect(extractClientIp(req)).toBe("10.0.0.1");
  });

  it("enforces limit exhaustion when RPC reports limited", async () => {
    const admin = {
      rpc: vi.fn(async () => ({
        data: {
          allowed: false,
          failure_count: AUTH_RATE_LIMIT_MAX_FAILURES + 1,
          retry_after_ms: 60_000,
          reason: "limited",
        },
        error: null,
      })),
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;

    const decision = await touchAuthRateLimit({
      bucketKey: "hb:test",
      mode: "attempt",
      admin,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.failClosed).toBe(false);
    expect(decision.retryAfterMs).toBe(60_000);
  });

  it("malformed RPC payload fails closed (not allowed)", async () => {
    const admin = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;
    const decision = await touchAuthRateLimit({
      bucketKey: "hb:empty",
      mode: "attempt",
      admin,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.failClosed).toBe(true);
    expect(decision.reason).toBe("fail_closed_empty_payload");
  });

  it("concurrent failed attempts: at most maxFailures allowed", async () => {
    let count = 0;
    const max = 8;
    const admin = {
      rpc: vi.fn(async (_name: string, args: { p_mode: string }) => {
        expect(["attempt", "fail"]).toContain(args.p_mode);
        // Simulate DB serialization: each attempt increments under lock.
        count += 1;
        const allowed = count <= max;
        return {
          data: {
            allowed,
            failure_count: count,
            retry_after_ms: allowed ? 0 : 12_000,
            reason: allowed ? "counted" : "limited",
          },
          error: null,
        };
      }),
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        touchAuthRateLimit({
          bucketKey: "hb:concurrency",
          mode: "attempt",
          maxFailures: max,
          admin,
        })
      )
    );
    expect(results.filter((r) => r.allowed).length).toBe(max);
    expect(results.filter((r) => !r.allowed).length).toBe(20 - max);
    expect(admin.rpc).toHaveBeenCalledTimes(20);
  });

  it("fail-closed when limiter infrastructure unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "function touch_auth_rate_limit does not exist" },
      })),
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;

    const decision = await touchAuthRateLimit({
      bucketKey: "hb:missing",
      mode: "attempt",
      admin,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.failClosed).toBe(true);
    expect(decision.reason).toBe("fail_closed_rpc_error");
    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged.includes(TEST_PIN)).toBe(false);
    expect(logged.toLowerCase().includes("password")).toBe(false);
    warn.mockRestore();
  });

  it("fail-closed on RPC exception", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = {
      rpc: vi.fn(async () => {
        throw new Error("network down");
      }),
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;
    const decision = await touchAuthRateLimit({
      bucketKey: "hb:exc",
      mode: "attempt",
      admin,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.failClosed).toBe(true);
    expect(decision.reason).toBe("fail_closed_exception");
    warn.mockRestore();
  });

  it("recovery clears only the caller bucket on success mode", async () => {
    const admin = {
      rpc: vi.fn(async () => ({
        data: {
          allowed: true,
          failure_count: 0,
          retry_after_ms: 0,
          reason: "cleared",
        },
        error: null,
      })),
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;
    const decision = await touchAuthRateLimit({
      bucketKey: "hb:ok",
      mode: "success",
      admin,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.failureCount).toBe(0);
    expect(admin.rpc).toHaveBeenCalledWith(
      "touch_auth_rate_limit",
      expect.objectContaining({
        p_mode: "success",
        p_bucket_key: "hb:ok",
      })
    );
  });

  it("successful operator admit path returns allowed for counted attempt", async () => {
    const admin = {
      rpc: vi.fn(async () => ({
        data: {
          allowed: true,
          failure_count: 1,
          retry_after_ms: 0,
          reason: "counted",
        },
        error: null,
      })),
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;
    const admit = await touchAuthRateLimit({
      bucketKey: "hb:operator",
      mode: "attempt",
      admin,
    });
    expect(admit.allowed).toBe(true);
    expect(admit.failClosed).toBe(false);
    const clear = await touchAuthRateLimit({
      bucketKey: "hb:operator",
      mode: "success",
      admin,
    });
    // second call uses same mock — still allowed true
    expect(clear.allowed).toBe(true);
  });
});

describe("AUTH-HARDEN-001 invited associate + route contracts", () => {
  it("hub-bridge still rejects invited before PIN verify (source contract)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "hub-bridge.ts"),
      "utf8"
    );
    expect(source).toMatch(/status === "invited"/);
    expect(source).toMatch(/Finish setup from your invite link/);
    expect(source).toMatch(/persistPinCredentialUpgrade|maybeUpgradePinCredential/);
  });

  it("hub-bridge route admits atomically, fails closed, never logs PIN", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../app/api/auth/hub-bridge/route.ts"),
      "utf8"
    );
    expect(source).toMatch(/mode: "attempt"/);
    expect(source).toMatch(/mode: "success"/);
    expect(source).toMatch(/bootstrap-admin/);
    expect(source).not.toMatch(/fail-open|failOpen:\s*true/i);
    expect(source).toMatch(/Invalid username or PIN/);
    expect(source).not.toMatch(/console\.(log|info|warn|error)\([^)]*\bpin\b/i);
    expect(source).not.toMatch(/JSON\.stringify\([^)]*pin/i);
  });

  it("rate-limit module defaults enforce 8 / 15-minute policy", async () => {
    const {
      AUTH_RATE_LIMIT_MAX_FAILURES,
      AUTH_RATE_LIMIT_WINDOW_MS,
      authRateLimitMaxFailures,
      authRateLimitWindowMs,
    } = await import("@/lib/store-ops/auth-rate-limit");
    expect(AUTH_RATE_LIMIT_MAX_FAILURES).toBe(8);
    expect(AUTH_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(authRateLimitMaxFailures()).toBe(8);
    expect(authRateLimitWindowMs()).toBe(15 * 60 * 1000);
  });

  it("bootstrap-admin remains secret-gated recovery (not public hub-bridge bypass)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../app/api/auth/bootstrap-admin/route.ts"),
      "utf8"
    );
    expect(source).toMatch(/BOOTSTRAP_SECRET/);
    expect(source).not.toMatch(/touchAuthRateLimit/);
  });

  it("invited-associate clear SQL is targeted and rolled back by default", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const sql = await fs.readFile(
      path.resolve(
        __dirname,
        "../../scripts/sql/auth-harden-001-clear-invited-associate-pins.sql"
      ),
      "utf8"
    );
    expect(sql).toMatch(/6f79f577%/);
    expect(sql).toMatch(/2d65fa60%/);
    expect(sql).toMatch(/status.*invited/);
    expect(sql).toMatch(/pin_code = null/);
    expect(sql).toMatch(/rollback;/i);
    expect(sql).not.toMatch(/^\s*commit;/im);
  });

  it("rate-limit migration is service-role only with atomic attempt mode", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const sql = await fs.readFile(
      path.resolve(
        __dirname,
        "../../supabase/migrations/20261013_auth_harden_001_rate_limits.sql"
      ),
      "utf8"
    );
    expect(sql).toMatch(/auth_rate_limits/);
    expect(sql).toMatch(/touch_auth_rate_limit/);
    expect(sql).toMatch(/v_mode = 'attempt'|p_mode.*attempt/);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/revoke all on table public\.auth_rate_limits from anon/);
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/);
  });
});

describe("AUTH-HARDEN-001 no credential exposure in logs", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upgrade failure warn omits PIN material", async () => {
    const previous = hashPinSha256Legacy(
      TEST_PIN,
      "00112233445566778899aabbccddeeff"
    );
    await persistPinCredentialUpgrade({
      specialistId: "spec-log-1",
      pin: TEST_PIN,
      previousStored: previous,
      admin: mockAdminForUpgrade({
        matchOn: "pin_code",
        error: { message: "boom" },
      }),
    });
    // persistPinCredentialUpgrade does not log; assert no accidental PIN in mocks.
    const calls = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(calls.includes(TEST_PIN)).toBe(false);
  });
});
