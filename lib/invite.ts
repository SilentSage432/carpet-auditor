/**
 * Invite / reset SMS copy — composes lib/auth-token.ts (crypto owner).
 * Presentation lives on /auth/verify/[token] and Roster add-member.
 */

import { normalizePhoneE164 } from "@/lib/phone";
import type { AssociateOnboardingStatus } from "@/lib/types";
import {
  INVITE_TTL_HOURS,
  RESET_TTL_MINUTES,
  buildVerifyUrl,
} from "@/lib/auth-token";

export { normalizePhoneE164 };
export {
  INVITE_TTL_HOURS,
  PERMANENT_PIN_MIN_DIGITS,
  PERMANENT_PIN_MAX_DIGITS,
  RESET_TTL_MINUTES,
  generateAuthToken,
  generateInviteToken,
  hashAuthToken,
  hashInviteToken,
  hashPin,
  hashPermanentPin,
  hashTempPin,
  inviteExpiresAt,
  isAuthTokenExpired,
  isInviteExpired,
  isInviteHarnessMode,
  isInviteTokenHash,
  isSaltedPinHash,
  isValidPermanentPin,
  resetExpiresAt,
  verifyPinHash,
  verifyStoredPin,
  verifyTempPinHash,
} from "@/lib/auth-token";

export function buildInviteUrl(
  origin: string,
  token: string,
  options?: { test?: boolean }
): string {
  return buildVerifyUrl(origin, token, options);
}

export function buildWelcomeSmsBody(inviteUrl: string, _tempPin?: string): string {
  return `Welcome to DeptSync! Set your PIN here: ${inviteUrl}`;
}

export function buildInviteSmsBody(input: {
  storeNumber: string;
  departmentLabel: string;
  tempPin?: string;
  inviteUrl: string;
  hours?: number;
  style?: "welcome" | "detailed";
}): string {
  if (input.style !== "detailed") {
    return buildWelcomeSmsBody(input.inviteUrl, input.tempPin);
  }
  const hours = input.hours ?? INVITE_TTL_HOURS;
  return [
    `DeptSync: You're invited as ${input.departmentLabel} (store ${input.storeNumber || "—"}).`,
    `Open: ${input.inviteUrl}`,
    `Expires in ${hours}h. Set a 4–6 digit PIN from this one-time link.`,
  ].join("\n");
}

export function buildPinResetSmsBody(inviteUrl: string): string {
  return `DeptSync PIN reset: ${inviteUrl} (expires in ${RESET_TTL_MINUTES}m). If you didn't request this, ignore.`;
}

export function buildSmsLink(
  phoneE164: string | null | undefined,
  body: string
): string {
  const digits = (phoneE164 ?? "").replace(/[^\d+]/g, "");
  const encoded = encodeURIComponent(body);
  if (digits) return `sms:${digits}?&body=${encoded}`;
  return `sms:?&body=${encoded}`;
}

export function deriveOnboardingStatus(row: {
  status?: unknown;
  is_active?: unknown;
  must_change_pin?: unknown;
  invite_token?: unknown;
  invite_token_hash?: unknown;
  auth_token_hash?: unknown;
  invite_consumed_at?: unknown;
}): AssociateOnboardingStatus {
  const raw = String(row.status ?? "").trim().toLowerCase();
  if (raw === "invited" || raw === "active" || raw === "suspended") {
    return raw;
  }
  if (raw === "inactive") return "suspended";
  if (row.is_active === false || row.is_active === "false" || row.is_active === 0) {
    return "suspended";
  }
  const pendingInvite =
    Boolean(row.must_change_pin) &&
    !row.invite_consumed_at &&
    Boolean(row.invite_token || row.invite_token_hash || row.auth_token_hash);
  return pendingInvite ? "invited" : "active";
}
