import { NextResponse } from "next/server";
import {
  requireStoreOpsActor,
  requireSupervisorOrAdmin,
  resolveStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { sundayStagingWeekLabel } from "@/lib/store-ops/sunday-schedule";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { confirmSundayBayZebraEntry } from "@/lib/store-ops/zebra-handoff";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/rotations/zebra-entry
 *
 * Operator records that one Sunday bay assignment was manually entered into
 * Lowe's Zebra Dashboard. Not a Zebra integration — no external calls.
 *
 * Body: { bay_id: weekly_rotations.id, assigned_week?: ISO week, department_code?: string }
 */
export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      bay_id?: string;
      assigned_week?: string;
      department_code?: string;
      department_id?: string;
    };

    const bayId = String(body.bay_id ?? "").trim();
    if (!bayId) {
      return NextResponse.json({ error: "bay_id is required" }, { status: 400 });
    }

    const week =
      String(body.assigned_week ?? "").trim() ||
      sundayStagingWeekLabel(new Date(), store.timezone) ||
      isoWeekLabel();

    let departmentCode = String(body.department_code ?? "").trim() || null;
    const departmentId = String(body.department_id ?? "").trim();
    if (!departmentCode && departmentId) {
      const { data: dept } = await supabase
        .from("departments")
        .select("code")
        .eq("id", departmentId)
        .eq("store_id", store.id)
        .maybeSingle();
      departmentCode = dept?.code ? String(dept.code) : null;
    }

    const result = await confirmSundayBayZebraEntry(supabase, actor, {
      storeNumber: store.store_number,
      weekLabel: week,
      bayId,
      departmentCode,
    });

    return NextResponse.json({
      ...result,
      // Explicit boundary: confirmation is operator-recorded only.
      zebra_system: "manual_operator_record",
      note: "Operator-recorded confirmation only — not proof of Zebra acceptance or completion.",
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not confirm Zebra entry") },
      { status: 400 }
    );
  }
}
