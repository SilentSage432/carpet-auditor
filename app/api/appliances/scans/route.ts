import { NextResponse } from "next/server";
import {
  applianceScansToCsv,
  mapApplianceScanRow,
} from "@/lib/appliance-scans";
import { storeNumberQueryValues } from "@/lib/store";
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
      console.error("[POST/GET appliances/scans] Supabase admin not configured");
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const store = storeFromRequest(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format");
    const storeKeys = storeNumberQueryValues(store);

    const { data, error } = await supabase
      .from("appliance_scans")
      .select("*")
      .in("store_number", storeKeys.length ? storeKeys : [store])
      .order("scanned_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[GET /api/appliances/scans] select failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const scans = (data ?? []).map((row) =>
      mapApplianceScanRow(row as Record<string, unknown>)
    );

    if (format === "csv") {
      const descriptions: Record<string, string> = {};
      const { data: catalogRows } = await supabase
        .from("appliance_catalog")
        .select("item_number, description")
        .in("store_number", storeKeys.length ? storeKeys : [store]);
      for (const row of catalogRows ?? []) {
        const item = String(
          (row as { item_number?: string }).item_number ?? ""
        ).trim();
        if (item) {
          descriptions[item] = String(
            (row as { description?: string }).description ?? ""
          ).trim();
        }
      }

      const csv = applianceScansToCsv(scans, { descriptions });
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
    console.error("[GET /api/appliances/scans] unexpected", err);
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
      console.error("[POST /api/appliances/scans] Supabase admin not configured");
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

    // Match public.appliance_scans columns exactly — omit id so DB generates uuid.
    const payload: Record<string, string> = {
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
    if (body.id) {
      payload.id = String(body.id);
    }

    console.log("[POST /api/appliances/scans] insert", payload);

    const { data, error } = await supabase
      .from("appliance_scans")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("[POST /api/appliances/scans] insert failed", error);
      throw new Error(error.message);
    }

    if (!data) {
      console.error("[POST /api/appliances/scans] insert returned no row");
      throw new Error("Insert returned no row");
    }

    console.log(
      "[POST /api/appliances/scans] ok",
      (data as { id?: string }).id,
      item_number
    );

    return NextResponse.json({
      scan: mapApplianceScanRow(data as Record<string, unknown>),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/appliances/scans] error", message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/appliances/scans — update serial / location on an existing scan */
export async function PATCH(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const store = String(
      body.store_number ?? storeFromRequest(request)
    ).trim();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, string> = {};
    if (body.serial_number !== undefined) {
      updates.serial_number = String(body.serial_number ?? "").trim();
    }
    if (body.location !== undefined) {
      updates.location = String(body.location ?? "").trim();
    }
    if (body.scanned_by !== undefined) {
      updates.scanned_by = String(body.scanned_by ?? "").trim();
    }
    if (body.category !== undefined || body.sub_category !== undefined) {
      const pair = resolveApplianceCategoryPair(
        body.category,
        body.sub_category
      );
      updates.category = normalizeApplianceCategory(pair.category);
      updates.sub_category = pair.sub_category;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("appliance_scans")
      .update(updates)
      .eq("id", id)
      .eq("store_number", store)
      .select("*")
      .single();

    if (error) {
      console.error("[PATCH /api/appliances/scans] failed", error);
      throw new Error(error.message);
    }

    return NextResponse.json({
      scan: mapApplianceScanRow(data as Record<string, unknown>),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[PATCH /api/appliances/scans] error", message);
    return NextResponse.json({ error: message }, { status: 500 });
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
      console.error("[DELETE /api/appliances/scans] failed", error);
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DELETE /api/appliances/scans] error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
