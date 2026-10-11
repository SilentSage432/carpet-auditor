/**
 * DEPTSYNC-CLEANUP-002 — Guided workspace cleanup API.
 *
 * MasterAdmin only. Soft-retire aisles + soft-archive associates.
 * Never hard-deletes. Store scope from actor, never from client body.
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
import { readableError } from "@/lib/store-ops/errors";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import {
  archiveCleanupAssociates,
  buildAisleCleanupPreview,
  buildAssociateCleanupPreview,
  composeCleanupAisleInventory,
  composeCleanupAssociateInventory,
  parseCleanupAisleKeys,
  parseCleanupSpecialistIds,
  retireCleanupAisles,
} from "@/lib/store-ops/workspace-cleanup";

export async function GET(request: Request) {
  try {
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({
          error: STORE_OPS_AUTH_HINT,
          aisles: [],
          associates: [],
        }),
        { status: 401 }
      );
    }
    requireSuperAdmin(actor);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);

    const [deptRes, locRes, rosterRes] = await Promise.all([
      supabase
        .from("departments")
        .select("*")
        .eq("store_id", store.id)
        .order("name"),
      supabase.from("store_locations").select("*").eq("store_id", store.id),
      supabase
        .from("store_specialists")
        .select(
          "id, name, role, assigned_department, home_department, floor_title, is_active, status, store_number"
        )
        .eq("store_number", actor.storeNumber)
        .eq("is_active", true)
        .order("name"),
    ]);

    if (deptRes.error) {
      return NextResponse.json(
        { error: readableError(deptRes.error, "Could not load departments") },
        { status: 500 }
      );
    }
    if (locRes.error) {
      return NextResponse.json(
        { error: readableError(locRes.error, "Could not load locations") },
        { status: 500 }
      );
    }
    if (rosterRes.error) {
      return NextResponse.json(
        { error: readableError(rosterRes.error, "Could not load roster") },
        { status: 500 }
      );
    }

    const departments = (deptRes.data ?? []) as Department[];
    const locations = (locRes.data ?? []) as StoreLocation[];
    const aisles = composeCleanupAisleInventory({ locations, departments });
    const associates = composeCleanupAssociateInventory(rosterRes.data ?? []);

    return NextResponse.json({
      store_number: actor.storeNumber,
      store_id: store.id,
      aisles,
      associates,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Workspace cleanup inventory failed") },
      { status: 500 }
    );
  }
}

type CleanupBody = {
  action?: string;
  aisle_keys?: unknown;
  specialist_ids?: unknown;
  fingerprint?: unknown;
  confirm?: unknown;
};

export async function POST(request: Request) {
  try {
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({
          error: STORE_OPS_AUTH_HINT,
        }),
        { status: 401 }
      );
    }
    requireSuperAdmin(actor);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const body = (await request.json()) as CleanupBody;
    const action = String(body.action ?? "").trim();
    const confirmed = body.confirm === true;
    const fingerprint = String(body.fingerprint ?? "").trim();

    if (
      action === "preview_aisles" ||
      action === "retire_aisles"
    ) {
      const parsed = parseCleanupAisleKeys(body.aisle_keys);
      if (parsed.error) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }

      const { data: departments, error: deptError } = await supabase
        .from("departments")
        .select("*")
        .eq("store_id", store.id);
      if (deptError) {
        return NextResponse.json(
          { error: readableError(deptError, "Could not load departments") },
          { status: 500 }
        );
      }

      const storeDeptIds = new Set(
        ((departments ?? []) as Department[]).map((d) => d.id)
      );
      for (const key of parsed.keys) {
        if (!storeDeptIds.has(key.department_id)) {
          return NextResponse.json(
            { error: "Aisle department is outside this store" },
            { status: 403 }
          );
        }
      }

      if (action === "preview_aisles") {
        const preview = await buildAisleCleanupPreview(supabase, {
          storeId: store.id,
          departments: (departments ?? []) as Department[],
          keys: parsed.keys,
        });
        return NextResponse.json({ action, preview });
      }

      if (!confirmed) {
        return NextResponse.json(
          { error: "Explicit confirm: true is required to retire aisles" },
          { status: 400 }
        );
      }
      if (!fingerprint) {
        return NextResponse.json(
          { error: "Preview fingerprint is required" },
          { status: 400 }
        );
      }

      const outcome = await retireCleanupAisles(supabase, {
        storeId: store.id,
        keys: parsed.keys,
        fingerprint,
      });
      return NextResponse.json({
        action,
        ...outcome,
        complete_success: outcome.ok && !outcome.partial,
      });
    }

    if (
      action === "preview_associates" ||
      action === "archive_associates"
    ) {
      const parsed = parseCleanupSpecialistIds(body.specialist_ids);
      if (parsed.error) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }

      if (action === "preview_associates") {
        const built = await buildAssociateCleanupPreview(supabase, {
          storeNumber: actor.storeNumber,
          specialistIds: parsed.ids,
        });
        if ("error" in built) {
          return NextResponse.json(
            { error: built.error, protected_ids: built.protectedIds },
            { status: built.status }
          );
        }
        return NextResponse.json({ action, preview: built.preview });
      }

      if (!confirmed) {
        return NextResponse.json(
          { error: "Explicit confirm: true is required to archive associates" },
          { status: 400 }
        );
      }
      if (!fingerprint) {
        return NextResponse.json(
          { error: "Preview fingerprint is required" },
          { status: 400 }
        );
      }

      const outcome = await archiveCleanupAssociates(supabase, {
        storeNumber: actor.storeNumber,
        specialistIds: parsed.ids,
        fingerprint,
      });
      if ("error" in outcome) {
        return NextResponse.json(
          { error: outcome.error },
          { status: outcome.status }
        );
      }
      return NextResponse.json({
        action,
        ...outcome,
        complete_success: outcome.ok && !outcome.partial,
      });
    }

    return NextResponse.json(
      {
        error:
          "Unknown action. Use preview_aisles, retire_aisles, preview_associates, or archive_associates.",
      },
      { status: 400 }
    );
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Workspace cleanup failed") },
      { status: 500 }
    );
  }
}
