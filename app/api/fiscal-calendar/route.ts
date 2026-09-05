/**
 * GET /api/fiscal-calendar?date=YYYY-MM-DD
 * Supervisor+ — resolve authoritative fiscal context for a store-local date.
 * Optional: omit date → use store timezone "today".
 * Additive context only — does not affect ISO rotation identity.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import {
  isFiscalCalendarUnavailable,
  parseOperationalDate,
  resolveFiscalContextForDate,
} from "@/lib/store-ops/fiscal-calendar";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { normalizeStoreTimezone } from "@/lib/store-ops/sunday-schedule";
import { readableError } from "@/lib/store-ops/errors";

export async function GET(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");

    let storeTimezone = "America/Denver";
    try {
      const store = await resolveStoreByNumber(supabase, actor.storeNumber);
      storeTimezone = normalizeStoreTimezone(store.timezone);
    } catch {
      // Store lookup failure should not invent fiscal context; still try date param.
    }

    const resolveInput =
      dateParam && dateParam.trim()
        ? (() => {
            const parsed = parseOperationalDate(dateParam);
            if (!parsed) {
              return null;
            }
            return { operationalDate: parsed };
          })()
        : { instant: new Date(), timeZone: storeTimezone };

    if (resolveInput === null) {
      return NextResponse.json(
        { error: "Invalid date; expected YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const ctx = await resolveFiscalContextForDate(supabase, resolveInput);

    if (ctx.status === "calendar_unavailable") {
      return NextResponse.json(
        {
          status: "calendar_unavailable",
          operational_date: ctx.operational_date,
          reason: ctx.reason,
          iso_rotation_unaffected: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ...ctx,
      store_timezone: storeTimezone,
      iso_rotation_unaffected: true,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isFiscalCalendarUnavailable(err)) {
      return NextResponse.json(
        {
          status: "calendar_unavailable",
          reason: "Fiscal calendar schema unavailable",
          iso_rotation_unaffected: true,
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: readableError(err, "Fiscal calendar lookup failed") },
      { status: 500 }
    );
  }
}
