/**
 * Phone OTP recovery — Supabase SMS OTP + roster credential reset.
 * AuthWall owns UI; this module owns OTP send/verify + reset API calls.
 */

import { getSupabase } from "@/lib/supabase";
import { normalizePhoneE164 } from "@/lib/phone";
import type { StoreSpecialist } from "@/lib/types";

export type PhoneOtpSendResult =
  | { ok: true; phone: string; via: "supabase" }
  | { ok: false; error: string };

export type PhoneOtpVerifyResult =
  | { ok: true; phone: string }
  | { ok: false; error: string };

export type PhoneResetResult =
  | { ok: true; specialist: StoreSpecialist }
  | { ok: false; error: string };

/**
 * Send 6-digit SMS OTP via Supabase Auth phone provider.
 * Requires Phone auth enabled in the Supabase project.
 */
export async function requestPinResetLink(
  phoneRaw: string
): Promise<PhoneOtpSendResult> {
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) {
    return { ok: false, error: "Enter a valid mobile number (10+ digits)" };
  }

  try {
    const res = await fetch("/api/auth/pin-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || json.ok === false) {
      return {
        ok: false,
        error: json.error || "Could not send PIN reset link",
      };
    }
    return { ok: true, phone, via: "supabase" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not send PIN reset link",
    };
  }
}

export async function sendPhoneAccessOtp(
  phoneRaw: string
): Promise<PhoneOtpSendResult> {
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) {
    return { ok: false, error: "Enter a valid mobile number (10+ digits)" };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Database not configured — cannot send SMS OTP" };
  }

  // Confirm the phone exists on an active roster profile before burning an SMS.
  const precheck = await fetch("/api/auth/phone-reset/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const preJson = (await precheck.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!precheck.ok || !preJson.ok) {
    return {
      ok: false,
      error: preJson.error || "No active profile found for that phone number",
    };
  }

  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) {
    return {
      ok: false,
      error:
        error.message ||
        "Could not send SMS code. Enable Phone auth in Supabase (Auth → Providers → Phone).",
    };
  }
  return { ok: true, phone, via: "supabase" };
}

/** Verify the 6-digit SMS code and persist the Supabase Auth session. */
export async function verifyPhoneAccessOtp(input: {
  phone: string;
  token: string;
}): Promise<PhoneOtpVerifyResult> {
  const phone = normalizePhoneE164(input.phone);
  const token = input.token.trim().replace(/\D/g, "");
  if (!phone) return { ok: false, error: "Invalid phone number" };
  if (!/^\d{6}$/.test(token)) {
    return { ok: false, error: "Enter the 6-digit code from your SMS" };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Database not configured" };
  }

  const { error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "sms",
  });
  if (error) {
    return { ok: false, error: error.message || "Invalid or expired verification code" };
  }
  return { ok: true, phone };
}

/**
 * After OTP verify, reset roster access credentials for the phone-matched profile.
 * Uses the live Supabase Auth session (localStorage) so the server can trust the phone claim.
 */
export async function resetAccessViaVerifiedPhone(input: {
  phone: string;
  newPassword: string;
  username?: string;
}): Promise<PhoneResetResult> {
  const phone = normalizePhoneE164(input.phone);
  if (!phone) return { ok: false, error: "Invalid phone number" };
  if (input.newPassword.trim().length < 6) {
    return { ok: false, error: "New password must be at least 6 characters" };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Database not configured" };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return {
      ok: false,
      error: "Phone session expired — verify the SMS code again",
    };
  }

  try {
    const res = await fetch("/api/auth/phone-reset/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        phone,
        new_password: input.newPassword.trim(),
        username: input.username?.trim() || undefined,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      specialist?: StoreSpecialist;
    };
    if (!res.ok || !json.specialist) {
      return {
        ok: false,
        error: json.error || `Credential reset failed (${res.status})`,
      };
    }
    return { ok: true, specialist: json.specialist };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Credential reset failed",
    };
  }
}
