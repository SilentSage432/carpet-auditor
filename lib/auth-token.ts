/**
 * Unified one-time auth token + PIN hash owner.
 * Invite and PIN-reset compose this; they do not hash tokens themselves.
 * Raw tokens are never persisted — only SHA-256 hex.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const INVITE_TTL_HOURS = 48;
export const RESET_TTL_MINUTES = 30;
export const VERIFY_SESSION_TTL_MS = 15 * 60 * 1000;
export const PERMANENT_PIN_MIN_DIGITS = 4;
export const PERMANENT_PIN_MAX_DIGITS = 6;

export const AUTH_VERIFY_COOKIE = "deptsync_auth_verify";

export type AuthTokenPurpose = "invite" | "reset";

/** 256-bit one-time secret for /auth/verify/[token]. Never persist the raw value. */
export function generateAuthToken(): string {
  return randomBytes(32).toString("base64url");
}

export const generateInviteToken = generateAuthToken;

/** SHA-256 hex of the raw token — this is what we store. */
export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const hashInviteToken = hashAuthToken;

export function isAuthTokenHash(value: string | null | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{64}$/i.test(value.trim()));
}

export const isInviteTokenHash = isAuthTokenHash;

/** Format: salt.hexdigest (sha256 of salt:pin). */
export function hashPin(pin: string, salt?: string): string {
  const s = salt && salt.length > 0 ? salt : randomBytes(16).toString("hex");
  const digest = createHash("sha256").update(`${s}:${pin}`).digest("hex");
  return `${s}.${digest}`;
}

export const hashTempPin = hashPin;
export const hashPermanentPin = hashPin;

export function isSaltedPinHash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [salt, digest] = stored.split(".");
  return Boolean(
    salt &&
      digest &&
      /^[0-9a-f]+$/i.test(salt) &&
      salt.length >= 16 &&
      /^[0-9a-f]{64}$/i.test(digest)
  );
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function verifyPinHash(
  pin: string,
  stored: string | null | undefined
): boolean {
  if (!stored || !pin) return false;
  const [salt, digest] = stored.split(".");
  if (!salt || !digest) return false;
  const next = createHash("sha256").update(`${salt}:${pin}`).digest("hex");
  return timingSafeHexEqual(next, digest);
}

export const verifyTempPinHash = verifyPinHash;

/** Verify a roster PIN whether it is salted SHA-256 or legacy plaintext. */
export function verifyStoredPin(
  pin: string,
  stored: string | null | undefined
): boolean {
  if (!pin || !stored) return false;
  if (isSaltedPinHash(stored)) return verifyPinHash(pin, stored);
  return stored === pin;
}

export function isValidPermanentPin(pin: string): boolean {
  return new RegExp(
    `^\\d{${PERMANENT_PIN_MIN_DIGITS},${PERMANENT_PIN_MAX_DIGITS}}$`
  ).test(pin);
}

export function inviteExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}

export function resetExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + RESET_TTL_MINUTES * 60 * 1000);
}

export function isAuthTokenExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

export const isInviteExpired = isAuthTokenExpired;

export function resolvedAuthTokenHash(row: Record<string, unknown>): string | null {
  const next = String(row.auth_token_hash ?? row.invite_token_hash ?? "").trim();
  return next || null;
}

export function resolvedAuthTokenExpiresAt(
  row: Record<string, unknown>
): string | null {
  const next = String(
    row.auth_token_expires_at ?? row.invite_token_expires_at ?? ""
  ).trim();
  return next || null;
}

export function resolvedPinHash(row: Record<string, unknown>): string | null {
  const hashed = String(row.pin_hash ?? "").trim();
  if (hashed) return hashed;
  const pinCode = String(row.pin_code ?? "").trim();
  return pinCode || null;
}

export function buildVerifyUrl(
  origin: string,
  token: string,
  options?: { test?: boolean }
): string {
  const base = origin.replace(/\/$/, "");
  const url = `${base}/auth/verify/${encodeURIComponent(token)}`;
  return options?.test ? `${url}?test=1` : url;
}

export function isInviteHarnessMode(testFlag?: boolean | string | null): boolean {
  return testFlag === true || testFlag === "1" || testFlag === "true";
}

function verifyCookieSecret(): string {
  return (
    process.env.HUB_GATE_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "deptsync-auth-verify-v1"
  );
}

export type AuthVerifyPayload = {
  v: 1;
  sid: string;
  purpose: AuthTokenPurpose;
  exp: number;
};

export function authVerifyCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(VERIFY_SESSION_TTL_MS / 1000),
  };
}

export function mintAuthVerifyCookie(
  specialistId: string,
  purpose: AuthTokenPurpose
): string | null {
  const sid = String(specialistId ?? "").trim();
  if (!sid) return null;
  const exp = Date.now() + VERIFY_SESSION_TTL_MS;
  const body = Buffer.from(
    JSON.stringify({ v: 1, sid, purpose, exp } satisfies AuthVerifyPayload)
  ).toString("base64url");
  const sig = createHmac("sha256", verifyCookieSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAuthVerifyCookie(
  token: string | null | undefined
): AuthVerifyPayload | null {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac("sha256", verifyCookieSecret())
    .update(body)
    .digest("base64url");
  if (expected.length !== sig.length) return null;
  try {
    if (
      !timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as AuthVerifyPayload;
    if (parsed?.v !== 1 || !parsed.sid || !Number.isFinite(parsed.exp)) {
      return null;
    }
    if (parsed.purpose !== "invite" && parsed.purpose !== "reset") return null;
    if (parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readCookieHeader(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}
