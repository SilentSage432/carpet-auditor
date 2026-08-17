import { NextResponse } from "next/server";
import { mintHubBridgeSession } from "@/lib/store-ops/hub-bridge";
import { readableError } from "@/lib/store-ops/errors";
import { toPublicSpecialist } from "@/lib/specialists";
import { describeSupabaseEnv } from "@/lib/supabase/env";

/**
 * POST /api/auth/hub-bridge
 * Verify Hub PIN against store_specialists (service role) and mint a Supabase
 * Auth session so Store Ops APIs work without phone OTP.
 * Master PIN auto-provisions Super Admin when roster/profile is missing.
 */
export async function POST(request: Request) {
  try {
    const env = describeSupabaseEnv();
    if (!env.urlReady || !env.serviceRoleReady || !env.anonReady) {
      return NextResponse.json(
        {
          error:
            "Supabase is not fully configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      username?: string;
      specialist_id?: string;
      pin?: string;
      password?: string;
      store_number?: string;
    };

    const username = String(body.username ?? "").trim();
    const specialistId = String(body.specialist_id ?? "").trim();
    const pin = String(body.pin ?? body.password ?? "").trim();
    if ((!username && !specialistId) || !pin) {
      return NextResponse.json(
        { error: "username or specialist_id, and pin, are required" },
        { status: 400 }
      );
    }

    const result = await mintHubBridgeSession({
      username: username || undefined,
      specialist_id: specialistId || undefined,
      pin,
      store_number: body.store_number,
    });

    return NextResponse.json({
      ok: true,
      specialist_id: result.specialist.id,
      role: result.specialist.role,
      store_number: result.specialist.store_number,
      specialist: toPublicSpecialist(result.specialist),
      session: result.session,
    });
  } catch (err) {
    const message = readableError(err, "Hub PIN bridge failed");
    const status = /invalid username or pin/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
