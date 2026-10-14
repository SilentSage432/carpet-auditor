import { NextResponse } from "next/server";
import {
  actorAllowsDepartmentCode,
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import { readableError } from "@/lib/store-ops/errors";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import {
  getActiveWeekBayPriorityForBay,
  listWeekBayPriorities,
  prioritizeBayForWeek,
  revokeWeekBayPriority,
  resolveNextRotationWeekLabel,
} from "@/lib/store-ops/week-bay-priority";
import { parseIsoWeekLabel } from "@/lib/store-ops/week";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

/**
 * GET /api/store-locations/week-bay-priority
 * Supervisor+ — list active priorities for a store week, or one bay.
 */
export async function GET(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const url = new URL(request.url);
    const weekLabel =
      String(url.searchParams.get("week_label") ?? "").trim() ||
      resolveNextRotationWeekLabel();
    parseIsoWeekLabel(weekLabel);

    const departmentId = String(
      url.searchParams.get("department_id") ?? ""
    ).trim();
    const aisle = String(url.searchParams.get("aisle") ?? "").trim();
    const bayRaw = url.searchParams.get("bay");

    if (departmentId && aisle && bayRaw != null) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        (
          await resolveStoreByNumber(supabase, actor.storeNumber)
        ).id,
        departmentId
      );
      const one = await getActiveWeekBayPriorityForBay(supabase, {
        store_number: actor.storeNumber,
        week_label: weekLabel,
        department_id: departmentId,
        aisle,
        bay: bayRaw,
      });
      if (!one.ok) {
        return NextResponse.json(
          { error: one.message, code: one.code },
          { status: 400 }
        );
      }
      return NextResponse.json({
        week_label: weekLabel,
        priority: one.value,
      });
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    if (departmentId) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        departmentId
      );
    }

    const listed = await listWeekBayPriorities(supabase, {
      store_number: actor.storeNumber,
      week_label: weekLabel,
      department_id: departmentId || null,
      activeOnly: true,
    });
    if (!listed.ok) {
      return NextResponse.json(
        { error: listed.message, code: listed.code },
        { status: 400 }
      );
    }

    let priorities = listed.value;
    if (actor.role !== "super_admin") {
      const { data: depts } = await supabase
        .from("departments")
        .select("id, code")
        .eq("store_id", store.id);
      const allowedDeptIds = new Set(
        (depts ?? [])
          .filter((d) => actorAllowsDepartmentCode(actor, String(d.code ?? "")))
          .map((d) => String(d.id))
      );
      priorities = priorities.filter((p) =>
        allowedDeptIds.has(String(p.department_id ?? ""))
      );
    }

    return NextResponse.json({
      week_label: weekLabel,
      priorities,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load week bay priorities") },
      { status: 400 }
    );
  }
}

/**
 * POST /api/store-locations/week-bay-priority
 * Supervisor+ — prioritize a canonical bay for a target rotation week.
 * Intent only — not an assignment.
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
      week_label?: string;
    };

    const departmentId = String(body.department_id ?? "").trim();
    const aisle = String(body.aisle ?? "").trim();
    const weekLabel =
      String(body.week_label ?? "").trim() || resolveNextRotationWeekLabel();
    if (!departmentId || !aisle || body.bay == null) {
      return NextResponse.json(
        { error: "department_id, aisle, and bay are required" },
        { status: 400 }
      );
    }
    parseIsoWeekLabel(weekLabel);

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

    const actorSpecialistId = String(actor.specialistId ?? "").trim();
    if (!actorSpecialistId) {
      return NextResponse.json(
        { error: "Actor specialist id required to attribute priority" },
        { status: 403 }
      );
    }

    const result = await prioritizeBayForWeek(supabase, {
      store_id: store.id,
      store_number: actor.storeNumber,
      week_label: weekLabel,
      department_id: departmentId,
      aisle,
      bay: body.bay,
      prioritized_by_specialist_id: actorSpecialistId,
    });
    if (!result.ok) {
      const status =
        result.code === "ownership_missing" ||
        result.code === "ownership_ambiguous"
          ? 409
          : 400;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      week_label: weekLabel,
      priority: result.value,
      note: "Priority requested for week — not an assignment.",
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not prioritize bay for week") },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/store-locations/week-bay-priority
 * Supervisor+ — revoke an active week-scoped priority.
 */
export async function DELETE(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json().catch(() => ({}))) as {
      priority_id?: string;
      department_id?: string;
      aisle?: string;
      bay?: number | string;
      week_label?: string;
    };

    const actorSpecialistId = String(actor.specialistId ?? "").trim();
    if (!actorSpecialistId) {
      return NextResponse.json(
        { error: "Actor specialist id required to revoke priority" },
        { status: 403 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    let departmentId = String(body.department_id ?? "").trim();
    const priorityId = String(body.priority_id ?? "").trim();

    // Authority must come from the target row (or explicit place key), never an
    // omitted department_id that would skip scope checks.
    if (priorityId) {
      const { data: target, error: targetError } = await supabase
        .from("store_week_bay_priorities")
        .select("id, department_id, store_number")
        .eq("id", priorityId)
        .eq("store_number", actor.storeNumber)
        .maybeSingle();
      if (targetError) {
        return NextResponse.json(
          { error: readableError(targetError, "Could not load priority") },
          { status: 500 }
        );
      }
      if (!target) {
        return NextResponse.json(
          { error: "Active priority not found", code: "not_found" },
          { status: 404 }
        );
      }
      departmentId = String(target.department_id ?? "").trim();
    }

    if (!departmentId) {
      return NextResponse.json(
        {
          error:
            "department_id is required when priority_id is not supplied",
        },
        { status: 400 }
      );
    }

    await assertActorCanAccessDepartmentId(
      supabase,
      actor,
      store.id,
      departmentId
    );

    const result = await revokeWeekBayPriority(supabase, {
      store_number: actor.storeNumber,
      priority_id: body.priority_id,
      week_label:
        String(body.week_label ?? "").trim() || resolveNextRotationWeekLabel(),
      department_id: departmentId || null,
      aisle: body.aisle,
      bay: body.bay,
      revoked_by_specialist_id: actorSpecialistId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.code === "not_found" ? 404 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      priority: result.value,
      note: "Priority revoked — no assignment was created or removed.",
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not revoke week bay priority") },
      { status: 400 }
    );
  }
}
