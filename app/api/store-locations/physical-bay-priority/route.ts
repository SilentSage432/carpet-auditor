import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import { readableError } from "@/lib/store-ops/errors";
import {
  parseRotationPriorityLevel,
  setPhysicalBayRotationPriority,
} from "@/lib/store-ops/physical-bay-priority";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

/**
 * POST /api/store-locations/physical-bay-priority
 * Master + DS (authorized department) — set Standard / High on one physical bay.
 * Fans out to SELLING/TOPSTOCK siblings. Does not grant topology mutation.
 */
export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      department_id?: string;
      aisle?: string;
      bay?: number | string;
      priority?: unknown;
    };

    const departmentId = String(body.department_id ?? "").trim();
    const aisle = String(body.aisle ?? "").trim();
    const priority = parseRotationPriorityLevel(body.priority);
    if (!departmentId || !aisle || priority == null || body.bay == null) {
      return NextResponse.json(
        {
          error:
            "department_id, aisle, bay, and priority (standard|high) are required",
        },
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

    await assertActorCanAccessDepartmentId(
      supabase,
      actor,
      store.id,
      departmentId
    );

    const result = await setPhysicalBayRotationPriority(supabase, {
      department_id: departmentId,
      aisle,
      bay: body.bay,
      priority,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not update physical-bay priority") },
      { status: 400 }
    );
  }
}
