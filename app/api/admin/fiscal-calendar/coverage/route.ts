/**
 * GET /api/admin/fiscal-calendar/coverage
 * Master Admin only — derived fiscal calendar coverage (FS-001A).
 * Read-only; no import, discovery, or mutation.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import {
  computeFiscalCoverage,
  isFiscalCalendarUnavailable,
  parseOperationalDate,
} from "@/lib/store-ops/fiscal-calendar";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { normalizeStoreTimezone } from "@/lib/store-ops/sunday-schedule";
import { readableError } from "@/lib/store-ops/errors";

export async function GET(request: Request) {
  try {
    const actor = requireSuperAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");

    let storeTimezone = "America/Denver";
    try {
      const store = await resolveStoreByNumber(supabase, actor.storeNumber);
      storeTimezone = normalizeStoreTimezone(store.timezone);
    } catch {
      // Coverage still resolves from date param / default timezone.
    }

    const resolveInput =
      dateParam && dateParam.trim()
        ? (() => {
            const parsed = parseOperationalDate(dateParam);
            if (!parsed) return null;
            return { operationalDate: parsed };
          })()
        : { instant: new Date(), timeZone: storeTimezone };

    if (resolveInput === null) {
      return NextResponse.json(
        { error: "Invalid date; expected YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const result = await computeFiscalCoverage(supabase, resolveInput);

    if (!result.ok) {
      if ("missingRelation" in result && result.missingRelation) {
        return NextResponse.json(
          {
            ...result.coverage,
            store_timezone: storeTimezone,
            iso_rotation_unaffected: true,
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        {
          error:
            "error" in result
              ? result.error
              : "Fiscal coverage lookup failed",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...result.coverage,
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
          status: "EXPIRED",
          operational_date: null,
          current_fiscal_year: null,
          coverage_start_date: null,
          coverage_end_date: null,
          days_remaining: null,
          next_fiscal_year: null,
          next_fiscal_year_loaded: false,
          current_source_type: null,
          reason_codes: ["SCHEMA_UNAVAILABLE", "COVERAGE_EXPIRED"],
          generated_at: new Date().toISOString(),
          iso_rotation_unaffected: true,
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: readableError(err, "Fiscal coverage lookup failed") },
      { status: 500 }
    );
  }
}
