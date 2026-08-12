import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";

/**
 * GET /api/store-locations/history?location_id=
 * Super Admin — bay rotation history for Store Map bottom sheet.
 */
export async function GET(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const locationId = new URL(request.url).searchParams
      .get("location_id")
      ?.trim();
    if (!locationId) {
      return NextResponse.json(
        { error: "location_id is required" },
        { status: 400 }
      );
    }

    const { data: location, error: locError } = await supabase
      .from("store_locations")
      .select("*")
      .eq("id", locationId)
      .eq("store_id", store.id)
      .maybeSingle();

    if (locError) {
      return NextResponse.json(
        { error: readableError(locError, "Could not load location") },
        { status: 500 }
      );
    }
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const { data: rotations, error: rotError } = await supabase
      .from("weekly_rotations")
      .select(
        "id, assigned_week, is_completed, completed_at, created_at, location_id"
      )
      .eq("location_id", locationId)
      .order("assigned_week", { ascending: false })
      .limit(24);

    if (rotError) {
      return NextResponse.json(
        { error: readableError(rotError, "Could not load bay history") },
        { status: 500 }
      );
    }

    return NextResponse.json({
      store_id: store.id,
      location,
      rotations: rotations ?? [],
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load bay history") },
      { status: 500 }
    );
  }
}
