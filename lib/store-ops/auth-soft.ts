/**
 * Soft Auth payloads for Store Ops read endpoints.
 * Prefer empty data + auth_required over hard 401 UI blockers when
 * the hub session exists but Supabase Auth (phone OTP) does not.
 */

export const STORE_OPS_AUTH_HINT =
  "Supabase Auth session required — use phone OTP / Forgot Access to link your profile, then refresh.";

export function isStoreOpsAuthFailureMessage(message: string): boolean {
  return /unauthorized|auth session|sign in with phone|phone otp|401/i.test(
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
