import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { notifyDepartmentRotationBatch } from "@/lib/push/dispatch";
import { isWebPushConfigured } from "@/lib/push/vapid";
import { runWeeklyRotationForAllDepartments } from "@/lib/store-ops/rotations";
import { sundayStagingWeekLabel } from "@/lib/store-ops/sunday-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * GET /api/cron/weekly-rotation
 * Vercel Cron — Sunday 11:00 UTC (Hobby: once per day). Per-store auto-stage
 * still honors stores.sunday_auto_stage_time + timezone. Protected by CRON_SECRET.
 */
export async function GET(request: Request) {
  try {
    if (!authorizeCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!url || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Missing required Supabase server keys in environment variables",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const now = new Date();
    const results = await runWeeklyRotationForAllDepartments(
      supabase,
      undefined,
      now
    );

    const pushSummaries: Array<{
      department_code: string;
      delivered: number;
      attempted: number;
    }> = [];

    if (isWebPushConfigured()) {
      for (const row of results) {
        if (!row.ok || row.skipped || !row.created) continue;
        try {
          const push = await notifyDepartmentRotationBatch(supabase, {
            departmentId: row.department_id,
            departmentCode: row.department_code,
            departmentName: row.department_name,
            assignedWeek: row.assigned_week ?? sundayStagingWeekLabel(now),
            bayCount: row.created,
          });
          pushSummaries.push({
            department_code: row.department_code,
            delivered: push.delivered,
            attempted: push.attempted,
          });
        } catch {
          pushSummaries.push({
            department_code: row.department_code,
            delivered: 0,
            attempted: 0,
          });
        }
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const createdTotal = results.reduce(
      (sum, r) => sum + (r.created ?? 0),
      0
    );
    const skippedTotal = results.filter((r) => r.skipped).length;

    return NextResponse.json({
      ok: true,
      evaluated_at: now.toISOString(),
      departments_processed: results.length,
      departments_ok: okCount,
      skipped: skippedTotal,
      bays_assigned: createdTotal,
      results,
      push: pushSummaries,
    });
  } catch (error: unknown) {
    const err = error as { message?: string } | null | undefined;
    return NextResponse.json(
      {
        success: false,
        error: err?.message || String(error),
      },
      { status: 500 }
    );
  }
}
