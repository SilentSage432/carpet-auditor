import { NextResponse } from "next/server";
import { mapApplianceCatalogRow } from "@/lib/appliance-catalog";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import {
  isValidApplianceSubCategory,
  normalizeApplianceCategory,
  resolveApplianceCategoryPair,
} from "@/lib/types";

function storeFromRequest(request: Request): string {
  const url = new URL(request.url);
  return (
    request.headers.get("x-store-number")?.trim() ||
    url.searchParams.get("store_number")?.trim() ||
    "0000"
  );
}

/** GET /api/appliances/catalog?store_number= */
export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = storeFromRequest(request);
    const { data, error } = await supabase
      .from("appliance_catalog")
      .select("*")
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** POST /api/appliances/catalog — upsert UPC↔Item link with required sub_category */
export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const store = String(
      body.store_number ?? storeFromRequest(request)
    ).trim();
    const item_number = String(body.item_number ?? "").trim();
    const description = String(body.description ?? "").trim();
    const upcRaw = body.upc;
    const upc =
      upcRaw == null || upcRaw === ""
        ? null
        : String(upcRaw).replace(/\D/g, "").replace(/^0+/, "") || null;

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
      upc,
      description,
      category,
      sub_category,
      updated_at: now,
      ...(body.id ? {} : { created_at: now }),
    };

    const { data, error } = await supabase
      .from("appliance_catalog")
      .upsert(payload, { onConflict: "store_number,item_number" })
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      item: mapApplianceCatalogRow((data ?? payload) as Record<string, unknown>),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** DELETE /api/appliances/catalog?id=&store_number= */
export async function DELETE(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    const store = storeFromRequest(request);
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
