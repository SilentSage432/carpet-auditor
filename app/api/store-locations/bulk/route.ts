import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { bulkInsertLocations } from "@/lib/store-ops/locations";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import type { StoreLocationType } from "@/lib/store-ops/types";

export async function POST(request: Request) {
  try {
    requireSuperAdmin(parseStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      department_id?: string;
      aisle?: number;
      start_bay?: number;
      end_bay?: number;
      types?: StoreLocationType[];
    };

    const locations = await bulkInsertLocations(supabase, {
      department_id: String(body.department_id ?? ""),
      aisle: Number(body.aisle),
      start_bay: Number(body.start_bay),
      end_bay: Number(body.end_bay),
      types: Array.isArray(body.types) ? body.types : [],
    });

    return NextResponse.json({
      created: locations.length,
      locations,
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
