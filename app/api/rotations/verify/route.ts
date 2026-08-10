import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  parseStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { verifyWeeklyRotations } from "@/lib/store-ops/verification";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { isoWeekLabel } from "@/lib/store-ops/week";
import type { ExceptionReason } from "@/lib/store-ops/types";

/**
 * POST /api/rotations/verify
 * End-of-week supervisor verification: complete selected bays + log exceptions.
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const body = (await request.json()) as {
      department_id?: string;
      assigned_week?: string;
      completed_rotation_ids?: string[];
      incomplete?: Array<{
        rotation_id?: string;
        location_id?: string;
        reason?: string;
        cycle_number?: number;
      }>;
    };

    let departmentId = body.department_id?.trim() || "";

    if (isDeptFloorActor(actor)) {
      if (!actor.departmentCode) {
        return NextResponse.json(
          { error: "No department assigned" },
          { status: 403 }
        );
      }
      const ownId = await resolveDepartmentIdByCode(
        supabase,
        actor.departmentCode,
        store.id
      );
      if (!ownId) {
        return NextResponse.json(
          { error: "Department not found" },
          { status: 404 }
        );
      }
      if (departmentId && departmentId !== ownId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      departmentId = ownId;
    } else if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const incomplete = (body.incomplete ?? [])
      .map((item) => ({
        rotationId: String(item.rotation_id ?? ""),
        locationId: String(item.location_id ?? ""),
        reason: String(item.reason ?? "Other") as ExceptionReason | string,
        cycleNumber: Number(item.cycle_number) || 1,
      }))
      .filter((item) => item.locationId);

    const completedRotationIds = (body.completed_rotation_ids ?? []).map(String);

    // Empty payload is allowed to stamp "verified" when floor work already done
    const result = await verifyWeeklyRotations(supabase, {
      departmentId,
      assignedWeek: body.assigned_week?.trim() || isoWeekLabel(),
      completedRotationIds,
      incomplete,
      reportedBy: actor.specialistId,
    });

    return NextResponse.json({ ok: true, store_id: store.id, ...result });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 400 }
    );
  }
}
