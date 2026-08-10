import { NextResponse } from "next/server";
import {
  applianceScansToCsv,
  mapApplianceScanRow,
} from "@/lib/appliance-scans";
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

/** GET /api/appliances/scans?store_number=&format=csv */
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
    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    const { data, error } = await supabase
      .from("appliance_scans")
      .select("*")
      .eq("store_number", store)
      .order("scanned_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const scans = (data ?? []).map((row) =>
      mapApplianceScanRow(row as Record<string, unknown>)
    );

    if (format === "csv") {
      const csv = applianceScansToCsv(scans);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="appliance-inventory-${store}.csv"`,
        },
      });
    }

    return NextResponse.json({ store_number: store, scans });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** POST /api/appliances/scans — log a floor scan (requires sub_category) */
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
    const serial_number = String(body.serial_number ?? "").trim();
    const location = String(body.location ?? "").trim();
    const scanned_by = String(body.scanned_by ?? "").trim();

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

    const payload = {
      id: body.id ? String(body.id) : undefined,
      store_number: store,
      item_number,
      serial_number,
      location,
      category,
      sub_category,
      scanned_by,
      scanned_at: body.scanned_at
        ? String(body.scanned_at)
        : new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("appliance_scans")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      scan: mapApplianceScanRow((data ?? payload) as Record<string, unknown>),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** DELETE /api/appliances/scans?id=&store_number= */
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
      .from("appliance_scans")
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
