import { NextResponse } from "next/server";
import { mintHubBridgeSession } from "@/lib/store-ops/hub-bridge";
import { readableError } from "@/lib/store-ops/errors";
import { toPublicSpecialist } from "@/lib/specialists";
import { describeSupabaseEnv } from "@/lib/supabase/env";
import {
  buildAuthRateLimitBucket,
  extractClientIp,
  rateLimitResponse,
  touchAuthRateLimit,
} from "@/lib/store-ops/auth-rate-limit";

/**
 * POST /api/auth/hub-bridge
 * Verify Hub PIN against store_specialists (service role) and mint a Supabase
 * Auth session so Store Ops APIs work without phone OTP.
 *
 * AUTH-HARDEN-001A: shared atomic rate limiting BEFORE PIN verification.
 * Fail-closed if limiter infra is unavailable. No public bypass.
 * Protected recovery: POST /api/auth/bootstrap-admin (BOOTSTRAP_SECRET) or
 * scripts/bootstrap-admin.mjs — not this route.
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

    // IP-only bucket — client store_number must not mint alternate limit keys.
    const bucketKey = buildAuthRateLimitBucket({
      clientIp: extractClientIp(request),
    });

    // Atomic admit: consumes one attempt slot under row lock (race-safe).
    const admit = await touchAuthRateLimit({ bucketKey, mode: "attempt" });
    if (!admit.allowed) {
      return rateLimitResponse(admit);
    }

    try {
      const result = await mintHubBridgeSession({
        username: username || undefined,
        specialist_id: specialistId || undefined,
        pin,
        store_number: body.store_number,
      });

      // Clear only this IP bucket after verified success.
      // Clear failure must not undo a verified login (operator access preserved).
      const cleared = await touchAuthRateLimit({ bucketKey, mode: "success" });
      if (cleared.failClosed) {
        console.warn(
          "[auth-rate-limit] success clear failed after verified login — session still issued",
          { reason: cleared.reason }
        );
      }

      return NextResponse.json({
        ok: true,
        specialist_id: result.specialist.id,
        role: result.specialist.role,
        store_number: result.specialist.store_number,
        specialist: toPublicSpecialist(result.specialist),
        session: result.session,
      });
    } catch (authErr) {
      // Attempt slot already consumed — failed PIN stays counted.
      const message = readableError(authErr, "Hub PIN bridge failed");
      const isInvalid = /invalid username or pin/i.test(message);
      const isInvited = /invite link before signing in/i.test(message);
      const isSuspended = /suspended/i.test(message);

      if (isInvalid) {
        return NextResponse.json(
          { error: "Invalid username or PIN" },
          { status: 401 }
        );
      }

      const status = isInvited || isSuspended ? 403 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  } catch (err) {
    const message = readableError(err, "Hub PIN bridge failed");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
