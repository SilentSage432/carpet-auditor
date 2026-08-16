import { NextResponse } from "next/server";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireSuperAdmin,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { isValidAisle, normalizeAisle } from "@/lib/store-ops/aisle";
import { storeOpsAuthRequiredBody } from "@/lib/store-ops/auth-soft";
import {
  resolveScopedDepartmentId,
  assertActorCanAccessDepartmentId,
  resolveStoreLocationDepartmentIds,
} from "@/lib/store-ops/department-scope";
import { isMissingColumnError } from "@/lib/store-ops/errors";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseCustomDecayDays,
  parseVelocityTier,
} from "@/lib/store-ops/velocity";

const STORE_LOCATION_LIST_COLUMNS = [
  "id",
  "store_id",
  "department_id",
  "department_code",
  "aisle",
  "bay",
  "type",
  "location_type",
  "status",
  "manual_priority_count",
  "last_completed_at",
  "last_serviced_at",
  "velocity_tier",
  "priority_override",
  "carried_over",
  "last_carried_over_at",
  "custom_decay_days",
  "updated_at",
  "is_active",
  "cycle_number",
  "audit_frequency_days",
] as const;

const OPTIONAL_LIST_COLUMNS = [
  "last_completed_at",
  "last_serviced_at",
  "velocity_tier",
  "priority_override",
  "carried_over",
  "last_carried_over_at",
  "custom_decay_days",
  "department_code",
] as const;

function listSelect(omit: readonly string[]): string {
  return STORE_LOCATION_LIST_COLUMNS.filter(
    (column) => !omit.includes(column)
  ).join(", ");
}

function normalizeStoreLocationRow(row: Record<string, unknown>) {
  return {
    ...row,
    last_completed_at:
      row.last_completed_at == null ? null : String(row.last_completed_at),
    last_serviced_at:
      row.last_serviced_at == null ? null : String(row.last_serviced_at),
    velocity_tier:
      row.velocity_tier == null ? "standard" : String(row.velocity_tier),
    priority_override: Boolean(row.priority_override),
    carried_over: Boolean(row.carried_over),
    last_carried_over_at:
      row.last_carried_over_at == null
        ? null
        : String(row.last_carried_over_at),
    custom_decay_days:
      row.custom_decay_days == null
        ? null
        : Math.floor(Number(row.custom_decay_days)),
    department_code:
      row.department_code == null ? null : String(row.department_code),
  };
}

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

    const departmentIds = await resolveStoreLocationDepartmentIds(
      supabase,
      storeId,
      departmentFilter
    );

    const omitted: string[] = [];
    let data: unknown[] | null = null;
    let error: { message?: string } | null = null;
    for (let attempt = 0; attempt < OPTIONAL_LIST_COLUMNS.length + 1; attempt += 1) {
      // Map/Floor list every mapped tag. Rotation `status` is PENDING|ASSIGNED|
      // COMPLETED|CARRIED_OVER (not ACTIVE). PENDING means available for Sunday
      // draw — never hide those rows. is_active is the pause flag, also unfiltered
      // so Manage can still show paused faces.
      let query = supabase
        .from("store_locations")
        .select(listSelect(omitted))
        .eq("store_id", storeId)
        .order("aisle")
        .order("bay");
      if (departmentIds && departmentIds.length === 1) {
        query = query.eq("department_id", departmentIds[0]);
      } else if (departmentIds && departmentIds.length > 1) {
        query = query.in("department_id", departmentIds);
      }
      const result = await query;
      data = result.data as unknown[] | null;
      error = result.error;
      if (!error) break;
      const missing = OPTIONAL_LIST_COLUMNS.find(
        (column) =>
          !omitted.includes(column) && isMissingColumnError(error, column)
      );
      if (!missing) break;
      omitted.push(missing);
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      store_id: storeId,
      locations: (Array.isArray(data) ? data : []).map((row) =>
        normalizeStoreLocationRow(row as unknown as Record<string, unknown>)
      ),
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
      aisle?: string;
      bay?: number | string;
      type?: "SELLING" | "TOPSTOCK";
      location_type?: "STANDARD" | "SHOWROOM_STACKOUT";
      audit_frequency_days?: number;
      department_id?: string;
      priority_override?: boolean;
      carried_over?: boolean;
      last_carried_over_at?: string | null;
      velocity_tier?: string;
      custom_decay_days?: number | null;
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

    const mapEdit =
      body.location_type !== undefined ||
      body.audit_frequency_days !== undefined ||
      body.aisle !== undefined ||
      body.bay !== undefined ||
      body.type !== undefined ||
      body.department_id !== undefined ||
      body.velocity_tier !== undefined ||
      body.custom_decay_days !== undefined;

    if (actor.role === "department_supervisor") {
      try {
        await assertActorCanAccessDepartmentId(
          supabase,
          actor,
          store.id,
          String(existing.department_id ?? "")
        );
      } catch (err) {
        if (err instanceof StoreOpsAuthError) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        throw err;
      }
      if (mapEdit || (body.status !== undefined && body.status !== "CARRIED_OVER")) {
        return NextResponse.json(
          { error: "Only Super Admin can edit zone / map fields" },
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
    if (body.status === "CARRIED_OVER") {
      patch.status = body.status;
    }
    if (typeof body.priority_override === "boolean") {
      patch.priority_override = body.priority_override;
    }
    if (typeof body.carried_over === "boolean") {
      patch.carried_over = body.carried_over;
      if (body.carried_over && body.last_carried_over_at === undefined) {
        patch.last_carried_over_at = new Date().toISOString();
      }
    }
    if (body.last_carried_over_at !== undefined) {
      patch.last_carried_over_at = body.last_carried_over_at
        ? String(body.last_carried_over_at)
        : null;
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
      if (body.aisle !== undefined) {
        const aisle = normalizeAisle(body.aisle);
        if (!isValidAisle(aisle)) {
          return NextResponse.json(
            { error: "aisle is required (alphanumeric code, e.g. BW, 12, A1)" },
            { status: 400 }
          );
        }
        patch.aisle = aisle;
      }
      if (body.bay !== undefined) {
        const bay = Math.floor(Number(body.bay));
        if (!Number.isFinite(bay) || bay < 0) {
          return NextResponse.json(
            { error: "bay must be an integer ≥ 0" },
            { status: 400 }
          );
        }
        patch.bay = bay;
      }
      if (body.type === "SELLING" || body.type === "TOPSTOCK") {
        patch.type = body.type;
      }
      if (body.velocity_tier !== undefined) {
        patch.velocity_tier = parseVelocityTier(body.velocity_tier);
      }
      if (body.custom_decay_days !== undefined) {
        if (body.custom_decay_days == null) {
          patch.custom_decay_days = null;
        } else {
          const days = parseCustomDecayDays(body.custom_decay_days);
          if (days == null) {
            return NextResponse.json(
              { error: "custom_decay_days must be 3–21" },
              { status: 400 }
            );
          }
          patch.custom_decay_days = days;
        }
      }
      if (body.department_id !== undefined) {
        const nextDeptId = String(body.department_id).trim();
        if (!nextDeptId) {
          return NextResponse.json(
            { error: "department_id is required" },
            { status: 400 }
          );
        }
        const { data: dept, error: deptError } = await supabase
          .from("departments")
          .select("id, code")
          .eq("id", nextDeptId)
          .eq("store_id", store.id)
          .maybeSingle();
        if (deptError) {
          return NextResponse.json(
            { error: deptError.message },
            { status: 500 }
          );
        }
        if (!dept) {
          return NextResponse.json(
            { error: "Department not found for this store" },
            { status: 404 }
          );
        }
        patch.department_id = dept.id;
        patch.department_code = dept.code;
      }
    }

    const nextAisle = String(patch.aisle ?? existing.aisle);
    const nextBay = Number(patch.bay ?? existing.bay);
    const nextType = String(patch.type ?? existing.type);
    const nextDepartmentId = String(
      patch.department_id ?? existing.department_id
    );
    if (
      nextAisle !== String(existing.aisle) ||
      nextBay !== Number(existing.bay) ||
      nextType !== String(existing.type) ||
      nextDepartmentId !== String(existing.department_id)
    ) {
      const { data: clash, error: clashError } = await supabase
        .from("store_locations")
        .select("id")
        .eq("store_id", store.id)
        .eq("department_id", nextDepartmentId)
        .eq("aisle", nextAisle)
        .eq("bay", nextBay)
        .eq("type", nextType)
        .neq("id", body.id)
        .maybeSingle();
      if (clashError) {
        return NextResponse.json({ error: clashError.message }, { status: 500 });
      }
      if (clash) {
        return NextResponse.json(
          {
            error: `A ${nextType} tag already exists for aisle ${nextAisle} bay ${nextBay}`,
          },
          { status: 409 }
        );
      }
    }

    let { data, error } = await supabase
      .from("store_locations")
      .update(patch)
      .eq("id", body.id)
      .eq("store_id", store.id)
      .select("*")
      .single();

    if (
      error &&
      (isMissingColumnError(error, "carried_over") ||
        isMissingColumnError(error, "last_carried_over_at") ||
        isMissingColumnError(error, "custom_decay_days"))
    ) {
      const fallback = { ...patch };
      delete fallback.carried_over;
      delete fallback.last_carried_over_at;
      delete fallback.custom_decay_days;
      const retry = await supabase
        .from("store_locations")
        .update(fallback)
        .eq("id", body.id)
        .eq("store_id", store.id)
        .select("*")
        .single();
      data = retry.data;
      error = retry.error;
    }

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

/**
 * DELETE /api/store-locations
 * Super Admin — hard-delete one or more tags (cascades weekly_rotations).
 * Query: ?id=uuid  Body: { id } or { ids: string[] }
 */
export async function DELETE(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const queryId = url.searchParams.get("id")?.trim() || "";
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      ids?: string[];
    };
    const ids = [
      ...new Set(
        [
          queryId,
          String(body.id ?? "").trim(),
          ...(Array.isArray(body.ids) ? body.ids.map(String) : []),
        ].filter(Boolean)
      ),
    ];
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "id or ids are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("store_locations")
      .delete()
      .eq("store_id", store.id)
      .in("id", ids)
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deletedIds = (data ?? []).map((row) => String(row.id));
    return NextResponse.json({
      ok: true,
      deleted: deletedIds.length,
      pruned: deletedIds.length,
      ids: deletedIds,
    });
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
