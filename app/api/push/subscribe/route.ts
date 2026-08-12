import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";
import {
  deletePushSubscription,
  upsertPushSubscription,
} from "@/lib/push/dispatch";
import type { PushSubscriptionJSON } from "@/lib/push/types";
import { supabaseAdminMissingMessage } from "@/lib/supabase/env";

function isValidSubscription(raw: unknown): raw is PushSubscriptionJSON {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  const keys = obj.keys as Record<string, unknown> | undefined;
  return (
    typeof obj.endpoint === "string" &&
    obj.endpoint.length > 0 &&
    typeof keys?.p256dh === "string" &&
    typeof keys?.auth === "string"
  );
}

/**
 * POST /api/push/subscribe
 * Body: { subscription: PushSubscriptionJSON }
 * Saves endpoint for the signed-in Auth profile (user_id = profiles.id).
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

    const body = (await request.json()) as { subscription?: unknown };
    if (!isValidSubscription(body.subscription)) {
      return NextResponse.json(
        { error: "Valid PushSubscription JSON is required" },
        { status: 400 }
      );
    }

    const row = await upsertPushSubscription(supabase, {
      subscription: body.subscription,
      specialistId: null,
      departmentCode: actor.departmentCode,
      userId: actor.userId,
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Subscribe failed" },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/push/subscribe
 * Body: { endpoint: string }
 */
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

    const body = (await request.json()) as { endpoint?: string };
    const endpoint = body.endpoint?.trim();
    if (!endpoint) {
      return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    }

    await deletePushSubscription(supabase, endpoint, actor.userId ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unsubscribe failed" },
      { status: 400 }
    );
  }
}
