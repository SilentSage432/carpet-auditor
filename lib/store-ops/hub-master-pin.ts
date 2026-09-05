/**
 * Hub Master PIN configuration — fail closed when unset.
 * No implicit "1234" (or any) default. Explicit bootstrap uses the same source.
 */

/** Configured Master PIN, or null when HUB_MASTER_PIN is missing/blank. */
export function getHubMasterPin(): string | null {
  const fromEnv = process.env.HUB_MASTER_PIN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/** True only when a Master PIN is configured and the candidate matches it. */
export function isHubMasterPin(pin: string): boolean {
  const configured = getHubMasterPin();
  if (!configured) return false;
  return String(pin ?? "").trim() === configured;
}

export function requireHubMasterPin(): string {
  const pin = getHubMasterPin();
  if (!pin) {
    throw new Error(
      "HUB_MASTER_PIN is not configured — set it in the environment before bootstrapping Master Admin"
    );
  }
  return pin;
}
