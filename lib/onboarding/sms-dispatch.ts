/**
 * Invite SMS dispatch — Twilio when configured, otherwise a webhook stub.
 * Never reports delivery success unless Twilio (or a real webhook) confirms it.
 */

import "server-only";

import type { TwilioSendResult } from "@/lib/twilio-sms";
import { sendInviteSms } from "@/lib/twilio-sms";

export type InviteSmsDispatchResult = TwilioSendResult & {
  stub?: boolean;
};

type DispatchInput = {
  to: string | null;
  body: string;
  inviteUrl: string;
  testMode?: boolean;
};

async function triggerSmsWebhookStub(input: {
  to: string;
  body: string;
  inviteUrl: string;
}): Promise<InviteSmsDispatchResult> {
  const webhookUrl = process.env.SMS_INVITE_WEBHOOK_URL?.trim() || "";
  if (!webhookUrl) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[invite sms stub]", {
        to: input.to,
        invite_url: input.inviteUrl,
      });
    }
    return {
      ok: false,
      skipped: true,
      stub: true,
      reason:
        "SMS webhook stub — Twilio not configured; copy the invite link or sms: preview",
    };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: input.to,
        body: input.body,
        invite_url: input.inviteUrl,
        stub: true,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        stub: true,
        reason: `SMS webhook HTTP ${res.status}`,
      };
    }
    return { ok: true, sid: "webhook-stub" };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      stub: true,
      reason: err instanceof Error ? err.message : "SMS webhook failed",
    };
  }
}

export async function dispatchInviteSms(
  input: DispatchInput
): Promise<InviteSmsDispatchResult> {
  if (input.testMode) {
    return {
      ok: false,
      skipped: true,
      stub: true,
      reason: "Test Invite Flow — SMS not sent; use Copy Full SMS Text",
    };
  }
  if (!input.to) {
    return {
      ok: false,
      skipped: true,
      stub: true,
      reason: "No phone number provided — use SMS link preview",
    };
  }

  const twilio = await sendInviteSms({ to: input.to, body: input.body });
  if (twilio.ok) return twilio;
  if (!twilio.skipped) return twilio;

  return triggerSmsWebhookStub({
    to: input.to,
    body: input.body,
    inviteUrl: input.inviteUrl,
  });
}
