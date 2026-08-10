/**
 * Optional Twilio SMS send. When credentials are missing, callers fall back
 * to a copyable sms: link — never invent delivery success.
 */

import { normalizePhoneE164 } from "@/lib/invite";

export type TwilioSendResult =
  | { ok: true; sid: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; reason: string };

function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || "";
  const from = process.env.TWILIO_FROM_NUMBER?.trim() || "";
  if (!accountSid || !authToken || !from) {
    return null;
  }
  return { accountSid, authToken, from };
}

export async function sendInviteSms(input: {
  to: string;
  body: string;
}): Promise<TwilioSendResult> {
  const cfg = twilioConfig();
  if (!cfg) {
    return {
      ok: false,
      skipped: true,
      reason:
        "Twilio not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)",
    };
  }

  const to = normalizePhoneE164(input.to);
  if (!to) {
    return { ok: false, skipped: false, reason: "Invalid destination phone number" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");
  const form = new URLSearchParams({
    To: to,
    From: cfg.from,
    Body: input.body,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      error_message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        reason:
          json.message ||
          json.error_message ||
          `Twilio HTTP ${res.status}`,
      };
    }
    return { ok: true, sid: json.sid || "sent" };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      reason: err instanceof Error ? err.message : "Twilio request failed",
    };
  }
}
