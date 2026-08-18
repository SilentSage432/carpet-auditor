import { NextResponse } from "next/server";
import { normalizeAisle } from "@/lib/store-ops/aisle";
import { parseBayNumberingPattern } from "@/lib/store-ops/bay-pattern";
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
import { bulkInsertLocations } from "@/lib/store-ops/locations";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import type { StoreLocationType } from "@/lib/store-ops/types";
import { parseLocationWorkflowType } from "@/lib/store-ops/types";
import { parseVelocitySeedPreset } from "@/lib/store-ops/velocity";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({
          error: STORE_OPS_AUTH_HINT,
          created: 0,
          locations: [],
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

    const body = (await request.json()) as {
      department_id?: string;
      aisle?: string | number;
      start_bay?: number;
      end_bay?: number;
      types?: StoreLocationType[];
      store_id?: string;
      bay_pattern?: string;
      velocity_seed?: string;
      workflow_type?: string;
    };

    const departmentId = String(body.department_id ?? "");
    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const { data: dept, error: deptError } = await supabase
      .from("departments")
      .select("id, store_id")
      .eq("id", departmentId)
      .eq("store_id", body.store_id?.trim() || store.id)
      .maybeSingle();

    if (deptError) {
      return NextResponse.json(
        { error: readableError(deptError, "Could not load department") },
        { status: 500 }
      );
    }
    if (!dept) {
      return NextResponse.json(
        { error: "Department not found for this store" },
        { status: 404 }
      );
    }

    const locations = await bulkInsertLocations(supabase, {
      store_id: dept.store_id as string,
      department_id: departmentId,
      aisle: normalizeAisle(body.aisle),
      start_bay: Number(body.start_bay),
      end_bay: Number(body.end_bay),
      types: Array.isArray(body.types) ? body.types : [],
      bay_pattern: parseBayNumberingPattern(body.bay_pattern),
      velocity_seed: parseVelocitySeedPreset(body.velocity_seed),
      workflow_type: parseLocationWorkflowType(body.workflow_type),
    });

    return NextResponse.json({
      created: locations.length,
      store_id: dept.store_id,
      locations,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[store-locations/bulk]", err);
    return NextResponse.json(
      {
        error: readableError(
          err,
          "Bulk location generate failed — check department, aisle/bay range, and unique constraints"
        ),
      },
      { status: 400 }
    );
  }
}
