/**
 * DEPTSYNC-ROTATION-AUTO-008A — standing weekly capacity policy API.
 *
 * GET: active standing policy for the actor's store.
 * POST: MasterAdmin establish/replace standing policy (prospective).
 * DELETE: MasterAdmin revoke active standing policy.
 */

import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  STORE_OPS_AUTH_HINT,
  storeOpsAuthRequiredBody,
} from "@/lib/store-ops/auth-soft";
import { readableError } from "@/lib/store-ops/errors";
import {
  establishStandingCapacityPolicy,
  loadActiveStandingCapacityPolicy,
  revokeActiveStandingCapacityPolicy,
  validateStandingPolicyItems,
} from "@/lib/store-ops/standing-week-capacity";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    await createSupabaseServerClient();
    const actor = await resolveStoreOpsActor(request);
    if (!actor) {
      return NextResponse.json(
        storeOpsAuthRequiredBody({ policy: null }),
        { status: 401 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const loaded = await loadActiveStandingCapacityPolicy(
      supabase,
      actor.storeNumber
    );
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: 500 });
    }
    if (!loaded.schema_ready) {
      return NextResponse.json(
        {
          policy: null,
          schema_ready: false,
          auth_hint: STORE_OPS_AUTH_HINT,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      policy: loaded.policy,
      schema_ready: true,
      auth_hint: STORE_OPS_AUTH_HINT,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not load standing capacity policy") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await createSupabaseServerClient();
    const resolved = await resolveStoreOpsActor(request);
    const actor = requireSuperAdmin(resolved);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      items?: Array<{ specialist_id?: unknown; approved_capacity?: unknown }>;
      note?: string | null;
    };

    const validated = validateStandingPolicyItems(body.items ?? []);
    if (!validated.ok) {
      return NextResponse.json(
        { error: validated.error, code: validated.code },
        { status: 400 }
      );
    }

    const result = await establishStandingCapacityPolicy(supabase, {
      store_number: actor.storeNumber,
      established_by_specialist_id: actor.specialistId,
      items: validated.items,
      note: body.note ?? "AUTO-008A standing weekly capacity",
    });

    if (!result.ok) {
      const status =
        result.code === "STANDING_CAPACITY_SCHEMA_MISSING" ? 503 : 400;
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, policy: result.policy });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: readableError(err, "Could not establish standing capacity policy"),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await createSupabaseServerClient();
    const resolved = await resolveStoreOpsActor(request);
    const actor = requireSuperAdmin(resolved);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: supabaseAdminMissingMessage() },
        { status: 503 }
      );
    }

    const result = await revokeActiveStandingCapacityPolicy(supabase, {
      store_number: actor.storeNumber,
    });
    if (!result.ok) {
      const status =
        result.code === "STANDING_CAPACITY_SCHEMA_MISSING" ? 503 : 400;
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, revoked: true });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: readableError(err, "Could not revoke standing capacity policy") },
      { status: 500 }
    );
  }
}
