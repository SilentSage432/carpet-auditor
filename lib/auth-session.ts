/**
 * Auth session ownership — persistence, inactivity lock, and session token.
 * Specialists knowledge stays in lib/specialists.ts; this module owns the wall session only.
 */

import type { StoreSpecialist } from "./types";
import { getStoreNumber } from "./store";
import {
  getActiveSpecialist,
  mapRow,
  setActiveSpecialist,
} from "./specialists";

const SESSION_KEY = "deptsync_auth_session";

/** Lock after 8 hours of inactivity. */
export const AUTH_SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export type AuthSession = {
  specialist: StoreSpecialist;
  sessionToken: string;
  lastActiveTimestamp: number;
};

export function createSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isAuthSessionExpired(
  session: AuthSession | null | undefined
): boolean {
  if (!session) return true;
  const age = Date.now() - session.lastActiveTimestamp;
  return age > AUTH_SESSION_TIMEOUT_MS;
}

export function readAuthSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      // Migrate legacy active-specialist-only sessions into auth session shape.
      const legacy = getActiveSpecialist();
      if (!legacy) return null;
      const migrated: AuthSession = {
        specialist: legacy,
        sessionToken: createSessionToken(),
        lastActiveTimestamp: Date.now(),
      };
      writeAuthSession(migrated);
      return migrated;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const specialist = mapRow(
      parsed.specialist as Record<string, unknown>
    );
    if (!specialist || specialist.store_number !== getStoreNumber()) {
      return null;
    }
    const lastActiveTimestamp = Number(parsed.lastActiveTimestamp);
    const sessionToken = String(parsed.sessionToken ?? "");
    if (!sessionToken || !Number.isFinite(lastActiveTimestamp)) return null;
    return { specialist, sessionToken, lastActiveTimestamp };
  } catch {
    return null;
  }
}

export function writeAuthSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  setActiveSpecialist(session.specialist);
}

export function startAuthSession(specialist: StoreSpecialist): AuthSession {
  const session: AuthSession = {
    specialist,
    sessionToken: createSessionToken(),
    lastActiveTimestamp: Date.now(),
  };
  writeAuthSession(session);
  return session;
}

export function touchAuthSession(): AuthSession | null {
  const session = readAuthSession();
  if (!session || isAuthSessionExpired(session)) return null;
  const next = { ...session, lastActiveTimestamp: Date.now() };
  writeAuthSession(next);
  return next;
}

export function updateAuthSessionSpecialist(
  specialist: StoreSpecialist
): AuthSession | null {
  const session = readAuthSession();
  if (!session) {
    return startAuthSession(specialist);
  }
  const next: AuthSession = {
    ...session,
    specialist,
    lastActiveTimestamp: Date.now(),
  };
  writeAuthSession(next);
  return next;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
  setActiveSpecialist(null);
}
