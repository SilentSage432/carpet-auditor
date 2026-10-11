import { NextResponse } from "next/server";
import { normalizePhoneE164 } from "@/lib/phone";
import { readableError } from "@/lib/store-ops/errors";
import {
  resolveStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { updateHubCredentials } from "@/lib/store-ops/reset-pin";
import { describeSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

type Body = {
  specialist_id?: string;
  username?: string;
  password?: string;
  phone?: string | null;
  current_password?: string | null;
};

/**
 * POST /api/auth/update-credentials
 * SEC-OPS-009 — first-login credential customization.
 * Service-role writer only (scrypt). Browser never writes pin_code/pin_hash.
 *
 * Auth:
 * - Bearer JWT actor may update own specialist (super_admin may update any).
 * - Otherwise requires current_password matching the roster credential.
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
    const specialistId = String(body.specialist_id ?? "").trim();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "").trim();
    const currentPassword = String(body.current_password ?? "").trim();

    if (!specialistId || !username || !password) {
      return NextResponse.json(
        { error: "specialist_id, username, and password are required" },
        { status: 400 }
      );
    }

    let phone: string | null | undefined = undefined;
    if (body.phone !== undefined) {
      const raw = String(body.phone ?? "").trim();
      if (!raw) {
        phone = null;
      } else {
        const normalized = normalizePhoneE164(raw);
        if (!normalized) {
          return NextResponse.json(
            { error: "Enter a valid mobile phone number" },
            { status: 400 }
          );
        }
        phone = normalized;
      }
    }

    const actor = await resolveStoreOpsActor(request);
    const isSuperAdmin = actor?.role === "super_admin";
    const actorOwnsTarget =
      Boolean(actor) &&
      (isSuperAdmin || String(actor?.specialistId) === specialistId);

    if (!actorOwnsTarget && !currentPassword) {
      return NextResponse.json(
        {
          error:
            "Unauthorized — sign in with Hub Auth, or provide current_password",
        },
        { status: 401 }
      );
    }

    if (actor && !isSuperAdmin && String(actor.specialistId) !== specialistId) {
      throw new StoreOpsAuthError(
        "You can only change your own credentials",
        403
      );
    }

    const result = await updateHubCredentials({
      specialist_id: specialistId,
      username,
      password,
      phone,
      actor_authorized: actorOwnsTarget,
      current_password: currentPassword || null,
    });

    return NextResponse.json({
      ok: true,
      specialist: result.specialist,
      upserted_store_profiles: result.upserted_store_profiles,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = readableError(err, "Credential update failed");
    const status = /current pin is incorrect|profile not found|unauthorized/i.test(
      message
    )
      ? 401
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
