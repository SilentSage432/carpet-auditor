/**
 * APP-UPC-001A — Server-only keyed fingerprint for physical appliance scan ids.
 * MUST never be imported from client components or shared browser bundles.
 */

import "server-only";

import { createHmac } from "crypto";
import {
  APPLIANCE_SCAN_FINGERPRINT_HEX_LEN,
  canonicalApplianceScanIdentifier,
} from "@/lib/appliances/scan-identity";

/** Dedicated env — independently rotatable; never reuse gate/cron/auth secrets. */
export const APPLIANCE_SCAN_HMAC_SECRET_ENV = "APPLIANCE_SCAN_HMAC_SECRET";

export class ApplianceScanFingerprintConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplianceScanFingerprintConfigError";
  }
}

/**
 * Fail closed: missing/blank secret → hard error. No fallback to other secrets.
 */
export function requireApplianceScanHmacSecret(
  env: NodeJS.ProcessEnv = process.env
): string {
  const secret = String(env[APPLIANCE_SCAN_HMAC_SECRET_ENV] ?? "").trim();
  if (!secret) {
    throw new ApplianceScanFingerprintConfigError(
      `${APPLIANCE_SCAN_HMAC_SECRET_ENV} is required (fail closed)`
    );
  }
  return secret;
}

/**
 * HMAC-SHA-256 hex digest of the canonical physical scan identifier.
 * Caller must pass already-canonical OR raw — this re-canonicalizes once.
 */
export function fingerprintApplianceScanIdentifier(
  rawOrCanonical: unknown,
  secret: string = requireApplianceScanHmacSecret()
): string {
  const canonical = canonicalApplianceScanIdentifier(rawOrCanonical);
  if (!canonical) {
    throw new Error("scan identifier is required");
  }
  const digest = createHmac("sha256", secret)
    .update(canonical, "utf8")
    .digest("hex");
  if (digest.length !== APPLIANCE_SCAN_FINGERPRINT_HEX_LEN) {
    throw new Error("unexpected fingerprint length");
  }
  return digest;
}
