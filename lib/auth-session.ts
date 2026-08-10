/**
 * Auth session ownership — persistence, inactivity lock, and session token.
 * Specialists knowledge stays in lib/specialists.ts; this module owns the wall session only.
 */

import type { StoreSpecialist } from "./types";
import { getStoreNumber, normalizeStoreNumber } from "./store";
import {
  getActiveSpecialist,
  mapRow,
  setActiveSpecialist,
} from "./specialists";

const SESSION_KEY = "deptsync_auth_session";
/** Tab-scoped flag: user already unlocked this sessionToken in this browser tab. */
const WORKSPACE_UNLOCKED_KEY = "deptsync_workspace_unlocked";

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

export function markWorkspaceUnlocked(sessionToken: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(WORKSPACE_UNLOCKED_KEY, sessionToken);
  } catch {
    /* private mode / blocked storage */
  }
}

export function clearWorkspaceUnlocked(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(WORKSPACE_UNLOCKED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True when this tab already completed login/unlock for the current session token
 * and credentials do not require first-login setup.
 */
export function isWorkspaceUnlockedInTab(
  session: AuthSession | null | undefined
): boolean {
  if (!session || typeof window === "undefined") return false;
  if (isAuthSessionExpired(session)) return false;
  if (session.specialist.must_change_credentials) return false;
  try {
    return sessionStorage.getItem(WORKSPACE_UNLOCKED_KEY) === session.sessionToken;
  } catch {
    return false;
  }
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
    if (!specialist) return null;

    // Normalize store numbers — missing/empty store should not wipe the session
    const specialistStore = normalizeStoreNumber(
      String(specialist.store_number || getStoreNumber())
    );
    const activeStore = getStoreNumber();
    if (specialistStore !== activeStore) {
      return null;
    }
    specialist.store_number = specialistStore;

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
  markWorkspaceUnlocked(session.sessionToken);
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
    specialist: {
      ...specialist,
      store_number: normalizeStoreNumber(
        String(specialist.store_number || getStoreNumber())
      ),
      must_change_credentials: Boolean(specialist.must_change_credentials),
    },
    lastActiveTimestamp: Date.now(),
  };
  writeAuthSession(next);
  return next;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  clearWorkspaceUnlocked();
  localStorage.removeItem(SESSION_KEY);
  setActiveSpecialist(null);
}
