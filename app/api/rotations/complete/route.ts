import { NextResponse } from "next/server";
import type { BayAuditIssue } from "@/lib/ai/contracts/bay-audit";
import {
  isDeptFloorActor,
  resolveStoreOpsActor,
  requireStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  fetchBayAuditLog,
  markBayAuditOverride,
} from "@/lib/store-ops/bay-audit-logs";
import { assertActorCanAccessDepartmentId } from "@/lib/store-ops/department-scope";
import { completeWeeklyRotation } from "@/lib/store-ops/rotations";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * POST /api/rotations/complete
 * Body: {
 *   rotation_id: uuid,
 *   audit_verdict?: 'PASS' | 'CONDITIONAL' | 'FAIL',
 *   audit_log_id?: uuid,
 *   supervisor_override?: boolean
 * }
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const body = (await request.json()) as {
      rotation_id?: string;
      audit_verdict?: string;
      audit_log_id?: string;
      supervisor_override?: boolean;
    };

    const rotationId = body.rotation_id?.trim();
    if (!rotationId) {
      return NextResponse.json(
        { error: "rotation_id is required" },
        { status: 400 }
      );
    }

    const auditVerdict = String(body.audit_verdict ?? "")
      .trim()
      .toUpperCase();
    const auditLogId = body.audit_log_id?.trim() || "";
    const supervisorOverride = body.supervisor_override === true;

    let expectedDepartmentId: string | null = null;

    const { data: rotation, error: rotationError } = await supabase
      .from("weekly_rotations")
      .select("id, department_id, is_completed")
      .eq("id", rotationId)
      .maybeSingle();

    if (rotationError) {
      return NextResponse.json({ error: rotationError.message }, { status: 500 });
    }
    if (!rotation) {
      return NextResponse.json({ error: "Rotation not found" }, { status: 404 });
    }

    if (isDeptFloorActor(actor)) {
      await assertActorCanAccessDepartmentId(
        supabase,
        actor,
        store.id,
        String(rotation.department_id ?? "")
      );
      expectedDepartmentId = String(rotation.department_id ?? "");
    }

    let issues: BayAuditIssue[] = [];
    let resolvedVerdict = auditVerdict;

    if (auditLogId) {
      const log = await fetchBayAuditLog(supabase, auditLogId);
      if (log) {
        issues = Array.isArray(log.detected_issues)
          ? (log.detected_issues as BayAuditIssue[])
          : [];
        if (!resolvedVerdict) resolvedVerdict = String(log.verdict ?? "").toUpperCase();
      }
    }

    if (resolvedVerdict === "FAIL" && !supervisorOverride) {
      return NextResponse.json(
        {
          ok: false,
          gated: true,
          issues,
          audit_verdict: "FAIL",
          audit_log_id: auditLogId || null,
          message:
            "Bay audit failed — fix issues or request supervisor override before completing",
        },
        { status: 422 }
      );
    }

    if (supervisorOverride) {
      requireSupervisorOrAdmin(actor);
      if (auditLogId) {
        await markBayAuditOverride(
          supabase,
          auditLogId,
          actor.specialistId || null
        );
      }
    }

    const result = await completeWeeklyRotation(
      supabase,
      rotationId,
      expectedDepartmentId
    );

    return NextResponse.json({
      ok: true,
      ...result,
      audit_verdict: resolvedVerdict || null,
      supervisor_override: supervisorOverride,
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
