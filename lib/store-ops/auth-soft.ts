/**
 * Soft Auth payloads for Store Ops read endpoints.
 * Prefer empty data + auth_required over hard 401 UI blockers when
 * the hub UI session exists but Hub Auth bridge has not minted a JWT yet.
 */

export const STORE_OPS_AUTH_HINT =
  "Store Ops Auth session missing — unlock with your Hub PIN/password (sign out and back in if needed). Phone OTP is optional recovery only.";

export function isStoreOpsAuthFailureMessage(message: string): boolean {
  return /unauthorized|auth session|sign in|hub pin|phone otp|401/i.test(
    String(message ?? "")
  );
}

export function storeOpsAuthRequiredBody(
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    auth_required: true,
    hint: STORE_OPS_AUTH_HINT,
    ...extras,
  };
}
