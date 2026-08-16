import { NextResponse } from "next/server";
import { requestPinReset } from "@/lib/onboarding/pin-reset";
import { isInviteHarnessMode } from "@/lib/auth-token";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

/**
 * POST /api/auth/pin-reset/request
 * Public: validates a registered phone, issues a short-lived hashed token,
 * invalidates prior tokens, and dispatches the reset SMS/link.
 */
export async function POST(request: Request) {
  try {
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json().catch(() => ({}))) as {
      phone?: string;
      test_mode?: boolean;
    };

    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      new URL(request.url).origin;

    const issued = await requestPinReset({
      supabase,
      origin,
      phone: String(body.phone ?? ""),
      testMode: isInviteHarnessMode(body.test_mode),
    });

    return NextResponse.json({
      ok: true,
      expires_at: issued.expires.toISOString(),
      sms: issued.sms,
      // Never return the raw token to the requester UI except test harness.
      ...(isInviteHarnessMode(body.test_mode)
        ? { reset_url: issued.resetUrl, reset_token: issued.resetToken }
        : {}),
    });
  } catch (err) {
    const message = readableError(err, "Could not send PIN reset");
    const status = /valid mobile|linked to that phone/i.test(message)
      ? 400
      : 500;
    const notFound = /linked to that phone/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : status }
    );
  }
}
