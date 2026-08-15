import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  composeAccessibleDepartments,
  parseAccessibleDepartments,
} from "@/lib/department-access";
import { toStoreOpsDepartmentCode } from "@/lib/store-ops/department-codes";
import { isMissingColumnError, readableError } from "@/lib/store-ops/errors";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import {
  isDepartmentScope,
  type DepartmentScope,
  type OperationalDepartment,
} from "@/lib/types";

/**
 * POST /api/admin/department-access
 * Body: { specialist_id, accessible_departments, assigned_department? }
 * Instant upsert of cross-department grants on store_specialists + profiles.
 */
export async function POST(request: Request) {
  try {
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
      specialist_id?: string;
      accessible_departments?: unknown;
      assigned_department?: string | null;
    };

    const specialistId = String(body.specialist_id ?? "").trim();
    if (!specialistId) {
      return NextResponse.json(
        { error: "specialist_id is required" },
        { status: 400 }
      );
    }

    const { data: member, error: fetchError } = await supabase
      .from("store_specialists")
      .select("*")
      .eq("id", specialistId)
      .eq("store_number", store.store_number)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: readableError(fetchError, "Could not load roster member") },
        { status: 500 }
      );
    }
    if (!member) {
      return NextResponse.json(
        { error: "Roster member not found" },
        { status: 404 }
      );
    }

    const role = String(member.role ?? "");
    if (role === "MasterAdmin") {
      return NextResponse.json(
        { error: "Master Admin already has full-store access" },
        { status: 400 }
      );
    }

    if (actor.role === "department_supervisor" && role !== "Associate") {
      return NextResponse.json(
        { error: "Supervisors may only grant access on associates" },
        { status: 403 }
      );
    }

    const primaryRaw =
      body.assigned_department !== undefined
        ? body.assigned_department
        : member.assigned_department;
    const primary: DepartmentScope =
      primaryRaw && isDepartmentScope(primaryRaw) && primaryRaw !== "all"
        ? primaryRaw
        : "flooring";

    const granted = parseAccessibleDepartments(body.accessible_departments);
    const accessible: OperationalDepartment[] = composeAccessibleDepartments(
      primary,
      granted
    );
    const storeOpsCodes = accessible
      .map((scope) => toStoreOpsDepartmentCode(scope))
      .filter((code): code is string => Boolean(code));

    const specialistPatch: Record<string, unknown> = {
      assigned_department: primary,
      accessible_departments: accessible,
    };

    let { error: specialistError } = await supabase
      .from("store_specialists")
      .update(specialistPatch)
      .eq("id", specialistId)
      .eq("store_number", store.store_number);

    if (
      specialistError &&
      isMissingColumnError(specialistError, "accessible_departments")
    ) {
      const retry = await supabase
        .from("store_specialists")
        .update({ assigned_department: primary })
        .eq("id", specialistId)
        .eq("store_number", store.store_number);
      specialistError = retry.error;
    }

    if (specialistError) {
      return NextResponse.json(
        {
          error: readableError(
            specialistError,
            "Could not update accessible departments"
          ),
        },
        { status: 500 }
      );
    }

    const profilePatch: Record<string, unknown> = {
      accessible_departments: storeOpsCodes,
    };
    let { error: profileError } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("specialist_id", specialistId)
      .eq("store_number", store.store_number);

    if (
      profileError &&
      isMissingColumnError(profileError, "accessible_departments")
    ) {
      profileError = null;
    }

    if (profileError) {
      console.warn(
        "[department-access] profiles sync failed",
        profileError.message
      );
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("specialist_id", specialistId)
      .eq("store_number", store.store_number);

    for (const profile of profiles ?? []) {
      const userId = String(profile.id ?? "");
      if (!userId) continue;
      await supabase.auth.admin.updateUserById(userId, {
        app_metadata: {
          accessible_departments: storeOpsCodes,
          department: toStoreOpsDepartmentCode(primary),
        },
      }).catch((err: unknown) => {
        console.warn("[department-access] JWT metadata sync failed", err);
      });
    }

    const { data: saved } = await supabase
      .from("store_specialists")
      .select("*")
      .eq("id", specialistId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      specialist: saved,
      accessible_departments: accessible,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }
}
