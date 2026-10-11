/**
 * Unified one-time auth token + PIN hash owner.
 * Invite and PIN-reset compose this; they do not hash tokens themselves.
 *
 * PIN credential formats (AUTH-HARDEN-001):
 * - Canonical: scrypt1$N$r$p$saltB64$urlsafeHashB64 (Node crypto.scrypt)
 * - Legacy v1: salt.hexdigest (SHA-256 of salt:pin) — verify + upgrade on login
 * - Legacy plaintext: exact equality — verify only while allowlist enabled
 */

import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

export const INVITE_TTL_HOURS = 48;
export const RESET_TTL_MINUTES = 30;
export const VERIFY_SESSION_TTL_MS = 15 * 60 * 1000;
export const PERMANENT_PIN_MIN_DIGITS = 4;
export const PERMANENT_PIN_MAX_DIGITS = 6;

/** scrypt cost — suitable for low-entropy PINs; ~50–150ms on typical Node hosts. */
export const PIN_SCRYPT_N = 16384;
export const PIN_SCRYPT_R = 8;
export const PIN_SCRYPT_P = 1;
export const PIN_SCRYPT_KEYLEN = 32;
export const PIN_SCRYPT_PREFIX = "scrypt1";

export const AUTH_VERIFY_COOKIE = "deptsync_auth_verify";

export type AuthTokenPurpose = "invite" | "reset";

export type PinCredentialKind =
  | "scrypt"
  | "sha256_salted"
  | "plaintext_legacy"
  | "unknown";

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

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlToBuf(value: string): Buffer | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const pad =
      padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    return Buffer.from(padded + pad, "base64");
  } catch {
    return null;
  }
}

/**
 * Legacy v1 format: salt.hexdigest (sha256 of salt:pin).
 * Retained for verifying historical rows and migration tests.
 */
export function hashPinSha256Legacy(pin: string, salt?: string): string {
  const s = salt && salt.length > 0 ? salt : randomBytes(16).toString("hex");
  const digest = createHash("sha256").update(`${s}:${pin}`).digest("hex");
  return `${s}.${digest}`;
}

/** Canonical slow hash for new PIN writes (AUTH-HARDEN-001). */
export function hashPinScrypt(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, PIN_SCRYPT_KEYLEN, {
    N: PIN_SCRYPT_N,
    r: PIN_SCRYPT_R,
    p: PIN_SCRYPT_P,
  });
  return [
    PIN_SCRYPT_PREFIX,
    String(PIN_SCRYPT_N),
    String(PIN_SCRYPT_R),
    String(PIN_SCRYPT_P),
    b64url(salt),
    b64url(derived),
  ].join("$");
}

/**
 * Hash a roster PIN for persistence.
 * Optional second arg is ignored for new writes (legacy SHA-256 salt was removed
 * from the write path). Use `hashPinSha256Legacy` only in tests / migration fixtures.
 */
export function hashPin(pin: string, _legacySalt?: string): string {
  return hashPinScrypt(pin);
}

export const hashTempPin = hashPin;
export const hashPermanentPin = hashPin;

/** Legacy v1 salted SHA-256 shape (not scrypt). */
export function isSaltedPinHash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (isScryptPinHash(stored)) return false;
  const [salt, digest] = stored.split(".");
  return Boolean(
    salt &&
      digest &&
      /^[0-9a-f]+$/i.test(salt) &&
      salt.length >= 16 &&
      /^[0-9a-f]{64}$/i.test(digest)
  );
}

export function isScryptPinHash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [prefix, n, r, p, salt, hash] = parts;
  if (prefix !== PIN_SCRYPT_PREFIX) return false;
  if (![n, r, p].every((v) => /^\d+$/.test(v ?? ""))) return false;
  return Boolean(salt && hash && b64urlToBuf(salt) && b64urlToBuf(hash));
}

export function isCanonicalPinHash(stored: string | null | undefined): boolean {
  return isScryptPinHash(stored);
}

/** True when stored credential should be rewritten to scrypt after successful verify. */
export function needsPinCredentialUpgrade(
  stored: string | null | undefined
): boolean {
  if (!stored) return false;
  if (isScryptPinHash(stored)) return false;
  if (isSaltedPinHash(stored)) return true;
  return plaintextPinVerifyEnabled();
}

export function classifyPinCredential(
  stored: string | null | undefined
): PinCredentialKind {
  if (!stored) return "unknown";
  if (isScryptPinHash(stored)) return "scrypt";
  if (isSaltedPinHash(stored)) return "sha256_salted";
  if (plaintextPinVerifyEnabled()) return "plaintext_legacy";
  return "unknown";
}

/**
 * Plaintext equality fallback — bounded migration only.
 * Disable with DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY=0 after digit_pin_shape inventory is 0.
 */
export function plaintextPinVerifyEnabled(): boolean {
  const raw = process.env.DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY;
  if (raw === undefined || raw === "") return true;
  const v = raw.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function verifyPinScrypt(
  pin: string,
  stored: string | null | undefined
): boolean {
  if (!stored || !pin || !isScryptPinHash(stored)) return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = stored.split("$");
  const salt = b64urlToBuf(saltB64 ?? "");
  const expected = b64urlToBuf(hashB64 ?? "");
  if (!salt || !expected) return false;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  try {
    const derived = scryptSync(pin, salt, expected.length, { N, r, p });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function verifyPinHash(
  pin: string,
  stored: string | null | undefined
): boolean {
  if (!stored || !pin) return false;
  if (isScryptPinHash(stored)) return verifyPinScrypt(pin, stored);
  const [salt, digest] = stored.split(".");
  if (!salt || !digest) return false;
  const next = createHash("sha256").update(`${salt}:${pin}`).digest("hex");
  return timingSafeHexEqual(next, digest);
}

export const verifyTempPinHash = verifyPinHash;

/**
 * Verify a roster PIN:
 * 1) scrypt (canonical)
 * 2) legacy salted SHA-256
 * 3) plaintext equality only while DEPTSYNC_ALLOW_PLAINTEXT_PIN_VERIFY allows it
 */
export function verifyStoredPin(
  pin: string,
  stored: string | null | undefined
): boolean {
  if (!pin || !stored) return false;
  if (isScryptPinHash(stored)) return verifyPinScrypt(pin, stored);
  if (isSaltedPinHash(stored)) return verifyPinHash(pin, stored);
  if (!plaintextPinVerifyEnabled()) return false;
  if (pin.length !== stored.length) return false;
  try {
    return timingSafeEqual(Buffer.from(pin, "utf8"), Buffer.from(stored, "utf8"));
  } catch {
    return false;
  }
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

/**
 * ALIGN-SEC-001: verify-cookie HMAC uses HUB_GATE_SECRET only (fail closed).
 * Never fall back to CRON_SECRET, service role, or hardcoded strings.
 */
function verifyCookieSecret(): string | null {
  const secret = process.env.HUB_GATE_SECRET?.trim();
  return secret ? secret : null;
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
  const secret = verifyCookieSecret();
  if (!sid || !secret) return null;
  const exp = Date.now() + VERIFY_SESSION_TTL_MS;
  const body = Buffer.from(
    JSON.stringify({ v: 1, sid, purpose, exp } satisfies AuthVerifyPayload)
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAuthVerifyCookie(
  token: string | null | undefined
): AuthVerifyPayload | null {
  const raw = String(token ?? "").trim();
  const secret = verifyCookieSecret();
  if (!raw || !secret) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac("sha256", secret)
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
