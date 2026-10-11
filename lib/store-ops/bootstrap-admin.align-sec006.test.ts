/**
 * DEPTSYNC-ALIGN-SEC-006 — Recovery credential protection.
 * Synthetic 64-hex fixtures only. Never production secrets.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  hashPin,
  isSaltedPinHash,
  isValidPermanentPin,
  verifyStoredPin,
} from "@/lib/auth-token";
import {
  getHubMasterPin,
  isHubMasterPin,
  masterBootstrapPinFields,
  requireHubMasterPin,
} from "./bootstrap-admin";

/** Deterministic synthetic — openssl rand -hex 32 shape; not a production secret. */
const SYNTHETIC_64_HEX =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const ORDINARY_DB_PIN = "4821";

describe("ALIGN-SEC-006 masterBootstrapPinFields (hashed storage)", () => {
  it("stores salted hash in both pin_code and pin_hash — never plaintext", () => {
    const fields = masterBootstrapPinFields(SYNTHETIC_64_HEX);
    expect(fields.pin_code).toBe(fields.pin_hash);
    expect(isSaltedPinHash(fields.pin_hash)).toBe(true);
    expect(fields.pin_code).not.toBe(SYNTHETIC_64_HEX);
    expect(fields.pin_code.includes(SYNTHETIC_64_HEX)).toBe(false);
  });

  it("verifyStoredPin accepts the synthetic Master credential against stored hash", () => {
    const { pin_hash } = masterBootstrapPinFields(SYNTHETIC_64_HEX);
    expect(verifyStoredPin(SYNTHETIC_64_HEX, pin_hash)).toBe(true);
    expect(verifyStoredPin(SYNTHETIC_64_HEX.slice(0, 8), pin_hash)).toBe(false);
    expect(verifyStoredPin("wrong", pin_hash)).toBe(false);
  });

  it("preserves historical plaintext pin_code verify path", () => {
    expect(verifyStoredPin(SYNTHETIC_64_HEX, SYNTHETIC_64_HEX)).toBe(true);
    expect(verifyStoredPin(ORDINARY_DB_PIN, ORDINARY_DB_PIN)).toBe(true);
  });

  it("ordinary DB-backed 4-digit PIN hashing remains functional", () => {
    const stored = hashPin(ORDINARY_DB_PIN, "00112233445566778899aabbccddeeff");
    expect(verifyStoredPin(ORDINARY_DB_PIN, stored)).toBe(true);
    expect(isValidPermanentPin(ORDINARY_DB_PIN)).toBe(true);
    expect(verifyStoredPin(SYNTHETIC_64_HEX, stored)).toBe(false);
  });
});

describe("ALIGN-SEC-006 Master recovery via env (no DB plaintext required)", () => {
  const prev = process.env.HUB_MASTER_PIN;

  afterEach(() => {
    if (prev === undefined) delete process.env.HUB_MASTER_PIN;
    else process.env.HUB_MASTER_PIN = prev;
  });

  it("isHubMasterPin recovers with full 64-hex from env", () => {
    process.env.HUB_MASTER_PIN = SYNTHETIC_64_HEX;
    expect(requireHubMasterPin()).toBe(SYNTHETIC_64_HEX);
    expect(isHubMasterPin(SYNTHETIC_64_HEX)).toBe(true);
    expect(isHubMasterPin(ORDINARY_DB_PIN)).toBe(false);
    expect(isHubMasterPin("")).toBe(false);
  });

  it("invalid / truncated credentials fail while ordinary PIN shape stays valid", () => {
    process.env.HUB_MASTER_PIN = SYNTHETIC_64_HEX;
    expect(isHubMasterPin(SYNTHETIC_64_HEX.slice(0, 63))).toBe(false);
    expect(isValidPermanentPin(ORDINARY_DB_PIN)).toBe(true);
    expect(getHubMasterPin()).toHaveLength(64);
  });
});

describe("ALIGN-SEC-006 bootstrap HTTP / script response contracts", () => {
  it("HTTP route never returns raw pin / getHubMasterPin in JSON body fields", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../app/api/auth/bootstrap-admin/route.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/pin:\s*getHubMasterPin/);
    expect(source).not.toMatch(/Intentionally return the master PIN/);
    expect(source).toMatch(/pin_configured:\s*Boolean\(getHubMasterPin/);
    expect(source).toMatch(/pin_storage:\s*"hashed"/);
    expect(source).toMatch(/configured HUB_MASTER_PIN/);
  });

  it("local bootstrap script never prints pin: masterPin", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../scripts/bootstrap-admin.mjs"),
      "utf8"
    );
    expect(source).not.toMatch(/pin:\s*masterPin/);
    expect(source).toMatch(/pin_configured:\s*true/);
    expect(source).toMatch(/pin_storage:\s*"hashed"/);
    expect(source).toMatch(/pin_code:\s*pinHash/);
    expect(source).toMatch(/pin_hash:\s*pinHash/);
  });

  it("bootstrap-admin.ts uses hashPin and does not assign plaintext pin_code", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "bootstrap-admin.ts"),
      "utf8"
    );
    expect(source).toMatch(/masterBootstrapPinFields/);
    expect(source).toMatch(/hashPin/);
    expect(source).toMatch(/verifyStoredPin/);
    // Auth password may still use env pin (provider-hashed); roster must not.
    expect(source).toMatch(/password:\s*pin/);
    expect(source).not.toMatch(/pin_code:\s*pin\b/);
  });

  it("hub-bridge still verifies stored hash and env Master fallback", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "hub-bridge.ts"),
      "utf8"
    );
    expect(source).toMatch(/verifyStoredPin/);
    expect(source).toMatch(/isHubMasterPin\(pin\)/);
    expect(source).toMatch(/pin_hash/);
  });
});
