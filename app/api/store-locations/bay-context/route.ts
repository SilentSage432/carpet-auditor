/**
 * GET /api/store-locations/bay-context?department_id&aisle&bay
 * Store-ops actor — Map bay operational context (read-only).
 * MAP-002: week assignment, rotation history, walkthrough follow-ups.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import { listMapBayContext } from "@/lib/store-ops/map-bay-context";
import { todayIsoDateInTimeZone } from "@/lib/store-ops/walkthroughs";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { normalizeAisle } from "@/lib/store-ops/aisle";
import { readableError } from "@/lib/store-ops/errors";

export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const departmentId = String(
      url.searchParams.get("department_id") ?? ""
    ).trim();
    const aisle = String(url.searchParams.get("aisle") ?? "").trim();
    const bayRaw = url.searchParams.get("bay");
    const bay = bayRaw == null ? NaN : Number.parseInt(String(bayRaw), 10);
    const weekParam = String(url.searchParams.get("week") ?? "").trim();

    if (!departmentId || !aisle || !Number.isFinite(bay)) {
      return NextResponse.json(
        { error: "department_id, aisle, and bay are required" },
        { status: 400 }
      );
    }

    await assertActorCanAccessDepartmentId(
      supabase,
      actor,
      store.id,
      departmentId
    );

    const result = await listMapBayContext(supabase, {
      store_id: store.id,
      department_id: departmentId,
      aisle: normalizeAisle(aisle),
      bay,
      assignedWeek: weekParam || isoWeekLabel(),
      todayIsoDate: todayIsoDateInTimeZone(new Date(), "America/Denver"),
    });

    if (!result.ok) {
      const status =
        result.code === "missing_relation"
          ? 503
          : result.code === "list_failed"
            ? 500
            : 400;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      context: result.value,
      store_id: store.id,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to load bay context") },
      { status: 500 }
    );
  }
}
