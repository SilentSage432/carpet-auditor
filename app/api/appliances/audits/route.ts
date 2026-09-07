import { NextResponse } from "next/server";
import {
  mapApplianceAuditSessionRow,
  type ApplianceAuditSession,
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

function actorLabel(actor: StoreOpsActor): string {
  return String(actor.specialistId || actor.userId || "").trim() || "unknown";
}

/** GET /api/appliances/audits — list sessions; ?status=ACTIVE for current. */
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
    const status = String(url.searchParams.get("status") ?? "")
      .trim()
      .toUpperCase();

    let query = supabase
      .from("appliance_audit_sessions")
      .select("*")
      .eq("store_number", store)
      .order("started_at", { ascending: false })
      .limit(50);

    if (status === "ACTIVE" || status === "CLOSED") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sessions = (data ?? []).map((row) =>
      mapApplianceAuditSessionRow(row as Record<string, unknown>)
    );
    return NextResponse.json({ store_number: store, sessions });
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

/** POST /api/appliances/audits — start ACTIVE physical audit (Supervisor+). */
export async function POST(request: Request) {
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

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const store = actorBoundStoreNumber(
      actor,
      body.store_number != null ? String(body.store_number) : null
    );
    const notes = String(body.notes ?? "").trim();

    const { data: existing } = await supabase
      .from("appliance_audit_sessions")
      .select("id")
      .eq("store_number", store)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (existing?.id) {
      return NextResponse.json(
        {
          error: "An active physical audit already exists for this store",
          session_id: existing.id,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("appliance_audit_sessions")
      .insert({
        store_number: store,
        status: "ACTIVE",
        started_at: now,
        started_by: actorLabel(actor),
        notes,
        created_at: now,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const session: ApplianceAuditSession = mapApplianceAuditSessionRow(
      data as Record<string, unknown>
    );
    return NextResponse.json({ session }, { status: 201 });
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
