import { NextResponse } from "next/server";
import { normalizePhoneE164, phonesMatch } from "@/lib/phone";
import { mapRow } from "@/lib/specialists";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import type { StoreSpecialist } from "@/lib/types";

type Body = {
  phone?: string;
  new_password?: string;
  username?: string;
};

/**
 * POST /api/auth/phone-reset/confirm
 * Requires Bearer access token from supabase.auth.verifyOtp (SMS).
 * Resets store_specialists pin/username for the phone-matched active profile.
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json(
        { error: "Missing phone auth session" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as Body;
    const phone = normalizePhoneE164(body.phone);
    const newPassword = String(body.new_password ?? "").trim();
    const username = String(body.username ?? "").trim();

    if (!phone) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Phone session invalid or expired — request a new code" },
        { status: 401 }
      );
    }

    const sessionPhone = normalizePhoneE164(
      userData.user.phone || userData.user.user_metadata?.phone
    );
    if (!sessionPhone || sessionPhone !== phone) {
      return NextResponse.json(
        { error: "Verified phone does not match reset request" },
        { status: 403 }
      );
    }

    const { data: rows, error: listError } = await supabase
      .from("store_specialists")
      .select("*")
      .not("phone_number", "is", null);

    if (listError) {
      return NextResponse.json(
        { error: listError.message || "Could not load roster" },
        { status: 500 }
      );
    }

    const match = (rows ?? []).find(
      (row) =>
        row.is_active !== false &&
        phonesMatch(String(row.phone_number ?? ""), phone)
    );

    if (!match?.id) {
      return NextResponse.json(
        { error: "No active profile linked to this verified phone" },
        { status: 404 }
      );
    }

    const patch: Record<string, unknown> = {
      pin_code: newPassword,
      must_change_credentials: false,
      must_change_pin: false,
      is_active: true,
      invite_token: null,
      invite_token_expires_at: null,
      temp_pin_hash: null,
      phone_number: phone,
    };
    if (username.length >= 3) {
      patch.username = username;
    }

    const { data: updated, error: updateError } = await supabase
      .from("store_specialists")
      .update(patch)
      .eq("id", match.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || "Could not reset credentials" },
        { status: 500 }
      );
    }

    const specialist = mapRow(updated as Record<string, unknown>) as StoreSpecialist;
    return NextResponse.json({ ok: true, specialist });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Credential reset failed",
      },
      { status: 500 }
    );
  }
}
