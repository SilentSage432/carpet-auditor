import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { readableError } from "@/lib/store-ops/errors";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import {
  ensureDepartmentsForStore,
  resolveStoreByNumber,
} from "@/lib/store-ops/stores";

export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    await ensureDepartmentsForStore(supabase, store.id);

    let query = supabase
      .from("departments")
      .select("*")
      .eq("store_id", store.id)
      .order("name");

    if (actor.role === "department_supervisor" && actor.departmentCode) {
      query = query.eq("code", actor.departmentCode);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        {
          error: readableError(error, "Could not load departments"),
          hint:
            "If this mentions schema cache, confirm departments exists in THIS Supabase project (API URL must match .env.local) and apply 20260809_multi_store.sql.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      store_id: store.id,
      store_number: store.store_number,
      departments: data ?? [],
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[departments GET]", err);
    return NextResponse.json(
      { error: readableError(err, "Could not load departments") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/departments
 * Body: { weekly_bay_target: number, department_id?: uuid }
 * Supervisors update their assigned department target; super admin may pass department_id.
 * Persists via upsert on departments.id.
 */
export async function PATCH(request: Request) {
  try {
    const actor = requireStoreOpsActor(parseStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const body = (await request.json()) as {
      weekly_bay_target?: number;
      department_id?: string;
      is_active?: boolean;
    };

    const target = Number(body.weekly_bay_target);
    if (!Number.isFinite(target) || target < 1 || target > 500) {
      return NextResponse.json(
        { error: "weekly_bay_target must be an integer from 1–500" },
        { status: 400 }
      );
    }

    let departmentId = body.department_id?.trim() || "";

    if (actor.role === "department_supervisor") {
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
        return NextResponse.json(
          { error: "You can only update your assigned department" },
          { status: 403 }
        );
      }
      departmentId = ownId;
    } else {
      requireSuperAdmin(actor);
      if (!departmentId) {
        return NextResponse.json(
          { error: "department_id is required for super admin" },
          { status: 400 }
        );
      }
    }

    // Ensure the row belongs to the active store before upserting by id
    const { data: existing, error: existingError } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("store_id", store.id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: readableError(existingError, "Could not load department") },
        { status: 500 }
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }

    const targetNumber = Math.floor(target);
    const payload: {
      id: string;
      weekly_bay_target: number;
      is_active?: boolean;
    } = {
      id: departmentId,
      weekly_bay_target: targetNumber,
    };
    if (actor.role === "super_admin" && typeof body.is_active === "boolean") {
      payload.is_active = body.is_active;
    }

    const { data, error } = await supabase
      .from("departments")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: readableError(error, "Could not save weekly bay target") },
        { status: 500 }
      );
    }

    return NextResponse.json({ department: data });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[departments PATCH]", err);
    return NextResponse.json(
      { error: readableError(err, "Update failed") },
      { status: 400 }
    );
  }
}
