/**
 * APP-UPC-001A — Canonical physical appliance scan identity.
 *
 * Physical scan identifiers (UPC, ESL, taught aliases) are opaque matching inputs.
 * Lowe's item_number remains public/operational catalog identity and is NOT
 * fingerprinted.
 *
 * Normalization must be identical on wedge, teach, offline queue, and server HMAC.
 */

/**
 * Canonical form for a physical appliance scan identifier.
 *
 * Contract (string identity — never numeric):
 * - Trim ASCII whitespace and C0 control framing from both ends
 * - Preserve leading zeros
 * - Preserve non-digit characters (ESL / vendor aliases)
 * - Do not strip internal whitespace (after end-trim, remaining content is opaque)
 *
 * Evidence: APP-CAT-001A field/tests require `"0012345"` and `"ESL-ABC12345"` to
 * survive teach/link. Digits-only + strip-leading-zeros (`sanitizeBarcodeScan`)
 * destroys that. Fresh appliance reset removes legacy dual-key compatibility need.
 */
export function canonicalApplianceScanIdentifier(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, "")
    .trim();
}

/** Public catalog item numbers use the same trim contract (not fingerprinted). */
export function canonicalApplianceItemNumber(raw: unknown): string {
  return canonicalApplianceScanIdentifier(raw);
}

/**
 * True when the scan is long enough to treat as a physical barcode / ESL-style
 * identifier rather than a short typed item number probe.
 */
export function isPhysicalApplianceScanIdentifier(canonical: string): boolean {
  return canonical.length >= 8;
}

/** Hex HMAC-SHA-256 fingerprint length (64 lowercase hex chars). */
export const APPLIANCE_SCAN_FINGERPRINT_HEX_LEN = 64;

export function isApplianceScanFingerprintHex(value: unknown): boolean {
  const s = String(value ?? "");
  return /^[a-f0-9]{64}$/.test(s);
}
