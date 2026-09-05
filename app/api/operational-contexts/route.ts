/**
 * GET /api/operational-contexts
 * Supervisor+ — list / resolve declared seasons & events for actor store.
 * Query: ?date=YYYY-MM-DD&department_code=flooring&mode=resolve|list
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import {
  isOperationalContextUnavailable,
  listOperationalContextsForStore,
  resolveOperationalContextsForDate,
} from "@/lib/store-ops/operational-context";
import { parseOperationalDate } from "@/lib/store-ops/fiscal-calendar";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import { normalizeStoreTimezone } from "@/lib/store-ops/sunday-schedule";
import { readableError } from "@/lib/store-ops/errors";

export async function GET(request: Request) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const url = new URL(request.url);
    const mode = (url.searchParams.get("mode") ?? "resolve").trim();
    const dateParam = url.searchParams.get("date");
    const departmentCode = url.searchParams.get("department_code");

    if (mode === "list") {
      const listed = await listOperationalContextsForStore(supabase, store.id);
      if (!listed.ok) {
        if ("missingRelation" in listed && listed.missingRelation) {
          return NextResponse.json({
            contexts: [],
            relevance: [],
            schema_unavailable: true,
          });
        }
        return NextResponse.json(
          {
            error:
              "error" in listed ? listed.error : "Failed to list contexts",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({
        store_id: store.id,
        store_number: store.store_number,
        contexts: listed.contexts,
        relevance: listed.relevance,
      });
    }

    const timeZone = normalizeStoreTimezone(store.timezone);
    const resolveInput =
      dateParam && dateParam.trim()
        ? (() => {
            const parsed = parseOperationalDate(dateParam);
            if (!parsed) return null;
            return {
              operationalDate: parsed,
              storeId: store.id,
              departmentCode,
            };
          })()
        : {
            instant: new Date(),
            timeZone,
            storeId: store.id,
            departmentCode,
          };

    if (resolveInput === null) {
      return NextResponse.json(
        { error: "Invalid date; expected YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const result = await resolveOperationalContextsForDate(
      supabase,
      resolveInput
    );
    if (!result.ok) {
      if ("missingRelation" in result && result.missingRelation) {
        return NextResponse.json({
          ...result.result,
          store_timezone: timeZone,
          schema_unavailable: true,
        });
      }
      return NextResponse.json(
        {
          error:
            "error" in result ? result.error : "Failed to resolve contexts",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...result.result,
      store_timezone: timeZone,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isOperationalContextUnavailable(err)) {
      return NextResponse.json({
        operational_date: null,
        active_seasons: [],
        active_events: [],
        schema_unavailable: true,
      });
    }
    return NextResponse.json(
      { error: readableError(err, "Operational context lookup failed") },
      { status: 500 }
    );
  }
}
