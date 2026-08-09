import { NextResponse } from "next/server";
import { notifyDepartmentRotationBatch } from "@/lib/push/dispatch";
import { isWebPushConfigured } from "@/lib/push/vapid";
import { runWeeklyRotationForAllDepartments } from "@/lib/store-ops/rotations";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { isoWeekLabel } from "@/lib/store-ops/week";

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
 * Vercel Cron — Sunday 23:59 UTC. Protected by CRON_SECRET Bearer token.
 */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: supabaseAdminMissingMessage() },
      { status: 503 }
    );
  }

  const weekLabel = isoWeekLabel();
  const results = await runWeeklyRotationForAllDepartments(supabase, weekLabel);

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
          assignedWeek: row.assigned_week ?? weekLabel,
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
  const createdTotal = results.reduce((sum, r) => sum + (r.created ?? 0), 0);

  return NextResponse.json({
    ok: true,
    assigned_week: weekLabel,
    departments_processed: results.length,
    departments_ok: okCount,
    bays_assigned: createdTotal,
    results,
    push: pushSummaries,
  });
}
