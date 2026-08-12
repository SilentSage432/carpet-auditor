import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import {
  completeShowroomTouch,
  resolveDepartmentIdByCode,
} from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";
import { isShowroomDue, type StoreLocation } from "@/lib/store-ops/types";

/**
 * GET /api/showroom-locations
 * Due SHOWROOM_STACKOUT quick-touch bays for the actor's department (or all for super admin).
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    let query = supabase
      .from("store_locations")
      .select("*")
      .eq("store_id", store.id)
      .eq("is_active", true)
      .eq("location_type", "SHOWROOM_STACKOUT")
      .order("aisle")
      .order("bay");

    if (isDeptFloorActor(actor)) {
      if (!actor.departmentCode) {
        return NextResponse.json(
          { error: "No department assigned" },
          { status: 403 }
        );
      }
      const deptId = await resolveDepartmentIdByCode(
        supabase,
        actor.departmentCode,
        store.id
      );
      if (!deptId) {
        return NextResponse.json(
          { error: "Department not found" },
          { status: 404 }
        );
      }
      query = query.eq("department_id", deptId);
    } else {
      const url = new URL(request.url);
      const departmentId = url.searchParams.get("department_id");
      if (departmentId) query = query.eq("department_id", departmentId);
    }

    const { data, error } = await query;
    if (error) {
      // Pre-migration soft empty
      if (/location_type/i.test(error.message)) {
        return NextResponse.json({
          store_id: store.id,
          locations: [],
          due: [],
        });
      }
      return NextResponse.json(
        { error: readableError(error, "Could not load showroom locations") },
        { status: 500 }
      );
    }

    const locations = (data ?? []) as StoreLocation[];
    const due = locations.filter(isShowroomDue);

    return NextResponse.json({
      store_id: store.id,
      locations,
      due,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load showroom locations") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/showroom-locations
 * Body: { location_id } — mark a showroom / stack-out quick touch complete.
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as { location_id?: string };
    const locationId = body.location_id?.trim();
    if (!locationId) {
      return NextResponse.json(
        { error: "location_id is required" },
        { status: 400 }
      );
    }

    let expectedDepartmentId: string | null = null;
    if (isDeptFloorActor(actor)) {
      if (!actor.departmentCode) {
        return NextResponse.json(
          { error: "No department assigned" },
          { status: 403 }
        );
      }
      expectedDepartmentId = await resolveDepartmentIdByCode(
        supabase,
        actor.departmentCode,
        store.id
      );
      if (!expectedDepartmentId) {
        return NextResponse.json(
          { error: "Department not found" },
          { status: 404 }
        );
      }
    }

    const { data: existing } = await supabase
      .from("store_locations")
      .select("store_id")
      .eq("id", locationId)
      .maybeSingle();
    if (!existing || existing.store_id !== store.id) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const location = await completeShowroomTouch(
      supabase,
      locationId,
      expectedDepartmentId
    );

    return NextResponse.json({ ok: true, location });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not complete showroom touch") },
      { status: 400 }
    );
  }
}
