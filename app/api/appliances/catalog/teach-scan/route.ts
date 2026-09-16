import { NextResponse } from "next/server";
import {
  ApplianceScanFingerprintConfigError,
} from "@/lib/appliances/scan-fingerprint.server";
import { teachApplianceScanFingerprint } from "@/lib/appliances/scan-resolve.server";
import { actorBoundStoreNumber } from "@/lib/store-ops/appliance-store-scope";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/appliances/catalog/teach-scan
 * Associate a transient physical scan identifier with a catalog item.
 * Server fingerprints; raw identifier is not persisted.
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

    if (body.scan_fingerprint != null && String(body.scan_fingerprint) !== "") {
      return NextResponse.json(
        { error: "Client-supplied scan_fingerprint is not accepted" },
        { status: 400 }
      );
    }

    const taught = await teachApplianceScanFingerprint(supabase, {
      store,
      item_number: String(body.item_number ?? ""),
      rawScanIdentifier: body.scan_identifier,
    });

    return NextResponse.json({
      item: taught.item,
      created: taught.created,
    });
  } catch (err) {
    if (err instanceof ApplianceScanFingerprintConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const maybe = err as unknown as { status?: unknown; message?: unknown };
    const status = typeof maybe.status === "number" ? maybe.status : 500;
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : typeof maybe.message === "string"
              ? maybe.message
              : "Unknown error",
      },
      { status }
    );
  }
}
