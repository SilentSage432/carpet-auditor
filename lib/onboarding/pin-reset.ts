/**
 * Self-service PIN reset — composition owner.
 * Validates a registered phone, issues a short-lived hashed token
 * (invalidating any prior token), and dispatches the reset link.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateAuthToken,
  hashAuthToken,
  resetExpiresAt,
  buildVerifyUrl,
} from "@/lib/auth-token";
import { buildPinResetSmsBody, buildSmsLink } from "@/lib/invite";
import { dispatchInviteSms } from "@/lib/onboarding/sms-dispatch";
import { persistSpecialistPatch } from "@/lib/onboarding/token-persist";
import { phonesMatch, normalizePhoneE164 } from "@/lib/phone";
import { readableError } from "@/lib/store-ops/errors";

export type RequestPinResetResult = {
  specialistId: string;
  name: string;
  phone: string;
  resetToken: string;
  resetUrl: string;
  expires: Date;
  sms: Awaited<ReturnType<typeof dispatchInviteSms>>;
  smsBody: string;
  smsLink: string;
};

export async function requestPinReset(input: {
  supabase: SupabaseClient;
  origin: string;
  phone: string;
  testMode?: boolean;
}): Promise<RequestPinResetResult> {
  const phone = normalizePhoneE164(input.phone);
  if (!phone) {
    throw new Error("Enter a valid mobile number");
  }

  const { data, error } = await input.supabase
    .from("store_specialists")
    .select("*")
    .not("phone_number", "is", null);

  if (error) {
    throw new Error(readableError(error, "Could not look up phone"));
  }

  const match = (data ?? []).find((row) => {
    const record = row as Record<string, unknown>;
    if (record.is_active === false) return false;
    if (String(record.status ?? "").toLowerCase() === "suspended") return false;
    return phonesMatch(String(record.phone_number ?? ""), phone);
  }) as Record<string, unknown> | undefined;

  if (!match?.id) {
    throw new Error(
      "No active DeptSync profile is linked to that phone. Ask a Master Admin to add your number."
    );
  }

  const resetToken = generateAuthToken();
  const tokenHash = hashAuthToken(resetToken);
  const expires = resetExpiresAt();
  const resetUrl = buildVerifyUrl(input.origin, resetToken, {
    test: Boolean(input.testMode),
  });
  const smsBody = buildPinResetSmsBody(resetUrl);

  const persisted = await persistSpecialistPatch(
    input.supabase,
    "update",
    {
      auth_token_hash: tokenHash,
      auth_token_expires_at: expires.toISOString(),
      invite_token: null,
      invite_token_hash: tokenHash,
      invite_token_expires_at: expires.toISOString(),
      invite_consumed_at: null,
      must_change_pin: true,
    },
    { id: String(match.id) }
  );

  if (persisted.error || !persisted.data) {
    throw new Error(
      readableError(persisted.error, "Could not issue PIN reset token")
    );
  }

  const sms = await dispatchInviteSms({
    to: phone,
    body: smsBody,
    inviteUrl: resetUrl,
    testMode: Boolean(input.testMode),
  });

  return {
    specialistId: String(match.id),
    name: String(match.name ?? ""),
    phone,
    resetToken,
    resetUrl,
    expires,
    sms,
    smsBody,
    smsLink: buildSmsLink(phone, smsBody),
  };
}
