/**
 * DEPTSYNC-SECTION-ROTATION-005 — weekly capacity review + approval API.
 *
 * GET: schedule evidence + approval status for a store week.
 * POST: MasterAdmin explicit capacity approval (service-role RPC after auth).
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  STORE_OPS_AUTH_HINT,
  storeOpsAuthRequiredBody,
} from "@/lib/store-ops/auth-soft";
import {
  buildWeekCapacityReviewBoard,
  loadWeekCapacityApprovals,
  validateCapacityApprovalItem,
  writeWeekCapacityApprovals,
  type ApprovedCapacityValue,
} from "@/lib/store-ops/approved-week-capacity";
import { readableError } from "@/lib/store-ops/errors";
import {
  loadStoreWeekAssignments,
  resolveCapacityOwnerId,
} from "@/lib/store-ops/shared-week-capacity";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { storeNumberQueryValues } from "@/lib/store";
import { isoWeekCalendarRange, isoWeekToMondayDate } from "@/lib/store-ops/week";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function loadReviewExtras(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  storeNumber: string,
  weekLabel: string
) {
  const range = isoWeekCalendarRange(weekLabel);
  const keys = storeNumberQueryValues(storeNumber);
  const [workforceRes, shiftsRes, assignments, approvals] = await Promise.all([
    supabase
      .from("store_specialists")
      .select("id, name, role, is_active, home_department, assigned_department")
      .in("store_number", keys)
      .eq("is_active", true),
    supabase
      .from("associate_shift_days")
      .select(
        "specialist_id, work_date, start_time, end_time, is_scheduled_today, is_call_out, status"
      )
      .in("store_number", keys)
      .gte("work_date", range.startDate)
      .lte("work_date", range.endDate),
    loadStoreWeekAssignments(supabase, storeNumber, weekLabel),
    loadWeekCapacityApprovals(supabase, storeNumber, weekLabel),
  ]);
  if (workforceRes.error) throw new Error(workforceRes.error.message);
  if (shiftsRes.error) throw new Error(shiftsRes.error.message);

  const owned_by_specialist: Record<string, number> = {};
  for (const row of assignments) {
    const owner = resolveCapacityOwnerId(row);
    if (!owner) continue;
    owned_by_specialist[owner] = (owned_by_specialist[owner] ?? 0) + 1;
  }

  return {
    workforce: (workforceRes.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      role: String(row.role ?? "Associate"),
      is_active: row.is_active !== false,
      home_department: row.home_department as string | null | undefined,
      assigned_department: row.assigned_department as string | null | undefined,
    })),
    shifts: (shiftsRes.data ?? []).map((row) => ({
      specialist_id: String(row.specialist_id),
      work_date: String(row.work_date),
      start_time: row.start_time as string | null,
      end_time: row.end_time as string | null,
      is_scheduled_today: row.is_scheduled_today as boolean | null | undefined,
      is_call_out: row.is_call_out as boolean | null | undefined,
      status: row.status as string | null | undefined,
    })),
    owned_by_specialist,
    approvals,
  };
}

export async function GET(request: Request) {
  try {
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({ board: null }),
        { status: 401 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const weekLabel = String(url.searchParams.get("week") ?? "").trim();
    if (!weekLabel) {
      return NextResponse.json(
        { error: "week query parameter is required (e.g. 2026-W42)" },
        { status: 400 }
      );
    }

    try {
      isoWeekToMondayDate(weekLabel);
    } catch {
      return NextResponse.json({ error: "Invalid week label" }, { status: 400 });
    }

    const extras = await loadReviewExtras(supabase, actor.storeNumber, weekLabel);
    const board = buildWeekCapacityReviewBoard({
      store_number: actor.storeNumber,
      week_label: weekLabel,
      workforce: extras.workforce,
      persisted_shift_days: extras.shifts,
      approvals: extras.approvals,
      owned_by_specialist: extras.owned_by_specialist,
    });

    return NextResponse.json({ board, auth_hint: STORE_OPS_AUTH_HINT });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = readableError(err, "Could not load weekly capacity review");
    const status = /not migrated|SCHEMA_MISSING/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await createSupabaseServerClient();
    const resolved = await resolveStoreOpsActor(request);
    const actor = requireSuperAdmin(resolved);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      week?: string;
      items?: Array<{ specialist_id?: string; approved_capacity?: unknown }>;
    };
    const weekLabel = String(body.week ?? "").trim();
    if (!weekLabel) {
      return NextResponse.json({ error: "week is required" }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "items[] with specialist_id and approved_capacity required" },
        { status: 400 }
      );
    }

    const extras = await loadReviewExtras(supabase, actor.storeNumber, weekLabel);
    const board = buildWeekCapacityReviewBoard({
      store_number: actor.storeNumber,
      week_label: weekLabel,
      workforce: extras.workforce,
      persisted_shift_days: extras.shifts,
      approvals: extras.approvals,
      owned_by_specialist: extras.owned_by_specialist,
    });
    const byId = new Map(
      board.associates.map((row) => [row.specialist_id, row])
    );

    const validated: Array<{
      specialist_id: string;
      approved_capacity: ApprovedCapacityValue;
      schedule_fingerprint: string;
    }> = [];

    for (const item of body.items) {
      const sid = String(item.specialist_id ?? "").trim();
      const draft = byId.get(sid);
      if (!draft) {
        return NextResponse.json(
          { error: `Unknown or inactive associate: ${sid}` },
          { status: 400 }
        );
      }
      const capacityRaw =
        typeof item.approved_capacity === "string" ||
        typeof item.approved_capacity === "number"
          ? Number(item.approved_capacity)
          : item.approved_capacity;
      const check = validateCapacityApprovalItem({
        specialist_id: sid,
        approved_capacity: capacityRaw,
        eligible: draft.eligible,
        owned_count: draft.owned_count,
        schedule_fingerprint: draft.schedule_fingerprint,
        live_fingerprint: draft.schedule_fingerprint,
      });
      if (!check.ok) {
        return NextResponse.json(
          { error: check.error, code: check.code },
          { status: 400 }
        );
      }
      validated.push({
        specialist_id: sid,
        approved_capacity: check.capacity,
        schedule_fingerprint: draft.schedule_fingerprint,
      });
    }

    const result = await writeWeekCapacityApprovals(supabase, {
      store_number: actor.storeNumber,
      week_label: weekLabel,
      approved_by_specialist_id: actor.specialistId,
      items: validated,
    });

    if (!result.ok) {
      const status =
        result.code === "CAPACITY_STORE_FORBIDDEN"
          ? 403
          : result.code === "CAPACITY_APPROVAL_SCHEMA_MISSING"
            ? 503
            : 400;
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status }
      );
    }

    // AUTO-008A: explicit weekly approve is stronger than standing materialization.
    const { recordWeekCapacityApprovalProvenance, STANDING_CAPACITY_SOURCE_EXPLICIT } =
      await import("@/lib/store-ops/standing-week-capacity");
    await recordWeekCapacityApprovalProvenance(supabase, {
      store_number: actor.storeNumber,
      week_label: weekLabel,
      specialist_ids: validated.map((item) => item.specialist_id),
      source: STANDING_CAPACITY_SOURCE_EXPLICIT,
    });

    const refreshed = await loadReviewExtras(
      supabase,
      actor.storeNumber,
      weekLabel
    );
    const nextBoard = buildWeekCapacityReviewBoard({
      store_number: actor.storeNumber,
      week_label: weekLabel,
      workforce: refreshed.workforce,
      persisted_shift_days: refreshed.shifts,
      approvals: refreshed.approvals,
      owned_by_specialist: refreshed.owned_by_specialist,
    });

    return NextResponse.json({
      ok: true,
      written: result.written,
      board: nextBoard,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not approve weekly capacity") },
      { status: 500 }
    );
  }
}
