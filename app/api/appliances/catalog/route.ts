import { NextResponse } from "next/server";
import { mapApplianceCatalogRow } from "@/lib/appliance-catalog";
import { actorBoundStoreNumber } from "@/lib/store-ops/appliance-store-scope";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import {
  isValidApplianceSubCategory,
  normalizeApplianceCategory,
  resolveApplianceCategoryPair,
} from "@/lib/types";

/** GET /api/appliances/catalog — authenticated; store scoped; public catalog fields only. */
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
      url.searchParams.get("store_number") ??
        request.headers.get("x-store-number")
    );
    const { data, error } = await supabase
      .from("appliance_catalog")
      .select("id, store_number, item_number, description, category, sub_category, created_at, updated_at")
      .eq("store_number", store)
      .order("item_number");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      store_number: store,
      items: (data ?? []).map((row) =>
        mapApplianceCatalogRow(row as Record<string, unknown>)
      ),
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

/**
 * POST /api/appliances/catalog — upsert public catalog metadata.
 * Does not accept durable physical scan identifiers (use teach-scan).
 */
export async function POST(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const store = actorBoundStoreNumber(
      actor,
      body.store_number != null ? String(body.store_number) : null
    );
    const item_number = String(body.item_number ?? "").trim();
    const description = String(body.description ?? "").trim();

    if (
      body.upc != null ||
      body.teach_identifier != null ||
      body.identifier != null ||
      body.scan_fingerprint != null
    ) {
      return NextResponse.json(
        {
          error:
            "Physical scan identifiers are not accepted on catalog upsert; use teach-scan",
        },
        { status: 400 }
      );
    }

    const pair = resolveApplianceCategoryPair(
      body.category,
      body.sub_category
    );
    const category = normalizeApplianceCategory(pair.category);
    const sub_category = pair.sub_category;

    if (!item_number) {
      return NextResponse.json(
        { error: "item_number is required" },
        { status: 400 }
      );
    }
    if (!isValidApplianceSubCategory(category, sub_category)) {
      return NextResponse.json(
        { error: "Valid sub_category is required for the selected category" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const payload = {
      id: body.id ? String(body.id) : undefined,
      store_number: store,
      item_number,
      description,
      category,
      sub_category,
      updated_at: now,
      ...(body.id ? {} : { created_at: now }),
    };

    const { data, error } = await supabase
      .from("appliance_catalog")
      .upsert(payload, { onConflict: "store_number,item_number" })
      .select(
        "id, store_number, item_number, description, category, sub_category, created_at, updated_at"
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      item: mapApplianceCatalogRow((data ?? payload) as Record<string, unknown>),
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

/** DELETE /api/appliances/catalog?id=&store_number= */
export async function DELETE(request: Request) {
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
    const id = url.searchParams.get("id")?.trim();
    const store = actorBoundStoreNumber(
      actor,
      url.searchParams.get("store_number")
    );
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("appliance_catalog")
      .delete()
      .eq("id", id)
      .eq("store_number", store);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
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
