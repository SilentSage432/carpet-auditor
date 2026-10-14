/**
 * GET  /api/operational-sections — list sections (store-scoped)
 * POST /api/operational-sections — create section (Supervisor/Master)
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import {
  createOperationalSection,
  listOperationalSections,
} from "@/lib/store-ops/operational-sections";
import { assertRosterSpecialistForStore } from "@/lib/store-ops/walkthroughs";
import { readableError } from "@/lib/store-ops/errors";

export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const departmentId = url.searchParams.get("department_id");
    const includeRetired = url.searchParams.get("include_retired") === "1";
    const includeMembers = url.searchParams.get("include_members") !== "0";

    if (departmentId) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        departmentId
      );
    }

    const result = await listOperationalSections(supabase, {
      store_id: store.id,
      department_id: departmentId,
      includeRetired,
      includeMembers,
    });

    if (!result.ok) {
      const status =
        result.code === "missing_relation"
          ? 503
          : result.code === "list_failed" || result.code === "list_members_failed"
            ? 500
            : 400;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      sections: result.value,
      store_id: store.id,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to list operational sections") },
      { status: 500 }
    );
  }
}

type CreateBody = {
  department_id?: string;
  name?: string;
  description?: string | null;
  primary_owner_specialist_id?: string | null;
  members?: Array<{ department_id: string; aisle: string; bay: number }>;
};

export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as CreateBody;
    const departmentId = String(body.department_id ?? "").trim();
    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }
    await assertActorCanAccessDepartmentId(
      supabase,
      actor,
      store.id,
      departmentId
    );

    const ownerCheck = await assertRosterSpecialistForStore(supabase, {
      specialist_id: body.primary_owner_specialist_id,
      store_number: actor.storeNumber,
    });
    if (!ownerCheck.ok) {
      return NextResponse.json(
        { error: ownerCheck.message, code: ownerCheck.code },
        { status: ownerCheck.code === "not_found" ? 404 : 400 }
      );
    }

    const result = await createOperationalSection(supabase, {
      store_id: store.id,
      department_id: departmentId,
      name: String(body.name ?? ""),
      description: body.description,
      primary_owner_specialist_id: body.primary_owner_specialist_id ?? null,
      members: body.members,
      acted_by_specialist_id: actor.specialistId,
    });

    if (!result.ok) {
      const status =
        result.code === "missing_relation"
          ? 503
          : result.code === "validation_failed" ||
              result.code === "duplicate_name" ||
              result.code === "bay_conflict" ||
              result.code === "department_mismatch"
            ? 400
            : 500;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, section: result.value });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to create operational section") },
      { status: 500 }
    );
  }
}
