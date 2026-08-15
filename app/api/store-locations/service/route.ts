import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { logBayService } from "@/lib/store-ops/bay-service";
import { storeOpsAuthRequiredBody } from "@/lib/store-ops/auth-soft";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { parseBayServiceIntensity } from "@/lib/store-ops/velocity";

/**
 * POST /api/store-locations/service
 * Body: { location_id, intensity, notes? }
 * Inserts bay_service_logs and stamps store_locations.last_serviced_at.
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

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      location_id?: string;
      intensity?: string;
      notes?: string | null;
    };

    const intensity = parseBayServiceIntensity(body.intensity);
    if (!intensity) {
      return NextResponse.json(
        {
          error:
            "intensity must be light_touch, heavy_packdown, or critical_hole",
        },
        { status: 400 }
      );
    }

    const locationId = String(body.location_id ?? "").trim();
    if (!locationId) {
      return NextResponse.json(
        { error: "location_id is required" },
        { status: 400 }
      );
    }

    const result = await logBayService(supabase, actor, store.id, {
      locationId,
      intensity,
      notes: body.notes,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({ hint: err.message }),
        { status: err.status }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Forbidden" ? 403 : message === "Location not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
