/**
 * Supervisor invite — owns temp PIN hashing, token TTL, and SMS copy.
 * Presentation lives on /invite and Admin roster; storage is store_specialists.
 */

import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import { normalizePhoneE164 } from "@/lib/phone";

export { normalizePhoneE164 };

export const INVITE_TTL_HOURS = 48;

/** Generate a cryptographically strong 6-digit PIN (000000–999999). */
export function generateTempPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateInviteToken(): string {
  return randomUUID();
}

/** Format: salt.hexdigest (sha256 of salt:pin). */
export function hashTempPin(pin: string, salt?: string): string {
  const s = salt && salt.length > 0 ? salt : randomBytes(16).toString("hex");
  const digest = createHash("sha256").update(`${s}:${pin}`).digest("hex");
  return `${s}.${digest}`;
}

export function verifyTempPinHash(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !pin) return false;
  const [salt, digest] = stored.split(".");
  if (!salt || !digest) return false;
  const next = createHash("sha256").update(`${salt}:${pin}`).digest("hex");
  if (next.length !== digest.length) return false;
  // timing-safe compare
  let mismatch = 0;
  for (let i = 0; i < next.length; i += 1) {
    mismatch |= next.charCodeAt(i) ^ digest.charCodeAt(i);
  }
  return mismatch === 0;
}

export function inviteExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}

export function isInviteExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

export function buildInviteUrl(
  origin: string,
  token: string,
  options?: { test?: boolean }
): string {
  const base = origin.replace(/\/$/, "");
  const url = `${base}/invite?token=${encodeURIComponent(token)}`;
  return options?.test ? `${url}&test=1` : url;
}

/**
 * Canonical welcome SMS copy for Super Admin preview / manual send.
 * Format locked for Test Invite Flow harness.
 */
export function buildWelcomeSmsBody(inviteUrl: string, tempPin: string): string {
  return `Welcome to DeptSync! Access your department portal here: ${inviteUrl}. Your temporary PIN is: ${tempPin}.`;
}

export function buildInviteSmsBody(input: {
  storeNumber: string;
  departmentLabel: string;
  tempPin: string;
  inviteUrl: string;
  hours?: number;
  /** Prefer the short welcome template used by the admin test harness. */
  style?: "welcome" | "detailed";
}): string {
  if (input.style !== "detailed") {
    return buildWelcomeSmsBody(input.inviteUrl, input.tempPin);
  }
  const hours = input.hours ?? INVITE_TTL_HOURS;
  return [
    `DeptSync: You're invited as ${input.departmentLabel} Supervisor (store ${input.storeNumber || "—"}).`,
    `Temp PIN: ${input.tempPin}`,
    `Open: ${input.inviteUrl}`,
    `Expires in ${hours}h. Set a new PIN on first login.`,
  ].join("\n");
}

/** Explicit staging / Test Invite Flow flag only (does not auto-enable in all of development). */
export function isInviteHarnessMode(testFlag?: boolean | string | null): boolean {
  return testFlag === true || testFlag === "1" || testFlag === "true";
}

/** sms: URI for copy/share when Twilio is not configured. */
export function buildSmsLink(phoneE164: string | null | undefined, body: string): string {
  const digits = (phoneE164 ?? "").replace(/[^\d+]/g, "");
  const encoded = encodeURIComponent(body);
  if (digits) return `sms:${digits}?&body=${encoded}`;
  return `sms:?&body=${encoded}`;
}

