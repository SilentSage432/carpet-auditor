/**
 * DEPTSYNC-ALIGN-SEC-005 — Master recovery credential compatibility.
 * Synthetic 64-hex fixture only (openssl rand -hex 32 shape). Never production secrets.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  hashPin,
  isValidPermanentPin,
  verifyStoredPin,
} from "@/lib/auth-token";
import {
  getHubMasterPin,
  isHubMasterPin,
  requireHubMasterPin,
} from "./hub-master-pin";
import { hasQuickPin } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

/** Deterministic synthetic — shape of openssl rand -hex 32; not a production secret. */
const SYNTHETIC_64_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function stubMember(
  overrides: Partial<StoreSpecialist> = {}
): StoreSpecialist {
  return {
    id: "spec-sec005",
    name: "Master Admin",
    username: "master_admin",
    role: "MasterAdmin",
    assigned_department: "all",
    pin_code: null,
    pin_hash: null,
    store_number: "2587",
    is_active: true,
    status: "active",
    ...overrides,
  } as StoreSpecialist;
}

describe("ALIGN-SEC-005 synthetic 64-hex HUB_MASTER_PIN", () => {
  const prev = process.env.HUB_MASTER_PIN;

  afterEach(() => {
    if (prev === undefined) delete process.env.HUB_MASTER_PIN;
    else process.env.HUB_MASTER_PIN = prev;
  });

  it("fixture is exactly 64 hexadecimal characters", () => {
    expect(SYNTHETIC_64_HEX).toHaveLength(64);
    expect(SYNTHETIC_64_HEX).toMatch(/^[0-9a-f]{64}$/);
  });

  it("getHubMasterPin / requireHubMasterPin preserve full length (no truncation)", () => {
    process.env.HUB_MASTER_PIN = SYNTHETIC_64_HEX;
    const got = getHubMasterPin();
    expect(got).toBe(SYNTHETIC_64_HEX);
    expect(got).toHaveLength(64);
    expect(requireHubMasterPin()).toBe(SYNTHETIC_64_HEX);
    expect(requireHubMasterPin()).toHaveLength(64);
  });

  it("isHubMasterPin matches full 64-hex and rejects truncated / wrong values", () => {
    process.env.HUB_MASTER_PIN = SYNTHETIC_64_HEX;
    expect(isHubMasterPin(SYNTHETIC_64_HEX)).toBe(true);
    expect(isHubMasterPin(`  ${SYNTHETIC_64_HEX}  `)).toBe(true);
    expect(isHubMasterPin(SYNTHETIC_64_HEX.slice(0, 32))).toBe(false);
    expect(isHubMasterPin(SYNTHETIC_64_HEX.slice(0, 4))).toBe(false);
    expect(isHubMasterPin("1234")).toBe(false);
    expect(isHubMasterPin("")).toBe(false);
  });

  it("does not apply four-digit-only validation to Master env credential", () => {
    process.env.HUB_MASTER_PIN = SYNTHETIC_64_HEX;
    expect(isValidPermanentPin(SYNTHETIC_64_HEX)).toBe(false);
    // Master path must still accept via isHubMasterPin (not isValidPermanentPin).
    expect(isHubMasterPin(SYNTHETIC_64_HEX)).toBe(true);
  });

  it("hashPin / verifyStoredPin round-trip a 64-hex secret (no length reject)", () => {
    const stored = hashPin(SYNTHETIC_64_HEX, "aabbccddeeff00112233445566778899");
    expect(stored).toMatch(/^[0-9a-f]+\.[0-9a-f]{64}$/i);
    expect(verifyStoredPin(SYNTHETIC_64_HEX, stored)).toBe(true);
    expect(verifyStoredPin(SYNTHETIC_64_HEX.slice(0, 8), stored)).toBe(false);
  });

  it("verifyStoredPin accepts plaintext 64-hex (bootstrap pin_code shape)", () => {
    expect(verifyStoredPin(SYNTHETIC_64_HEX, SYNTHETIC_64_HEX)).toBe(true);
    expect(verifyStoredPin(SYNTHETIC_64_HEX.slice(0, 63), SYNTHETIC_64_HEX)).toBe(
      false
    );
  });

  it("ordinary 4-digit permanent PIN validation remains functional", () => {
    expect(isValidPermanentPin("1234")).toBe(true);
    expect(isValidPermanentPin("987654")).toBe(true);
    expect(isValidPermanentPin("12")).toBe(false);
    expect(isValidPermanentPin(SYNTHETIC_64_HEX)).toBe(false);
  });
});

describe("ALIGN-SEC-005 client unlock mode vs recovery credential", () => {
  it("hasQuickPin is false when pin_code stripped and username present (password field)", () => {
    expect(hasQuickPin(stubMember({ pin_code: null, username: "master_admin" }))).toBe(
      false
    );
  });

  it("hasQuickPin is false for 64-hex pin_code (password field, not digit keypad)", () => {
    expect(
      hasQuickPin(stubMember({ pin_code: SYNTHETIC_64_HEX }))
    ).toBe(false);
  });

  it("hasQuickPin remains true only for exactly four decimal digits", () => {
    expect(hasQuickPin(stubMember({ pin_code: "4821", username: null }))).toBe(
      true
    );
    expect(hasQuickPin(stubMember({ pin_code: "48215", username: null }))).toBe(
      false
    );
  });
});

describe("ALIGN-SEC-005 source contracts (no silent truncation / digit-only gate)", () => {
  it("hub-master-pin module has no length cap or digit-only regex", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "hub-master-pin.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/slice\s*\(\s*0\s*,/);
    // Blank-check `length > 0` is allowed; reject max-length / digit caps.
    expect(source).not.toMatch(/length\s*[<>=]+\s*[1-9]\d*/);
    expect(source).toMatch(/fromEnv\.length > 0/);
    expect(source).not.toMatch(/\\d\{4\}/);
    expect(source).toMatch(/\.trim\(\)/);
  });

  it("hub-bridge Master fallback uses isHubMasterPin without PIN length gate", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "hub-bridge.ts"),
      "utf8"
    );
    expect(source).toMatch(/isHubMasterPin\(pin\)/);
    expect(source).not.toMatch(/isValidPermanentPin/);
    expect(source).not.toMatch(/PIN must be exactly 4/);
    expect(source).not.toMatch(/pin\.length\s*[><=]/);
  });

  it("bootstrap-admin hashes Master PIN into pin_code/pin_hash without slicing", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "bootstrap-admin.ts"),
      "utf8"
    );
    expect(source).toMatch(/masterBootstrapPinFields/);
    expect(source).toMatch(/hashPin/);
    expect(source).toMatch(/requireHubMasterPin\(\)/);
    expect(source).not.toMatch(/pin_code:\s*pin\b/);
    expect(source).not.toMatch(/pin_code:\s*pin\.slice/);
    expect(source).not.toMatch(/isValidPermanentPin/);
  });

  it("local bootstrap script hashes masterPin into pin_code/pin_hash", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../scripts/bootstrap-admin.mjs"),
      "utf8"
    );
    expect(source).toMatch(/pin_code:\s*pinHash/);
    expect(source).toMatch(/pin_hash:\s*pinHash/);
    expect(source).not.toMatch(/pin_code:\s*masterPin\b/);
    expect(source).not.toMatch(/masterPin\.slice/);
    expect(source).toMatch(/HUB_MASTER_PIN\?\.trim\(\)/);
  });

  it("AuthWall login password field has no maxLength (recovery paste path)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../components/auth/AuthWall.tsx"),
      "utf8"
    );
    const loginBlock = source.slice(
      source.indexOf('id="deptsync-password"'),
      source.indexOf('id="deptsync-password"') + 350
    );
    expect(loginBlock).toMatch(/type="password"/);
    expect(loginBlock).not.toMatch(/maxLength/);
    const unlockBlock = source.slice(
      source.indexOf('id="deptsync-unlock-password"'),
      source.indexOf('id="deptsync-unlock-password"') + 350
    );
    expect(unlockBlock).toMatch(/type="password"/);
    expect(unlockBlock).not.toMatch(/maxLength/);
  });

  it("schema pin_code / pin_hash are unconstrained text", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const schema = await fs.readFile(
      path.resolve(__dirname, "../../supabase/schema.sql"),
      "utf8"
    );
    expect(schema).toMatch(/pin_code text/);
    expect(schema).toMatch(/pin_hash text/);
    expect(schema).not.toMatch(/pin_code varchar\(\d+\)/);
    expect(schema).not.toMatch(/pin_hash varchar\(\d+\)/);
  });
});
