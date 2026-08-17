import { NextResponse } from "next/server";
import { issueQrPairing } from "@/lib/onboarding/qr-pair";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

type Body = {
  specialist_id?: string;
};

/**
 * POST /api/roster/pair
 * Master Admin issues a 10-minute QR pairing token for an existing roster row.
 * Does not send SMS or require a phone number.
 */
export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json().catch(() => ({}))) as Body;
    const specialistId = String(body.specialist_id ?? "").trim();
    if (!specialistId) {
      return NextResponse.json(
        { error: "specialist_id is required" },
        { status: 400 }
      );
    }

    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      new URL(request.url).origin;

    const issued = await issueQrPairing({
      supabase,
      specialistId,
      storeNumber: actor.storeNumber,
      origin,
    });

    return NextResponse.json({
      ok: true,
      specialist_id: issued.specialist_id,
      name: issued.name,
      store_number: issued.store_number,
      pair_url: issued.pair_url,
      expires_at: issued.expires_at,
      status: "invited",
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "specialist_id is required") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (
      message === "Roster member not found for this store" ||
      message === "This profile is suspended" ||
      message === "Master Admin does not pair via QR"
    ) {
      return NextResponse.json(
        { error: message },
        { status: message.includes("not found") ? 404 : 400 }
      );
    }
    console.error("[roster/pair]", err);
    return NextResponse.json(
      { error: readableError(err, "Could not issue pairing QR") },
      { status: 500 }
    );
  }
}
