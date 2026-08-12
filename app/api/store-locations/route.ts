import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireSuperAdmin,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { storeOpsAuthRequiredBody } from "@/lib/store-ops/auth-soft";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { resolveDepartmentIdByCode } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    // Cookie-bound client for SSR / cookie Auth; Bearer still preferred from client.
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({
          store_id: null,
          locations: [],
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
    const storeIdParam = url.searchParams.get("store_id");

    const storeId =
      actor.role === "super_admin" && storeIdParam
        ? storeIdParam
        : store.id;

    let query = supabase
      .from("store_locations")
      .select("*")
      .eq("store_id", storeId)
      .order("aisle")
      .order("bay");

    if (isDeptFloorActor(actor)) {
      if (!actor.departmentCode) {
        return NextResponse.json({ error: "No department assigned" }, { status: 403 });
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
      query = query.eq("department_id", deptId);
    } else if (departmentIdParam) {
      query = query.eq("department_id", departmentIdParam);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      store_id: storeId,
      locations: data ?? [],
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({
          store_id: null,
          locations: [],
          hint: err.message,
        })
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    // Associates mark bays via /api/rotations/complete — not location admin PATCH.
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const body = (await request.json()) as {
      id?: string;
      is_active?: boolean;
      status?: string;
      location_type?: "STANDARD" | "SHOWROOM_STACKOUT";
      audit_frequency_days?: number;
    };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("store_locations")
      .select("*")
      .eq("id", body.id)
      .eq("store_id", store.id)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    if (actor.role === "department_supervisor") {
      const deptId = actor.departmentCode
        ? await resolveDepartmentIdByCode(
            supabase,
            actor.departmentCode,
            store.id
          )
        : null;
      if (!deptId || existing.department_id !== deptId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Supervisors may only toggle bay is_active
      if (
        body.location_type !== undefined ||
        body.audit_frequency_days !== undefined ||
        body.status !== undefined
      ) {
        return NextResponse.json(
          { error: "Only Super Admin can edit zone / status fields" },
          { status: 403 }
        );
      }
    } else {
      requireSuperAdmin(actor);
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (body.status === "PENDING" || body.status === "ASSIGNED" || body.status === "COMPLETED") {
      if (actor.role === "super_admin") patch.status = body.status;
    }
    if (actor.role === "super_admin") {
      if (
        body.location_type === "STANDARD" ||
        body.location_type === "SHOWROOM_STACKOUT"
      ) {
        patch.location_type = body.location_type;
      }
      if (body.audit_frequency_days !== undefined) {
        const days = Math.floor(Number(body.audit_frequency_days));
        if (!Number.isFinite(days) || days < 1) {
          return NextResponse.json(
            { error: "audit_frequency_days must be ≥ 1" },
            { status: 400 }
          );
        }
        patch.audit_frequency_days = days;
      }
    }

    const { data, error } = await supabase
      .from("store_locations")
      .update(patch)
      .eq("id", body.id)
      .eq("store_id", store.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ location: data });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
