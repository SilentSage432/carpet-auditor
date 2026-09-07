import { NextResponse } from "next/server";
import { mapApplianceScanRow } from "@/lib/appliance-scans";
import {
  composeAppliancePhysicalCounts,
  deriveApplianceVariance,
  mapApplianceReconciliationSnapshotRow,
  normalizeApplianceReconOutcome,
} from "@/lib/appliances/physical-audit";
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

/**
 * POST /api/appliances/audits/[id]/reconcile
 * Upsert latest DECLARED Lowe's OH state (Option B — mutable current row per item).
 * Physical count is re-derived from scans on each save. Online-only. No client fallback.
 */
export async function POST(request: Request, context: Ctx) {
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

    const { id: auditId } = await context.params;
    const store = actorBoundStoreNumber(actor, null);
    const body = (await request.json()) as Record<string, unknown>;

    const { data: sessionRow, error: sessionError } = await supabase
      .from("appliance_audit_sessions")
      .select("*")
      .eq("id", auditId)
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
    if (String(sessionRow.status) !== "CLOSED") {
      return NextResponse.json(
        {
          error:
            "Close the physical audit before reconciling with Lowe's OH",
        },
        { status: 409 }
      );
    }

    const itemsRaw = Array.isArray(body.items) ? body.items : null;
    if (!itemsRaw || itemsRaw.length === 0) {
      return NextResponse.json(
        { error: "items array is required" },
        { status: 400 }
      );
    }

    const { data: scanRows, error: scanError } = await supabase
      .from("appliance_scans")
      .select("*")
      .eq("audit_session_id", auditId)
      .eq("store_number", store);

    if (scanError) {
      return NextResponse.json({ error: scanError.message }, { status: 500 });
    }

    const scans = (scanRows ?? []).map((row) =>
      mapApplianceScanRow(row as Record<string, unknown>)
    );
    const physical = composeAppliancePhysicalCounts(scans);
    const physicalByItem = new Map(
      physical.map((row) => [row.item_number, row.physical_count] as const)
    );

    const now = new Date().toISOString();
    const reconciledBy = actorLabel(actor);
    const saved = [];

    for (const raw of itemsRaw) {
      const row = raw as Record<string, unknown>;
      const item_number = String(row.item_number ?? "").trim();
      if (!item_number) {
        return NextResponse.json(
          { error: "item_number is required on each item" },
          { status: 400 }
        );
      }

      const physical_count = physicalByItem.get(item_number);
      if (physical_count == null) {
        return NextResponse.json(
          {
            error: `Item ${item_number} has no observed units in this audit`,
          },
          { status: 400 }
        );
      }

      // Reject attempts to overwrite physical count from the client.
      if (
        row.physical_count != null &&
        Math.floor(Number(row.physical_count)) !== physical_count
      ) {
        return NextResponse.json(
          {
            error:
              "physical_count is derived from observed scans and cannot be set manually",
          },
          { status: 400 }
        );
      }

      const ohPresent =
        row.declared_lowes_oh !== undefined &&
        row.declared_lowes_oh !== null &&
        String(row.declared_lowes_oh).trim() !== "";
      const declared_lowes_oh = ohPresent
        ? Math.floor(Number(row.declared_lowes_oh))
        : null;
      if (
        ohPresent &&
        (!Number.isFinite(declared_lowes_oh) || (declared_lowes_oh as number) < 0)
      ) {
        return NextResponse.json(
          { error: `Invalid declared_lowes_oh for ${item_number}` },
          { status: 400 }
        );
      }

      let outcome;
      try {
        outcome = normalizeApplianceReconOutcome(row.outcome);
      } catch (err) {
        return NextResponse.json(
          {
            error:
              err instanceof Error ? err.message : "Invalid outcome",
          },
          { status: 400 }
        );
      }

      const variance = deriveApplianceVariance(
        physical_count,
        declared_lowes_oh
      );
      const notes = String(row.notes ?? "").trim();

      const payload = {
        audit_session_id: auditId,
        store_number: store,
        item_number,
        physical_count,
        declared_lowes_oh,
        variance,
        outcome,
        notes,
        reconciled_by: reconciledBy,
        reconciled_at: now,
      };

      const { data, error } = await supabase
        .from("appliance_reconciliation_snapshots")
        .upsert(payload, { onConflict: "audit_session_id,item_number" })
        .select("*")
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (data) {
        saved.push(
          mapApplianceReconciliationSnapshotRow(
            data as Record<string, unknown>
          )
        );
      }
    }

    return NextResponse.json({ snapshots: saved });
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
