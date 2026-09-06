/**
 * GET /api/store-intelligence/attention?department_id=<uuid>
 * Supervisor+ — on-demand SI-001 attention signals for one authorized department.
 * Read-only. No persistence. No rotation writes. No UI.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { resolveScopedDepartmentId } from "@/lib/store-ops/department-scope";
import { composeLocationAttentionRead } from "@/lib/store-ops/location-attention-read-model";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { readableError } from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

export async function GET(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    // Actor store only — never trust client store_id.
    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const departmentIdParam = url.searchParams.get("department_id");

    if (!departmentIdParam || !String(departmentIdParam).trim()) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const departmentId = await resolveScopedDepartmentId(
      supabase,
      actor,
      store.id,
      departmentIdParam
    );
    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const { data: dept, error: deptError } = await supabase
      .from("departments")
      .select("id, code, name")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (deptError) {
      return NextResponse.json(
        { error: readableError(deptError, "Department lookup failed") },
        { status: 500 }
      );
    }
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found" },
        { status: 404 }
      );
    }

    const asOf = new Date();
    const payload = await composeLocationAttentionRead(supabase, {
      storeId: store.id,
      storeTimezone: store.timezone ?? "America/Denver",
      department: {
        id: String(dept.id),
        code: String(dept.code ?? ""),
        name: String(dept.name ?? ""),
      },
      asOf,
    });

    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Failed to compose location attention signals"
        ),
      },
      { status: 500 }
    );
  }
}
