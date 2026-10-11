/**
 * AccessGate / hub session bootstrap decisions (SEC-OPS-007D / 007G).
 * Pure decision helpers — never grants access on failure.
 * Hub page reuses via decideHubPageBoot (JWT-first roster; no anon SELECT).
 */

import type { AuthSession } from "@/lib/auth-session";
import type { StoreSpecialist } from "@/lib/types";

export type AccessGateBootMode = "login" | "unlock" | "setup" | "enter";

export type AccessGateBootOutcome = {
  mode: AccessGateBootMode;
  roster: StoreSpecialist[];
  member: StoreSpecialist | null;
  /** Clear expired/corrupt hub wall session only. */
  clearHubSession: boolean;
  /** Drop local Supabase Auth JWT only (invalid/unauthorized). */
  clearSupabaseLocal: boolean;
  /** Why bootstrap did not auto-enter (diagnostics / tests). */
  reason:
    | "missing_session"
    | "expired_session"
    | "no_jwt"
    | "setup_required"
    | "enter"
    | "roster_auth_rejected"
    | "roster_network_error"
    | "roster_unknown_error"
    | "enter_failed";
};

export function isLikelyAuthRejection(err: unknown): boolean {
  const message = String(
    (err as { message?: string })?.message ??
      (err as { error_description?: string })?.error_description ??
      err ??
      ""
  ).toLowerCase();
  const code = String(
    (err as { code?: string | number })?.code ??
      (err as { status?: string | number })?.status ??
      ""
  ).toLowerCase();
  if (
    code === "401" ||
    code === "403" ||
    code === "pgrst301" ||
    code === "42501"
  ) {
    return true;
  }
  return (
    message.includes("jwt") ||
    message.includes("unauthorized") ||
    message.includes("not authenticated") ||
    message.includes("invalid claim") ||
    (message.includes("session") && message.includes("expired")) ||
    message.includes("42501") ||
    message.includes("permission denied")
  );
}

export function isLikelyNetworkFailure(err: unknown): boolean {
  if (isLikelyAuthRejection(err)) return false;
  const message = String(
    (err as { message?: string })?.message ?? err ?? ""
  ).toLowerCase();
  const name = String((err as { name?: string })?.name ?? "").toLowerCase();
  return (
    name === "typeerror" ||
    name === "aborterror" ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("failed to fetch") ||
    message.includes("offline")
  );
}

/**
 * Decide AccessGate UI after session/JWT/roster probes.
 * Never returns authenticated workspace entry when roster restore failed.
 */
export function decideAccessGateBoot(input: {
  session: AuthSession | null;
  sessionExpired: boolean;
  hasJwt: boolean;
  roster: StoreSpecialist[] | null;
  rosterError: unknown | null;
  matched: StoreSpecialist | null;
  needsSetup: boolean;
}): AccessGateBootOutcome {
  if (!input.session || input.sessionExpired) {
    return {
      mode: "login",
      roster: [],
      member: null,
      clearHubSession: Boolean(input.session && input.sessionExpired),
      clearSupabaseLocal: false,
      reason: input.session ? "expired_session" : "missing_session",
    };
  }

  const member = input.matched ?? input.session.specialist;

  if (input.rosterError != null) {
    const authReject = isLikelyAuthRejection(input.rosterError);
    const network = isLikelyNetworkFailure(input.rosterError);
    return {
      mode: "unlock",
      roster: [],
      member,
      clearHubSession: false,
      clearSupabaseLocal: authReject,
      reason: authReject
        ? "roster_auth_rejected"
        : network
          ? "roster_network_error"
          : "roster_unknown_error",
    };
  }

  const roster = input.roster ?? [];

  if (input.needsSetup) {
    return {
      mode: "setup",
      roster,
      member,
      clearHubSession: false,
      clearSupabaseLocal: false,
      reason: "setup_required",
    };
  }

  if (!input.hasJwt) {
    return {
      mode: "unlock",
      roster,
      member,
      clearHubSession: false,
      clearSupabaseLocal: false,
      reason: "no_jwt",
    };
  }

  return {
    mode: "enter",
    roster,
    member,
    clearHubSession: false,
    clearSupabaseLocal: false,
    reason: "enter",
  };
}
