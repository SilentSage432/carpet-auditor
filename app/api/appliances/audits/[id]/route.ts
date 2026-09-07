import { NextResponse } from "next/server";
import { mapApplianceScanRow } from "@/lib/appliance-scans";
import {
  composeAppliancePhysicalCounts,
  composeApplianceReconciliationProgress,
  countReconciledItems,
  mapApplianceAuditSessionRow,
  mapApplianceReconciliationSnapshotRow,
  summarizeAppliancePhysicalAudit,
} from "@/lib/appliances/physical-audit";
import { mapApplianceCatalogRow } from "@/lib/appliance-catalog";
import { actorBoundStoreNumber } from "@/lib/store-ops/appliance-store-scope";
import {
  requireStoreOpsActor,
  requireSupervisorOrAdmin,
  resolveStoreOpsActor,
  StoreOpsAuthError,
  type StoreOpsActor,
} from "@/lib/store-ops/auth-server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

type Ctx = { params: Promise<{ id: string }> };

function actorLabel(actor: StoreOpsActor): string {
  return String(actor.specialistId || actor.userId || "").trim() || "unknown";
}

/** GET /api/appliances/audits/[id] — session + scans + physical counts + snapshots. */
export async function GET(request: Request, context: Ctx) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const { id } = await context.params;
    const store = actorBoundStoreNumber(actor, null);

    const { data: sessionRow, error: sessionError } = await supabase
      .from("appliance_audit_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }
    if (!sessionRow) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }
    if (String(sessionRow.store_number) !== store) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = mapApplianceAuditSessionRow(
      sessionRow as Record<string, unknown>
    );

    const [{ data: scanRows }, { data: snapRows }, catalogResult] =
      await Promise.all([
        supabase
          .from("appliance_scans")
          .select("*")
          .eq("audit_session_id", id)
          .eq("store_number", store)
          .order("scanned_at", { ascending: false }),
        supabase
          .from("appliance_reconciliation_snapshots")
          .select("*")
          .eq("audit_session_id", id)
          .eq("store_number", store),
        supabase
          .from("appliance_catalog")
          .select("*")
          .eq("store_number", store),
      ]);

    // APP-FIELD-001: production catalog may lack store_number until migration;
    // still return physical counts (descriptions optional).
    const catalogRows =
      catalogResult.error &&
      /store_number/i.test(String(catalogResult.error.message ?? ""))
        ? []
        : catalogResult.data;

    const scans = (scanRows ?? []).map((row) =>
      mapApplianceScanRow(row as Record<string, unknown>)
    );
    const catalog = (catalogRows ?? []).map((row) =>
      mapApplianceCatalogRow(row as Record<string, unknown>)
    );
    const snapshots = (snapRows ?? []).map((row) =>
      mapApplianceReconciliationSnapshotRow(row as Record<string, unknown>)
    );
    const physical_items = composeAppliancePhysicalCounts(scans, catalog);
    const summary = summarizeAppliancePhysicalAudit(scans);
    const recon = countReconciledItems(snapshots);
    const progress = composeApplianceReconciliationProgress(
      physical_items,
      snapshots
    );

    return NextResponse.json({
      session,
      scans,
      physical_items,
      snapshots,
      summary: {
        ...summary,
        reconciled_item_count: recon.with_oh,
        snapshot_row_count: recon.total_snapshot_rows,
        reconciliation: progress,
      },
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** PATCH /api/appliances/audits/[id] — close physical audit (non-destructive). */
export async function PATCH(request: Request, context: Ctx) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const { id } = await context.params;
    const store = actorBoundStoreNumber(actor, null);
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = String(body.action ?? "close").trim().toLowerCase();

    if (action !== "close") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const { data: sessionRow, error: loadError } = await supabase
      .from("appliance_audit_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 });
    }
    if (!sessionRow) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }
    if (String(sessionRow.store_number) !== store) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String(sessionRow.status) === "CLOSED") {
      return NextResponse.json({
        session: mapApplianceAuditSessionRow(
          sessionRow as Record<string, unknown>
        ),
      });
    }

    const now = new Date().toISOString();
    const notes = String(body.notes ?? sessionRow.notes ?? "").trim();
    const { data, error } = await supabase
      .from("appliance_audit_sessions")
      .update({
        status: "CLOSED",
        closed_at: now,
        closed_by: actorLabel(actor),
        notes,
      })
      .eq("id", id)
      .eq("store_number", store)
      .eq("status", "ACTIVE")
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      session: mapApplianceAuditSessionRow(data as Record<string, unknown>),
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
