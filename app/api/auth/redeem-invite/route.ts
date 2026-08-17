import { NextResponse } from "next/server";
import {
  HUB_GATE_COOKIE,
  hubGateCookieOptions,
  mintHubGateToken,
} from "@/lib/auth-gate";
import { isValidPermanentPin } from "@/lib/auth-token";
import { previewQrPairing, redeemQrPairing } from "@/lib/onboarding/qr-pair";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

type Body = {
  token?: string;
  pin?: string;
  confirm_pin?: string;
};

/**
 * POST /api/auth/redeem-invite
 * Public pairing bridge. Token-only returns a preview.
 * Token + PIN burns the invite hash, saves PIN, and mints Hub JWT + gate cookie.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const token = String(body.token ?? "").trim();
    if (!token) {
      return NextResponse.json({ error: "Missing pairing token" }, { status: 400 });
    }

    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const pin = String(body.pin ?? "").trim();
    const confirm = String(body.confirm_pin ?? pin).trim();

    if (!pin) {
      const previewed = await previewQrPairing(supabase, token);
      return NextResponse.json({
        ok: true,
        invite: previewed.preview,
        expires_at: previewed.expires_at,
      });
    }

    if (pin !== confirm) {
      return NextResponse.json({ error: "PINs do not match" }, { status: 400 });
    }
    if (!isValidPermanentPin(pin)) {
      return NextResponse.json(
        { error: "PIN must be 4–6 digits" },
        { status: 400 }
      );
    }

    const completed = await redeemQrPairing({ supabase, token, pin });
    const gate = await mintHubGateToken(completed.specialist.id);
    const json = NextResponse.json({
      ok: true,
      specialist: {
        id: completed.specialist.id,
        store_number: completed.specialist.store_number,
        name: completed.specialist.name,
        role: completed.specialist.role,
        pin_code: null,
        username: completed.specialist.username,
        assigned_department: completed.specialist.assigned_department,
        must_change_credentials: false,
        must_change_pin: false,
        is_active: true,
        status: "active",
        created_at: completed.specialist.created_at,
      },
      session: completed.session,
    });
    if (gate) {
      json.cookies.set(HUB_GATE_COOKIE, gate, hubGateCookieOptions());
    }
    return json;
  } catch (err) {
    const message = readableError(err, "Could not redeem pairing code");
    const status = /invalid or expired|replaced|expired|do not match|4–6 digit|suspended/i.test(
      message
    )
      ? /suspended/i.test(message)
        ? 403
        : 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
