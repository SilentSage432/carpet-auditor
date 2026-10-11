/**
 * GET /api/walkthroughs — inbox (store-scoped)
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { resolveStoreByNumber } from "@/lib/store-ops/stores";
import {
  listWalkthroughInbox,
  todayIsoDateInTimeZone,
} from "@/lib/store-ops/walkthroughs";
import { readableError } from "@/lib/store-ops/errors";

export async function GET(request: Request) {
  try {
    const actor = requireStoreOpsActor(await resolveStoreOpsActor(request));
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const store = await resolveStoreByNumber(supabase, actor.storeNumber);
    const timezone = String(
      (store as { timezone?: string | null }).timezone ?? "UTC"
    );
    const result = await listWalkthroughInbox(supabase, {
      store_id: store.id,
      todayIsoDate: todayIsoDateInTimeZone(new Date(), timezone),
    });

    if (!result.ok) {
      const status =
        result.code === "missing_relation"
          ? 503
          : result.code === "list_failed"
            ? 500
            : 400;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      inbox: result.value,
      store_id: store.id,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Failed to load walkthroughs") },
      { status: 500 }
    );
  }
}
