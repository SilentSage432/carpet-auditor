/**
 * GET  /api/section-week-coverage?week_label=&section_id?=
 * POST /api/section-week-coverage — establish / replace coverage
 * DELETE /api/section-week-coverage — revoke coverage
 *
 * Supervisor or MasterAdmin. Does not mutate permanent primary owners.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import {
  classifyPublishedWeekCoverageRisk,
  establishSectionWeekCoverage,
  listActiveSectionWeekCoverage,
  previewCoverageCapacityImpact,
  revokeSectionWeekCoverage,
} from "@/lib/store-ops/section-week-coverage";
import { listOperationalSections } from "@/lib/store-ops/operational-sections";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { loadStoreWeekCapacity } from "@/lib/store-ops/shared-week-capacity";
import { isoWeekToMondayDate } from "@/lib/store-ops/week";

export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const url = new URL(request.url);
    const weekLabel = String(url.searchParams.get("week_label") ?? "").trim();
    const sectionId = String(url.searchParams.get("section_id") ?? "").trim();
    if (!weekLabel) {
      return NextResponse.json(
        { error: "week_label is required" },
        { status: 400 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const coverage = await listActiveSectionWeekCoverage(supabase, {
      store_id: store.id,
      week_label: weekLabel,
      section_id: sectionId || undefined,
    });

    return NextResponse.json({
      week_label: weekLabel,
      coverage,
      schema_ready: true,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load weekly section coverage") },
      { status: 500 }
    );
  }
}

type PostBody = {
  section_id?: string;
  week_label?: string;
  covering_specialist_id?: string;
  note?: string;
  /** Required when the week already has protected or conflicting assignments. */
  acknowledge_published_week?: boolean;
};

export async function POST(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json()) as PostBody;
    const sectionId = String(body.section_id ?? "").trim();
    const weekLabel = String(body.week_label ?? "").trim();
    const coveringId = String(body.covering_specialist_id ?? "").trim();
    if (!sectionId || !weekLabel || !coveringId) {
      return NextResponse.json(
        {
          error:
            "section_id, week_label, and covering_specialist_id are required",
        },
        { status: 400 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const listed = await listOperationalSections(supabase, {
      store_id: store.id,
      includeMembers: false,
    });
    const sectionMeta = listed.ok
      ? listed.value.find((s) => s.id === sectionId)
      : undefined;
    const permanentOwner = String(
      sectionMeta?.primary_owner_specialist_id ?? ""
    ).trim();

    const existingCoverage = await listActiveSectionWeekCoverage(supabase, {
      store_id: store.id,
      week_label: weekLabel,
      section_id: sectionId,
    });
    const previousEffective =
      (existingCoverage[0]?.covering_specialist_id ?? permanentOwner) || null;

    const weekStarting = isoWeekToMondayDate(weekLabel);
    const { data: assignmentRows } = await supabase
      .from("sunday_bay_assignments")
      .select("roster_specialist_id, status, supervisor_locked")
      .eq("store_number", actor.storeNumber)
      .eq("week_starting", weekStarting)
      .neq("status", "cleared");

    const publishedRisk = classifyPublishedWeekCoverageRisk({
      existing_assignments: (assignmentRows ?? []) as Array<{
        roster_specialist_id: string | null;
        status: string | null;
        supervisor_locked?: boolean | null;
      }>,
      previous_effective_owner_id: previousEffective,
      next_covering_specialist_id: coveringId,
    });

    if (
      publishedRisk.requires_explicit_ack &&
      body.acknowledge_published_week !== true
    ) {
      return NextResponse.json(
        {
          error:
            "Week already has published assignments. Coverage will not rewrite history. Pass acknowledge_published_week=true to save coverage only, then reassign unfinished work explicitly if needed.",
          code: "published_week_ack_required",
          published_week_risk: publishedRisk,
        },
        { status: 409 }
      );
    }

    const row = await establishSectionWeekCoverage(supabase, {
      store_id: store.id,
      store_number: actor.storeNumber,
      section_id: sectionId,
      week_label: weekLabel,
      covering_specialist_id: coveringId,
      established_by_specialist_id: actor.specialistId,
      note: body.note,
    });

    const permanentOwned =
      listed.ok
        ? listed.value
            .filter(
              (s) =>
                s.is_active &&
                String(s.primary_owner_specialist_id ?? "") === coveringId
            )
            .map((s) => s.id)
        : [];

    let approved = 0;
    try {
      const capacity = await loadStoreWeekCapacity(supabase, {
        store_number: actor.storeNumber,
        week_label: weekLabel,
        department_codes: ["flooring"],
      });
      approved = Number(
        capacity.approved_by_specialist?.[coveringId] ?? 0
      );
    } catch {
      approved = 0;
    }

    const impact = previewCoverageCapacityImpact({
      covering_specialist_id: coveringId,
      covering_specialist_name: row.covering_specialist_name ?? coveringId,
      approved_capacity: approved,
      permanent_section_ids: permanentOwned,
      covered_section_ids: [sectionId],
    });

    return NextResponse.json({
      ok: true,
      coverage: row,
      capacity_preview: impact,
      published_week_risk: publishedRisk,
      note: "Permanent section ownership unchanged. Coverage applies only to this week and does not rewrite existing assignments.",
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const status =
      typeof err === "object" &&
      err &&
      "status" in err &&
      typeof (err as { status?: unknown }).status === "number"
        ? Number((err as { status: number }).status)
        : 500;
    return NextResponse.json(
      {
        error: readableError(err, "Could not establish weekly section coverage"),
        code:
          typeof err === "object" && err && "code" in err
            ? String((err as { code?: unknown }).code ?? "")
            : undefined,
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

type DeleteBody = {
  section_id?: string;
  week_label?: string;
};

export async function DELETE(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const body = (await request.json().catch(() => ({}))) as DeleteBody;
    const sectionId = String(body.section_id ?? "").trim();
    const weekLabel = String(body.week_label ?? "").trim();
    if (!sectionId || !weekLabel) {
      return NextResponse.json(
        { error: "section_id and week_label are required" },
        { status: 400 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const result = await revokeSectionWeekCoverage(supabase, {
      store_id: store.id,
      section_id: sectionId,
      week_label: weekLabel,
    });

    return NextResponse.json({
      ok: true,
      revoked: result.revoked,
      note: "Coverage revoked. Permanent ownership restored for future planning of this week.",
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not revoke weekly section coverage") },
      { status: 500 }
    );
  }
}
