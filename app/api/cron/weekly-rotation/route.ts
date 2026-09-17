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
 * Vercel Cron — Sunday 11:00 UTC (Hobby: once per day ≈ 05:00 America/Denver MDT).
 * ENGINE-PROD-002: Stage+Assign zero-touch weekly plans (not stage-only).
 * Per-store gate honors sunday_auto_stage_time + timezone, with cron-compatible
 * fallback when a late stage time can never be reached by this single cron.
 * Protected by CRON_SECRET.
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
        if (
          row.dispatch_status &&
          row.dispatch_status !== "COMPLETE" &&
          row.dispatch_status !== "INSUFFICIENT_BAYS"
        ) {
          continue;
        }
        try {
          const push = await notifyDepartmentRotationBatch(supabase, {
            departmentId: row.department_id,
            departmentCode: row.department_code,
            departmentName: row.department_name,
            assignedWeek: row.assigned_week ?? sundayStagingWeekLabel(now),
            bayCount: row.owned ?? row.created,
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
    const ownedTotal = results.reduce((sum, r) => sum + (r.owned ?? 0), 0);
    const skippedTotal = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({
      ok: failed.length === 0,
      evaluated_at: now.toISOString(),
      departments_processed: results.length,
      departments_ok: okCount,
      departments_failed: failed.length,
      skipped: skippedTotal,
      bays_staged: createdTotal,
      bays_owned: ownedTotal,
      /** @deprecated use bays_owned — historically meant staged count, not person ownership */
      bays_assigned: ownedTotal,
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
