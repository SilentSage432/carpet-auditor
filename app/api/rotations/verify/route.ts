import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import {
  listPendingVerificationQueue,
  sendBackWeeklyRotation,
  verifyAllPendingRotations,
  verifyPendingRotation,
} from "@/lib/store-ops/rotation-review";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { verifyWeeklyRotations } from "@/lib/store-ops/verification";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { sundayStagingWeekLabel } from "@/lib/store-ops/sunday-schedule";
import type { ExceptionReason } from "@/lib/store-ops/types";

type ReviewAction = "verify" | "send_back" | "verify_all";

async function resolveDepartmentForActor(
  supabase: SupabaseClient,
  actor: ReturnType<typeof requireStoreOpsActor>,
  storeId: string,
  departmentIdRaw: string,
  allowMissingForAdmin: boolean
): Promise<{ departmentId: string; expectedDepartmentId: string | null }> {
  let departmentId = departmentIdRaw;

  if (isDeptFloorActor(actor)) {
    if (!actor.departmentCode) {
      throw new StoreOpsAuthError("No department assigned", 403);
    }
    const ownId = await resolveDepartmentIdByCode(
      supabase,
      actor.departmentCode,
      storeId
    );
    if (!ownId) {
      throw new StoreOpsAuthError("Department not found", 404);
    }
    if (departmentId && departmentId !== ownId) {
      throw new StoreOpsAuthError("Forbidden", 403);
    }
    return { departmentId: ownId, expectedDepartmentId: ownId };
  }

  if (!departmentId && !allowMissingForAdmin) {
    throw new StoreOpsAuthError("department_id is required", 400);
  }

  return { departmentId, expectedDepartmentId: null };
}

/**
 * GET /api/rotations/verify
 * DS verification queue: bays in PENDING_VERIFICATION for the staging week.
 */
export async function GET(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const scoped = await resolveDepartmentForActor(
      supabase,
      actor,
      store.id,
      url.searchParams.get("department_id")?.trim() || "",
      true
    );
    const week =
      url.searchParams.get("assigned_week")?.trim() ||
      sundayStagingWeekLabel(new Date(), store.timezone) ||
      isoWeekLabel();

    const { data: assignmentRows } = await supabase
      .from("sunday_bay_assignments")
      .select("bay_id, specialist_name")
      .eq("assigned_week", week);

    const assignments: Record<string, { specialist_name?: string | null }> = {};
    for (const row of assignmentRows ?? []) {
      const bayId = String(
        (row as { bay_id?: string }).bay_id ?? ""
      ).trim();
      if (!bayId) continue;
      assignments[bayId] = {
        specialist_name:
          String((row as { specialist_name?: string }).specialist_name ?? "") ||
          null,
      };
    }

    const items = await listPendingVerificationQueue(supabase, {
      storeId: store.id,
      departmentId: scoped.departmentId || null,
      assignedWeek: week,
      assignments,
    });

    return NextResponse.json({
      assigned_week: week,
      pending_count: items.length,
      items,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load verification queue" },
      { status: 400 }
    );
  }
}

/**
 * POST /api/rotations/verify
 * End-of-week supervisor verification, or DS review_action on the queue.
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const body = (await request.json()) as {
      department_id?: string;
      assigned_week?: string;
      review_action?: ReviewAction;
      rotation_id?: string;
      note?: string;
      completed_rotation_ids?: string[];
      incomplete?: Array<{
        rotation_id?: string;
        location_id?: string;
        reason?: string;
        cycle_number?: number;
      }>;
    };

    const reviewAction = body.review_action;
    if (reviewAction) {
      requireSupervisorOrAdmin(actor);
      const scoped = await resolveDepartmentForActor(
        supabase,
        actor,
        store.id,
        body.department_id?.trim() || "",
        reviewAction === "verify_all" || reviewAction === "verify"
      );
      const week =
        body.assigned_week?.trim() ||
        sundayStagingWeekLabel(new Date(), store.timezone) ||
        isoWeekLabel();

      if (reviewAction === "verify") {
        const rotationId = body.rotation_id?.trim();
        if (!rotationId) {
          return NextResponse.json(
            { error: "rotation_id is required" },
            { status: 400 }
          );
        }
        const result = await verifyPendingRotation(
          supabase,
          rotationId,
          actor.specialistId,
          scoped.expectedDepartmentId
        );
        return NextResponse.json({
          ok: true,
          action: "verify",
          store_id: store.id,
          rotation: result.rotation,
        });
      }

      if (reviewAction === "send_back") {
        const rotationId = body.rotation_id?.trim();
        if (!rotationId) {
          return NextResponse.json(
            { error: "rotation_id is required" },
            { status: 400 }
          );
        }
        const result = await sendBackWeeklyRotation(
          supabase,
          rotationId,
          body.note ?? "",
          scoped.expectedDepartmentId
        );
        return NextResponse.json({
          ok: true,
          action: "send_back",
          store_id: store.id,
          rotation: result.rotation,
        });
      }

      const batch = await verifyAllPendingRotations(supabase, {
        storeId: store.id,
        departmentId: scoped.departmentId || null,
        assignedWeek: week,
        actorId: actor.specialistId,
      });

      const stampDepartments =
        batch.department_ids.length > 0
          ? batch.department_ids
          : scoped.departmentId
            ? [scoped.departmentId]
            : [];

      for (const departmentId of stampDepartments) {
        await verifyWeeklyRotations(supabase, {
          departmentId,
          assignedWeek: week,
          completedRotationIds: [],
          incomplete: [],
          reportedBy: actor.specialistId,
        });
      }

      return NextResponse.json({
        ok: true,
        action: "verify_all",
        store_id: store.id,
        assigned_week: week,
        verified_count: batch.verified_count,
      });
    }

    const scoped = await resolveDepartmentForActor(
      supabase,
      actor,
      store.id,
      body.department_id?.trim() || "",
      false
    );

    const incomplete = (body.incomplete ?? [])
      .map((item) => ({
        rotationId: String(item.rotation_id ?? ""),
        locationId: String(item.location_id ?? ""),
        reason: String(item.reason ?? "Other") as ExceptionReason | string,
        cycleNumber: Number(item.cycle_number) || 1,
      }))
      .filter((item) => item.locationId);

    const completedRotationIds = (body.completed_rotation_ids ?? []).map(String);

    const result = await verifyWeeklyRotations(supabase, {
      departmentId: scoped.departmentId,
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
