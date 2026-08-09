import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { notifyDepartmentRotationBatch } from "@/lib/push/dispatch";
import { isWebPushConfigured } from "@/lib/push/vapid";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/push/dispatch
 * Super Admin — manually fan out a rotation-batch push to a department.
 * Body: { department_id, assigned_week?, bay_count?, department_code? }
 */
export async function POST(request: Request) {
  try {
    requireSuperAdmin(parseStoreOpsActor(request));
    if (!isWebPushConfigured()) {
      return NextResponse.json(
        { error: "Web Push VAPID keys are not configured" },
        { status: 503 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      department_id?: string;
      department_code?: string;
      assigned_week?: string;
      bay_count?: number;
    };

    const departmentId = body.department_id?.trim();
    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const result = await notifyDepartmentRotationBatch(supabase, {
      departmentId,
      departmentCode: body.department_code ?? null,
      assignedWeek: body.assigned_week ?? "this week",
      bayCount: Number(body.bay_count) || 0,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dispatch failed" },
      { status: 400 }
    );
  }
}
