import { NextResponse } from "next/server";
import { normalizePhoneE164, phonesMatch } from "@/lib/phone";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

type Body = { phone?: string };

/**
 * POST /api/auth/phone-reset/lookup
 * Confirms an active roster profile owns this phone before SMS OTP is sent.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const phone = normalizePhoneE164(body.phone);
    if (!phone) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid mobile number" },
        { status: 400 }
      );
    }

    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { data, error } = await supabase
      .from("store_specialists")
      .select("id, phone_number, is_active, name")
      .not("phone_number", "is", null);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || "Lookup failed" },
        { status: 500 }
      );
    }

    const match = (data ?? []).find(
      (row) =>
        row.is_active !== false &&
        phonesMatch(String(row.phone_number ?? ""), phone)
    );

    if (!match) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No active DeptSync profile is linked to that phone. Ask a Master Admin to add your number.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Lookup failed",
      },
      { status: 500 }
    );
  }
}
