/**
 * Hub `/` session bootstrap (SEC-OPS-007G).
 * Reuses AccessGate decision table — never queries store_specialists as anon.
 */

import {
  decideAccessGateBoot,
  type AccessGateBootOutcome,
} from "@/lib/auth/access-gate-bootstrap";
import type { AuthSession } from "@/lib/auth-session";
import type { StoreSpecialist } from "@/lib/types";

export type HubRosterProbe = {
  roster: StoreSpecialist[] | null;
  rosterError: unknown | null;
  /** True only when a Supabase access_token was present before the probe. */
  fetched: boolean;
};

/**
 * Whether the browser may call PostgREST store_specialists.
 * Hub wall session alone is never sufficient (SEC-OPS-002 anon revoke).
 */
export function canFetchProtectedRoster(hasJwt: boolean): boolean {
  return hasJwt;
}

/**
 * Decide hub AuthWall / enter after JWT-first roster probe.
 * Identical fail-closed rules to AccessGate (007D).
 */
export function decideHubPageBoot(input: {
  session: AuthSession | null;
  sessionExpired: boolean;
  hasJwt: boolean;
  roster: StoreSpecialist[] | null;
  rosterError: unknown | null;
  matched: StoreSpecialist | null;
  needsSetup: boolean;
}): AccessGateBootOutcome {
  return decideAccessGateBoot(input);
}
