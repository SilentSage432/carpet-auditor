import { NextResponse } from "next/server";
import {
  ensureMasterAdminBootstrap,
  getHubMasterPin,
  HUB_MASTER_USERNAME,
} from "@/lib/store-ops/bootstrap-admin";
import { readableError } from "@/lib/store-ops/errors";
import { describeSupabaseEnv } from "@/lib/supabase/env";
import { normalizeStoreNumber } from "@/lib/store";

export const dynamic = "force-dynamic";

function authorizeBootstrap(request: Request): boolean {
  const secret =
    process.env.BOOTSTRAP_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * POST /api/auth/bootstrap-admin
 * One-time / recovery seed for Master Admin (service role).
 * Auth: Bearer CRON_SECRET or BOOTSTRAP_SECRET.
 *
 * Body (optional): { store_number?: string, mint_session?: boolean }
 */
export async function POST(request: Request) {
  try {
    if (!authorizeBootstrap(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      store_number?: string;
      mint_session?: boolean;
    };

    const storeNumber =
      normalizeStoreNumber(body.store_number ?? "") ||
      normalizeStoreNumber(process.env.HUB_BOOTSTRAP_STORE_NUMBER ?? "") ||
      null;

    const result = await ensureMasterAdminBootstrap({
      store_number: storeNumber,
      mint_session: body.mint_session === true,
    });

    return NextResponse.json({
      ok: true,
      username: HUB_MASTER_USERNAME,
      // Intentionally return the master PIN so local recovery can sign in.
      pin: getHubMasterPin(),
      specialist_id: result.specialist.id,
      store_number: result.store_number,
      auth_user_id: result.authUserId,
      email: result.email,
      created_specialist: result.created_specialist,
      created_auth_user: result.created_auth_user,
      session: result.session ?? null,
      hint: `Sign in with username "${HUB_MASTER_USERNAME}" and the returned pin (Hub PIN bridge will mint Auth).`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: readableError(err, "Master Admin bootstrap failed") },
      { status: 500 }
    );
  }
}

/** GET — status check (same Bearer). Does not reset PIN unless ?force=1. */
export async function GET(request: Request) {
  try {
    if (!authorizeBootstrap(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("force") === "1") {
      const result = await ensureMasterAdminBootstrap({
        store_number: normalizeStoreNumber(
          url.searchParams.get("store_number") ?? ""
        ) || null,
        mint_session: false,
      });
      return NextResponse.json({
        ok: true,
        forced: true,
        username: HUB_MASTER_USERNAME,
        pin: getHubMasterPin(),
        specialist_id: result.specialist.id,
        store_number: result.store_number,
      });
    }

    return NextResponse.json({
      ok: true,
      username: HUB_MASTER_USERNAME,
      pin_configured: Boolean(getHubMasterPin()),
      hint: "POST with Bearer CRON_SECRET to seed/reset Master Admin.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: readableError(err, "Bootstrap status failed") },
      { status: 500 }
    );
  }
}
