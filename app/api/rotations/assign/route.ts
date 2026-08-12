import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { assignLocationsToCurrentWeek } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/rotations/assign
 * Super Admin — manually add bay(s) to this week's rotation and bump
 * manual_priority_count for adaptive future draws.
 * Body: { location_ids: string[], department_id?: string }
 */
export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      location_ids?: string[];
      department_id?: string;
    };

    const locationIds = Array.isArray(body.location_ids)
      ? body.location_ids.map(String)
      : [];
    if (locationIds.length === 0) {
      return NextResponse.json(
        { error: "location_ids are required" },
        { status: 400 }
      );
    }

    let departmentId = body.department_id?.trim() || "";
    if (!departmentId) {
      const { data: sample, error } = await supabase
        .from("store_locations")
        .select("department_id")
        .eq("id", locationIds[0])
        .eq("store_id", store.id)
        .maybeSingle();
      if (error) {
        return NextResponse.json(
          { error: readableError(error, "Could not resolve location") },
          { status: 500 }
        );
      }
      departmentId = String(sample?.department_id ?? "");
    }

    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }

    const result = await assignLocationsToCurrentWeek(
      supabase,
      departmentId,
      locationIds
    );

    return NextResponse.json({
      ok: true,
      store_id: store.id,
      created: result.rotations.length,
      ...result,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not assign locations") },
      { status: 400 }
    );
  }
}
