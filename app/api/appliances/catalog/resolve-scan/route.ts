import { NextResponse } from "next/server";
import {
  ApplianceScanFingerprintConfigError,
} from "@/lib/appliances/scan-fingerprint.server";
import { resolveApplianceScanFingerprint } from "@/lib/appliances/scan-resolve.server";
import { actorBoundStoreNumber } from "@/lib/store-ops/appliance-store-scope";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/appliances/catalog/resolve-scan
 * Client sends transient raw scan_identifier. Server computes HMAC fingerprint.
 * Never accepts a client-authored fingerprint as authority.
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const store = actorBoundStoreNumber(
      actor,
      body.store_number != null ? String(body.store_number) : null
    );

    // Reject client-supplied fingerprint authority.
    if (body.scan_fingerprint != null && String(body.scan_fingerprint) !== "") {
      return NextResponse.json(
        { error: "Client-supplied scan_fingerprint is not accepted" },
        { status: 400 }
      );
    }

    const result = await resolveApplianceScanFingerprint(
      supabase,
      store,
      body.scan_identifier
    );

    if (result.status === "empty") {
      return NextResponse.json(
        { error: "scan_identifier is required" },
        { status: 400 }
      );
    }

    if (result.status === "matched") {
      return NextResponse.json({
        status: "matched",
        item: result.item,
        // fingerprint omitted from normal response — plumbing only if needed later
      });
    }

    return NextResponse.json({ status: "unknown" });
  } catch (err) {
    if (err instanceof ApplianceScanFingerprintConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
