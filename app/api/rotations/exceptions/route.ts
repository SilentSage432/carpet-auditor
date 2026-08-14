import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  buildVerificationSummary,
  listRotationExceptions,
  reportRotationBarriers,
} from "@/lib/store-ops/verification";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import type { ExceptionReason } from "@/lib/store-ops/types";

/**
 * GET /api/rotations/exceptions
 * Super admin: full summary + exception log.
 * Supervisor / Associate: own department exceptions only.
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const week = url.searchParams.get("week")?.trim() || isoWeekLabel();

    if (actor.role === "super_admin") {
      requireSuperAdmin(actor);
      const [summary, exceptions] = await Promise.all([
        buildVerificationSummary(supabase, week),
        listRotationExceptions(supabase, { assignedWeek: week, limit: 300 }),
      ]);
      return NextResponse.json({
        assigned_week: week,
        store_id: store.id,
        summary,
        exceptions: exceptions ?? [],
      });
    }

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

    const exceptions = await listRotationExceptions(supabase, {
      assignedWeek: week,
      departmentId: deptId,
      limit: 100,
    });

    return NextResponse.json({
      assigned_week: week,
      store_id: store.id,
      summary: [],
      exceptions: exceptions ?? [],
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load exceptions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rotations/exceptions
 * Mid-week barrier report (blocked bay, unpalletized top-stock, missing SIMS).
 * Does not stamp department last_verified_week — use /api/rotations/verify for that.
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

    if (incomplete.length === 0) {
      return NextResponse.json(
        { error: "At least one barrier bay is required" },
        { status: 400 }
      );
    }

    const result = await reportRotationBarriers(supabase, {
      departmentId,
      assignedWeek: body.assigned_week?.trim() || isoWeekLabel(),
      incomplete,
      reportedBy: actor.specialistId,
      markCarriedOver: true,
    });

    return NextResponse.json({ ok: true, store_id: store.id, ...result });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Barrier report failed" },
      { status: 400 }
    );
  }
}
