/**
 * GET  /api/roster/lifecycle/[id] — deactivate impact preview
 * POST /api/roster/lifecycle/[id] — deactivate | reactivate
 *
 * Soft lifecycle only. Never hard-deletes. Does not reclaim ownership on
 * reactivate. Does not mutate standing capacity rows.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import {
  deactivateRosterAssociate,
  loadDeactivateImpact,
  reactivateRosterAssociate,
  type SectionOwnerTransfer,
} from "@/lib/store-ops/roster-lifecycle";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";

type PostBody = {
  action?: "deactivate" | "reactivate";
  transfers?: Array<{
    section_id?: string;
    new_owner_specialist_id?: string;
  }>;
};

function parseTransfers(body: PostBody): SectionOwnerTransfer[] {
  return (body.transfers ?? [])
    .map((row) => ({
      section_id: String(row.section_id ?? "").trim(),
      new_owner_specialist_id: String(row.new_owner_specialist_id ?? "").trim(),
    }))
    .filter((row) => row.section_id && row.new_owner_specialist_id);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const specialistId = String(id ?? "").trim();
    if (!specialistId) {
      return NextResponse.json({ error: "member id is required" }, { status: 400 });
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const impact = await loadDeactivateImpact(supabase, {
      store_number: actor.storeNumber,
      store_id: store.id,
      specialist_id: specialistId,
    });

    return NextResponse.json({ impact });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Could not load impact";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { error: readableError(err, "Could not load deactivate impact") },
      { status }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const specialistId = String(id ?? "").trim();
    if (!specialistId) {
      return NextResponse.json({ error: "member id is required" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const action = body.action === "reactivate" ? "reactivate" : "deactivate";

    if (action === "reactivate") {
      const result = await reactivateRosterAssociate(supabase, {
        store_number: actor.storeNumber,
        specialist_id: specialistId,
      });
      return NextResponse.json({
        ok: true,
        action: "reactivate",
        specialist_id: result.specialist_id,
        note: "Eligibility restored. Previous section ownership and assignments were not reclaimed.",
      });
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const transfers = parseTransfers(body);
    const result = await deactivateRosterAssociate(supabase, {
      store_number: actor.storeNumber,
      store_id: store.id,
      specialist_id: specialistId,
      acted_by_specialist_id: actor.specialistId,
      transfers,
    });

    return NextResponse.json({
      ok: true,
      action: "deactivate",
      specialist_id: specialistId,
      transferred_section_ids: result.transferred_section_ids,
      impact: result.impact,
      note: "Soft-deactivated. Historical assignments preserved. Standing capacity unchanged.",
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
    const impact =
      typeof err === "object" && err && "impact" in err
        ? (err as { impact: unknown }).impact
        : undefined;
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : undefined;
    return NextResponse.json(
      {
        error: readableError(err, "Roster lifecycle action failed"),
        code,
        impact,
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
