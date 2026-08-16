import { NextResponse } from "next/server";
import {
  HUB_GATE_COOKIE,
  hubGateCookieOptions,
  mintHubGateToken,
} from "@/lib/auth-gate";
import {
  AUTH_VERIFY_COOKIE,
  authVerifyCookieOptions,
  readCookieHeader,
  verifyAuthVerifyCookie,
} from "@/lib/auth-token";
import { completePinFromVerifySession, publicVerifyPreview } from "@/lib/onboarding/redeem-token";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";

function clearVerifyCookie(response: NextResponse) {
  response.cookies.set(AUTH_VERIFY_COOKIE, "", {
    ...authVerifyCookieOptions(),
    maxAge: 0,
  });
}

/**
 * GET /api/auth/verify — restore PIN-setup preview from the consume-on-entry cookie
 * (page refresh after the URL token was burned).
 */
export async function GET(request: Request) {
  const payload = verifyAuthVerifyCookie(
    readCookieHeader(request.headers.get("cookie"), AUTH_VERIFY_COOKIE)
  );
  if (!payload) {
    return NextResponse.json(
      { error: "Setup session expired. Open a new invite or reset link." },
      { status: 401 }
    );
  }

  const { supabase, response } = requireSupabaseAdmin();
  if (!supabase) return response;

  const { data, error } = await supabase
    .from("store_specialists")
    .select("*")
    .eq("id", payload.sid)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: "Setup session expired. Open a new invite or reset link." },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    invite: publicVerifyPreview(data as Record<string, unknown>),
  });
}

/**
 * POST /api/auth/verify
 * body: { pin, confirm_pin }
 * Completes PIN setup from the consume-on-entry cookie and mints an Auth session.
 */
export async function POST(request: Request) {
  try {
    const payload = verifyAuthVerifyCookie(
      readCookieHeader(request.headers.get("cookie"), AUTH_VERIFY_COOKIE)
    );
    if (!payload) {
      return NextResponse.json(
        { error: "Setup session expired. Open a new invite or reset link." },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      pin?: string;
      confirm_pin?: string;
      new_pin?: string;
    };
    const pin = String(body.pin ?? body.new_pin ?? "").trim();
    const confirm = String(body.confirm_pin ?? pin).trim();
    if (pin !== confirm) {
      return NextResponse.json({ error: "PINs do not match" }, { status: 400 });
    }

    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const completed = await completePinFromVerifySession({
      supabase,
      specialistId: payload.sid,
      pin,
    });

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
    clearVerifyCookie(json);
    if (gate) {
      json.cookies.set(HUB_GATE_COOKIE, gate, hubGateCookieOptions());
    }
    return json;
  } catch (err) {
    const message = readableError(err, "Could not save PIN");
    const status = /4–6 digit|do not match/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
