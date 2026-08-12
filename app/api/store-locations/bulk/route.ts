import { NextResponse } from "next/server";
import { normalizeAisle } from "@/lib/store-ops/aisle";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";
import { bulkInsertLocations } from "@/lib/store-ops/locations";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import type { StoreLocationType } from "@/lib/store-ops/types";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

export async function POST(request: Request) {
  try {
    const actor = requireSuperAdmin(await resolveStoreOpsActor(request));
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
