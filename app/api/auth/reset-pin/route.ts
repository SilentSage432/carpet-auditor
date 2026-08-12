import { NextResponse } from "next/server";
import { readableError } from "@/lib/store-ops/errors";
import {
  resolveStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { resetHubPin } from "@/lib/store-ops/reset-pin";
import { describeSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

type Body = {
  specialist_id?: string;
  username?: string;
  store_number?: string;
  current_pin?: string;
  new_pin?: string;
  /** Super Admin may force-reset without current PIN. */
  admin_reset?: boolean;
};

/**
 * POST /api/auth/reset-pin
 * Direct Hub PIN reset. Writes store_specialists + upserts store_profiles
 * (creates Master Admin profile row when missing) via service role.
 *
 * Auth:
 * - Super Admin Bearer session may reset any profile (optional current_pin).
 * - Otherwise requires current_pin matching the target roster PIN (self-service).
 */
export async function POST(request: Request) {
  try {
    const env = describeSupabaseEnv();
    if (!env.urlReady || !env.serviceRoleReady) {
      return NextResponse.json(
        {
          error:
            "Supabase is not fully configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const newPin = String(body.new_pin ?? "").trim();
    if (!/^\d{4}$/.test(newPin)) {
      return NextResponse.json(
        { error: "New PIN must be exactly 4 digits" },
        { status: 400 }
      );
    }

    const actor = await resolveStoreOpsActor(request);
    const isSuperAdmin = actor?.role === "super_admin";
    const adminReset = Boolean(body.admin_reset) && isSuperAdmin;

    if (!actor && !String(body.current_pin ?? "").trim()) {
      return NextResponse.json(
        {
          error:
            "Unauthorized — sign in with Hub PIN Auth, or provide current_pin",
        },
        { status: 401 }
      );
    }

    // Self-service: non–super-admin may only reset their own specialist id.
    if (actor && !isSuperAdmin) {
      const targetId = String(body.specialist_id ?? "").trim();
      if (targetId && targetId !== String(actor.specialistId)) {
        throw new StoreOpsAuthError(
          "You can only change your own PIN",
          403
        );
      }
    }

    const ensureMaster = Boolean(isSuperAdmin && body.admin_reset);

    const result = await resetHubPin({
      specialist_id: body.specialist_id ?? actor?.specialistId ?? null,
      username: body.username ?? null,
      store_number: body.store_number ?? actor?.storeNumber ?? null,
      current_pin: body.current_pin ?? null,
      new_pin: newPin,
      require_current_pin: !adminReset,
      ensure_master: ensureMaster,
    });

    return NextResponse.json({
      ok: true,
      specialist: result.specialist,
      created_specialist: result.created_specialist,
      upserted_store_profiles: result.upserted_store_profiles,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = readableError(err, "PIN reset failed");
    const status = /current pin is incorrect|profile not found/i.test(message)
      ? 401
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
