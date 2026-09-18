import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  dispatchExtraPhysicalBay,
  suggestExtraPhysicalBay,
} from "@/lib/store-ops/extra-bay-dispatch";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";
import { sundayStagingWeekLabel } from "@/lib/store-ops/sunday-schedule";

/**
 * POST /api/rotations/extra-bay
 * Supervisor or Super Admin — after a complete base weekly plan, give one
 * associate one additional owed physical bay (ENGINE-PROD-003).
 *
 * Body: {
 *   department_id: string,
 *   specialist_id: string,
 *   location_id?: string,  // confirm suggested bay; omit to auto-select
 *   suggest?: boolean      // read-only suggestion only
 * }
 */
export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      department_id?: string;
      specialist_id?: string;
      specialist_name?: string;
      location_id?: string;
      suggest?: boolean;
    };

    const departmentId = String(body.department_id ?? "").trim();
    const specialistId = String(body.specialist_id ?? "").trim();
    if (!departmentId || !specialistId) {
      return NextResponse.json(
        { error: "department_id and specialist_id are required" },
        { status: 400 }
      );
    }

    const { data: dept, error: deptErr } = await supabase
      .from("departments")
      .select("id, code, name, store_id, store_number, is_active")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (deptErr) {
      return NextResponse.json(
        { error: readableError(deptErr, "Could not load department") },
        { status: 500 }
      );
    }
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }
    if (dept.is_active === false) {
      return NextResponse.json(
        { error: "Department is paused — activate it before adding a bay" },
        { status: 400 }
      );
    }

    const weekLabel = sundayStagingWeekLabel(new Date(), store.timezone);
    const common = {
      department_id: dept.id,
      department_code: String(dept.code ?? "flooring"),
      store_id: store.id,
      store_number: store.store_number,
      specialist_id: specialistId,
      weekLabel,
    };

    if (body.suggest) {
      const suggestion = await suggestExtraPhysicalBay(supabase, common);
      return NextResponse.json(suggestion);
    }

    const result = await dispatchExtraPhysicalBay(supabase, {
      ...common,
      specialist_name: body.specialist_name,
      location_id: body.location_id,
    });

    const http =
      result.status === "ERROR"
        ? 500
        : result.ok || result.status === "ALREADY_COMPLETE"
          ? 200
          : result.status === "PARTIAL"
            ? 409
            : 400;

    return NextResponse.json(result, { status: http });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not dispatch extra bay") },
      { status: 400 }
    );
  }
}
