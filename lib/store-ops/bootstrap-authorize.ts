/**
 * Bootstrap / recovery HTTP authorization (ALIGN-SEC-001).
 * Requires dedicated BOOTSTRAP_SECRET — never silently reuses CRON_SECRET.
 */

import "server-only";

import { timingSafeEqual } from "crypto";

/** Dedicated recovery secret, or null when unset (fail closed). */
export function resolveBootstrapSecret(): string | null {
  const secret = process.env.BOOTSTRAP_SECRET?.trim();
  return secret ? secret : null;
}

function bearerMatchesSecret(
  authorization: string | null,
  secret: string
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token || token.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/** True when Authorization Bearer matches configured BOOTSTRAP_SECRET. */
export function authorizeBootstrapRequest(request: Request): boolean {
  const secret = resolveBootstrapSecret();
  if (!secret) return false;
  return bearerMatchesSecret(request.headers.get("authorization"), secret);
}
