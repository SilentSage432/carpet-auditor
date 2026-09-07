import { NextResponse } from "next/server";
import { mapApplianceCatalogRow } from "@/lib/appliance-catalog";
import { mapApplianceScanRow } from "@/lib/appliance-scans";
import {
  APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT,
  composeApplianceAuditConsiderations,
} from "@/lib/appliances/audit-consideration";
import {
  mapApplianceAuditSessionRow,
  mapApplianceReconciliationSnapshotRow,
} from "@/lib/appliances/physical-audit";
import { actorBoundStoreNumber } from "@/lib/store-ops/appliance-store-scope";
import {
  requireStoreOpsActor,
  resolveStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

/**
 * GET /api/appliances/audits/consideration
 * APP-ROT-001 — derived consideration list (not persisted).
 * Evidence: CLOSED sessions + audit-bound scans + Option B snapshots + last observed.
 */
export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const store = actorBoundStoreNumber(
      actor,
      url.searchParams.get("store_number")
    );
    const limitRaw = url.searchParams.get("limit");
    let limit = APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT;
    if (limitRaw != null && limitRaw !== "") {
      const limitParsed = Math.floor(Number(limitRaw));
      if (Number.isFinite(limitParsed)) {
        // 0 = return all eligible (UI truncates for the home strip).
        limit = limitParsed > 0 ? limitParsed : 0;
      }
    }

    const { data: sessionRows, error: sessionError } = await supabase
      .from("appliance_audit_sessions")
      .select("*")
      .eq("store_number", store)
      .eq("status", "CLOSED")
      .order("closed_at", { ascending: false })
      .limit(50);

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    const sessions = (sessionRows ?? []).map((row) =>
      mapApplianceAuditSessionRow(row as Record<string, unknown>)
    );
    const sessionIds = sessions.map((s) => s.id);

    if (sessionIds.length === 0) {
      const empty = composeApplianceAuditConsiderations({
        sessions: [],
        scans: [],
        snapshots: [],
        limit,
      });
      return NextResponse.json({
        store_number: store,
        ...empty,
      });
    }

    const [
      { data: boundScanRows, error: boundScanError },
      { data: snapRows, error: snapError },
      { data: observationRows, error: observationError },
      catalogResult,
    ] = await Promise.all([
      supabase
        .from("appliance_scans")
        .select("item_number, scanned_at, audit_session_id")
        .eq("store_number", store)
        .in("audit_session_id", sessionIds),
      supabase
        .from("appliance_reconciliation_snapshots")
        .select("*")
        .eq("store_number", store)
        .in("audit_session_id", sessionIds),
      // Last-observed may include unbound / ad-hoc scans (distinct from CLOSED inclusion).
      supabase
        .from("appliance_scans")
        .select("item_number, scanned_at, audit_session_id")
        .eq("store_number", store)
        .order("scanned_at", { ascending: false })
        .limit(2000),
      supabase.from("appliance_catalog").select("*").eq("store_number", store),
    ]);

    if (boundScanError) {
      return NextResponse.json(
        { error: boundScanError.message },
        { status: 500 }
      );
    }
    if (snapError) {
      return NextResponse.json({ error: snapError.message }, { status: 500 });
    }
    if (observationError) {
      return NextResponse.json(
        { error: observationError.message },
        { status: 500 }
      );
    }

    const catalogRows =
      catalogResult.error &&
      /store_number/i.test(String(catalogResult.error.message ?? ""))
        ? []
        : catalogResult.data;

    const boundScans = (boundScanRows ?? []).map((row) => {
      const mapped = mapApplianceScanRow(row as Record<string, unknown>);
      return {
        item_number: mapped.item_number,
        scanned_at: mapped.scanned_at,
        audit_session_id: mapped.audit_session_id ?? null,
      };
    });

    const observationScans = (observationRows ?? []).map((row) => {
      const mapped = mapApplianceScanRow(row as Record<string, unknown>);
      return {
        item_number: mapped.item_number,
        scanned_at: mapped.scanned_at,
        audit_session_id: mapped.audit_session_id ?? null,
      };
    });

    // Bound scans drive CLOSED membership counts; unbound observations only
    // enrich lastObservedAt (composer ignores unbound for inclusion).
    const sessionIdSet = new Set(sessionIds);
    const scans = [
      ...boundScans,
      ...observationScans.filter((obs) => {
        const sid = String(obs.audit_session_id ?? "").trim();
        return !sid || !sessionIdSet.has(sid);
      }),
    ];

    const snapshots = (snapRows ?? []).map((row) =>
      mapApplianceReconciliationSnapshotRow(row as Record<string, unknown>)
    );
    const catalog = (catalogRows ?? []).map((row) => {
      const mapped = mapApplianceCatalogRow(row as Record<string, unknown>);
      return {
        item_number: mapped.item_number,
        description: mapped.description,
        category: mapped.category,
      };
    });

    const composed = composeApplianceAuditConsiderations({
      sessions,
      scans,
      snapshots,
      catalog,
      limit,
    });

    return NextResponse.json({
      store_number: store,
      ...composed,
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
