import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  generateWeeklyRotations,
  resolveDepartmentIdByCode,
  type GenerateRotationsResult,
} from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { notifyDepartmentRotationBatch } from "@/lib/push/dispatch";
import { isWebPushConfigured } from "@/lib/push/vapid";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { sundayStagingWeekLabel } from "@/lib/store-ops/sunday-schedule";

type GenerateBody = {
  department_id?: string;
  department_ids?: string[];
  department_code?: string;
  count?: number;
  bay_count?: number;
  force?: boolean;
  force_overwrite?: boolean;
};

type StoreRow = {
  id: string;
  store_number: string;
  timezone?: string;
};

type DeptRow = {
  id: string;
  store_id: string;
  weekly_bay_target: number | null;
  is_active: boolean | null;
};

function resolveCountOverride(body: GenerateBody): number | null {
  const rawCount = body.bay_count ?? body.count;
  return rawCount != null &&
    Number.isFinite(Number(rawCount)) &&
    Number(rawCount) >= 1
    ? Math.floor(Number(rawCount))
    : null;
}

function resolveForceOverwrite(body: GenerateBody): boolean {
  return body.force_overwrite === true || body.force === true;
}

async function resolveDepartmentIds(
  supabase: SupabaseClient,
  body: GenerateBody,
  storeId: string
): Promise<string[]> {
  const fromArray = (body.department_ids ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
  if (fromArray.length > 0) {
    return [...new Set(fromArray)];
  }

  let departmentId = body.department_id?.trim() || "";
  if (!departmentId && body.department_code) {
    departmentId =
      (await resolveDepartmentIdByCode(
        supabase,
        body.department_code,
        storeId
      )) ?? "";
  }

  return departmentId ? [departmentId] : [];
}

async function loadDepartmentForStore(
  supabase: SupabaseClient,
  storeId: string,
  departmentId: string
): Promise<DeptRow | null> {
  const { data: dept, error: deptError } = await supabase
    .from("departments")
    .select("id, store_id, weekly_bay_target, is_active")
    .eq("id", departmentId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (deptError) throw new Error(deptError.message);
  return dept;
}

async function generateForDepartment(
  supabase: SupabaseClient,
  store: StoreRow,
  departmentId: string,
  countOverride: number | null,
  forceOverwrite: boolean,
  weekLabel: string
): Promise<GenerateRotationsResult> {
  const dept = await loadDepartmentForStore(supabase, store.id, departmentId);
  if (!dept) {
    throw new Error("Department not found for this store");
  }
  if (dept.is_active === false) {
    throw new Error(
      "Department is paused — activate it in Store Map / Settings before generating rotations"
    );
  }

  return generateWeeklyRotations(
    supabase,
    departmentId,
    countOverride,
    weekLabel,
    {
      forceOverwrite,
      skipIfExists: !forceOverwrite,
      store_id: store.id,
      store_number: store.store_number,
    }
  );
}

/**
 * POST /api/rotations/generate
 * Body (single): { department_id: uuid, count?: number, force?: boolean }
 * Body (batch): { department_ids: uuid[], bay_count?: number, force_overwrite?: boolean }
 * Super admin only — picks PENDING bays (auto cycle-reset when exhausted).
 * Without force, an already-staged ISO week is left untouched.
 * force=true (Master Admin) replaces incomplete rows for that week.
 * On success, dispatches Web Push alerts to each department's supervisors.
 */
export async function POST(request: Request) {
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
    const body = (await request.json()) as GenerateBody;
    const departmentIds = await resolveDepartmentIds(
      supabase,
      body,
      store.id
    );

    if (departmentIds.length === 0) {
      return NextResponse.json(
        { error: "department_id or department_ids is required" },
        { status: 400 }
      );
    }

    const countOverride = resolveCountOverride(body);
    const forceOverwrite = resolveForceOverwrite(body);
    const weekLabel = sundayStagingWeekLabel(new Date(), store.timezone);

    if (departmentIds.length === 1) {
      const departmentId = departmentIds[0]!;
      const result = await generateForDepartment(
        supabase,
        store,
        departmentId,
        countOverride,
        forceOverwrite,
        weekLabel
      );

      if (result.skipped) {
        return NextResponse.json({
          ...result,
          created: 0,
          store_id: store.id,
          push: {
            attempted: 0,
            delivered: 0,
            failed: 0,
            removed: 0,
            skipped: true,
          },
        });
      }

      let push = {
        attempted: 0,
        delivered: 0,
        failed: 0,
        removed: 0,
        skipped: !isWebPushConfigured() || result.rotations.length === 0,
      };

      if (isWebPushConfigured() && result.rotations.length > 0) {
        try {
          const dispatch = await notifyDepartmentRotationBatch(supabase, {
            departmentId,
            assignedWeek: result.assigned_week,
            bayCount: result.rotations.length,
          });
          push = { ...dispatch, skipped: false };
        } catch {
          push = { ...push, skipped: false, failed: 1 };
        }
      }

      return NextResponse.json({
        ...result,
        created: result.rotations.length,
        store_id: store.id,
        push,
      });
    }

    const settled = await Promise.allSettled(
      departmentIds.map(async (departmentId) => {
        const result = await generateForDepartment(
          supabase,
          store,
          departmentId,
          countOverride,
          forceOverwrite,
          weekLabel
        );
        return { departmentId, result };
      })
    );

    let success_count = 0;
    let failed_count = 0;
    let staged_bays = 0;
    const failures: Array<{ department_id: string; error: string }> = [];

    for (let i = 0; i < settled.length; i += 1) {
      const departmentId = departmentIds[i]!;
      const entry = settled[i]!;

      if (entry.status === "rejected") {
        failed_count += 1;
        failures.push({
          department_id: departmentId,
          error:
            entry.reason instanceof Error
              ? entry.reason.message
              : "Unknown error",
        });
        continue;
      }

      const { result } = entry.value;
      if (result.skipped) {
        failed_count += 1;
        failures.push({
          department_id: departmentId,
          error: result.reason || "Week already staged.",
        });
        continue;
      }

      success_count += 1;
      staged_bays += result.rotations.length;

      if (isWebPushConfigured() && result.rotations.length > 0) {
        try {
          await notifyDepartmentRotationBatch(supabase, {
            departmentId,
            assignedWeek: result.assigned_week,
            bayCount: result.rotations.length,
          });
        } catch {
          // Push failure does not fail the draw.
        }
      }
    }

    return NextResponse.json({
      success_count,
      failed_count,
      staged_bays,
      assigned_week: weekLabel,
      store_id: store.id,
      failures: failures.length > 0 ? failures : undefined,
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
