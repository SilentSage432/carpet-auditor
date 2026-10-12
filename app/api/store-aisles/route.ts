/**
 * DEPTSYNC-TOPOLOGY-REGISTRY-003 — store_aisles registry API.
 *
 * GET: authenticated store-scoped list (service-role after actor resolve).
 * POST: MasterAdmin create empty location (no bay rows).
 * Authenticated client writes remain denied at Postgres RLS.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
  isDeptFloorActor,
} from "@/lib/store-ops/auth-server";
import {
  STORE_OPS_AUTH_HINT,
  storeOpsAuthRequiredBody,
} from "@/lib/store-ops/auth-soft";
import {
  assertActorCanAccessDepartmentId,
  resolveScopedDepartmentId,
} from "@/lib/store-ops/department-scope";
import { readableError } from "@/lib/store-ops/errors";
import {
  createStoreAisleRecord,
  listStoreAisles,
  StoreAisleConflictError,
  validateStoreAisleIdentifier,
} from "@/lib/store-ops/store-aisles";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({
          store_id: null,
          aisles: [],
        })
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const departmentIdParam = url.searchParams.get("department_id");
    const includeRetired =
      url.searchParams.get("include_retired") === "1" ||
      url.searchParams.get("include_retired") === "true";

    let departmentFilter: string | null = null;
    if (isDeptFloorActor(actor)) {
      departmentFilter = await resolveScopedDepartmentId(
        supabase,
        actor,
        store.id,
        departmentIdParam
      );
    } else if (departmentIdParam) {
      departmentFilter = departmentIdParam;
    }

    if (departmentFilter) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        departmentFilter
      );
      const { data: dept } = await supabase
        .from("departments")
        .select("id")
        .eq("id", departmentFilter)
        .eq("store_id", store.id)
        .maybeSingle();
      if (!dept) {
        return NextResponse.json(
          { error: "Department not found for this store" },
          { status: 404 }
        );
      }
    }

    const aisles = await listStoreAisles(supabase, {
      storeId: store.id,
      departmentId: departmentFilter,
      includeRetired,
    });

    return NextResponse.json({
      store_id: store.id,
      aisles,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[store-aisles GET]", err);
    return NextResponse.json(
      { error: readableError(err, "Could not load store aisles") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({
          error: STORE_OPS_AUTH_HINT,
          aisle: null,
        }),
        { status: 401 }
      );
    }
    requireSuperAdmin(actor);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as {
      department_id?: string;
      aisle?: string;
      display_name?: string | null;
      store_id?: string;
    };

    // Never trust client store_id for mutation scope.
    if (body.store_id && String(body.store_id).trim() !== store.id) {
      return NextResponse.json(
        { error: "Cross-store mutation is not allowed" },
        { status: 403 }
      );
    }

    const departmentId = String(body.department_id ?? "").trim();
    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const validated = validateStoreAisleIdentifier({
      aisle: body.aisle,
      display_name: body.display_name,
    });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { data: dept, error: deptError } = await supabase
      .from("departments")
      .select("id, store_id")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();

    if (deptError) {
      return NextResponse.json(
        { error: readableError(deptError, "Could not load department") },
        { status: 500 }
      );
    }
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

    const aisle = await createStoreAisleRecord(supabase, {
      store_id: store.id,
      department_id: departmentId,
      aisle: validated.aisle,
      display_name: validated.display_name,
    });

    return NextResponse.json({ aisle }, { status: 201 });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof StoreAisleConflictError) {
      return NextResponse.json(
        { error: err.message, existing: err.existing },
        { status: 409 }
      );
    }
    console.error("[store-aisles POST]", err);
    return NextResponse.json(
      {
        error: readableError(err, "Could not create location"),
      },
      { status: 400 }
    );
  }
}
