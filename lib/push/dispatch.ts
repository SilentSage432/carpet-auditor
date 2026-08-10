/**
 * Server-side Web Push dispatch — sends encrypted pushes via web-push + VAPID.
 * Ownership: push delivery only; rotation knowledge stays in lib/store-ops.
 */

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getVapidPrivateKey,
  getVapidPublicKey,
  getVapidSubject,
  isWebPushConfigured,
} from "./vapid";
import type {
  PushSubscriptionJSON,
  PushSubscriptionRow,
  RotationPushPayload,
} from "./types";

let vapidReady = false;

function ensureVapid(): boolean {
  if (!isWebPushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      getVapidSubject(),
      getVapidPublicKey()!,
      getVapidPrivateKey()!
    );
    vapidReady = true;
  }
  return true;
}

function asSubscriptionJSON(raw: unknown): PushSubscriptionJSON | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const endpoint = String(obj.endpoint ?? "");
  const keys = obj.keys as Record<string, unknown> | undefined;
  const p256dh = String(keys?.p256dh ?? "");
  const auth = String(keys?.auth ?? "");
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function upsertPushSubscription(
  supabase: SupabaseClient,
  input: {
    subscription: PushSubscriptionJSON;
    userId?: string | null;
    specialistId?: string | null;
    departmentCode?: string | null;
  }
): Promise<PushSubscriptionRow> {
  try {
    const row = {
      endpoint: input.subscription.endpoint,
      subscription_json: input.subscription,
      user_id: input.userId ?? null,
      specialist_id: input.specialistId ?? null,
      department_code: input.departmentCode ?? null,
    };

    const { data, error } = await supabase
      .from("push_subscriptions")
      .upsert(row, { onConflict: "endpoint" })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as PushSubscriptionRow;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Push subscription save failed";
    throw new Error(`Push subscription upsert failed: ${message}`);
  }
}

export async function deletePushSubscription(
  supabase: SupabaseClient,
  endpoint: string,
  specialistId?: string | null
): Promise<void> {
  let query = supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (specialistId) {
    query = query.eq("specialist_id", specialistId);
  }
  const { error } = await query;
  if (error) throw new Error(error.message);
}

/**
 * Load subscriptions for a department: hub department_code match and/or
 * profiles.assigned_department_id → user_id.
 */
export async function loadSubscriptionsForDepartment(
  supabase: SupabaseClient,
  departmentId: string,
  departmentCode: string | null
): Promise<PushSubscriptionRow[]> {
  const byCode: PushSubscriptionRow[] = [];

  if (departmentCode) {
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("department_code", departmentCode);
    if (error) throw new Error(error.message);
    byCode.push(...((data ?? []) as PushSubscriptionRow[]));
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("assigned_department_id", departmentId)
    .eq("role", "department_supervisor");

  if (profileError) throw new Error(profileError.message);

  const profileIds = (profiles ?? []).map((p) => p.id as string);
  let byProfile: PushSubscriptionRow[] = [];
  if (profileIds.length > 0) {
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .in("user_id", profileIds);
    if (error) throw new Error(error.message);
    byProfile = (data ?? []) as PushSubscriptionRow[];
  }

  const map = new Map<string, PushSubscriptionRow>();
  for (const row of [...byCode, ...byProfile]) {
    map.set(row.endpoint, row);
  }
  return [...map.values()];
}

export type DispatchResult = {
  attempted: number;
  delivered: number;
  failed: number;
  removed: number;
};

export async function dispatchPushToSubscriptions(
  supabase: SupabaseClient,
  rows: PushSubscriptionRow[],
  payload: RotationPushPayload
): Promise<DispatchResult> {
  if (!ensureVapid()) {
    return { attempted: 0, delivered: 0, failed: 0, removed: 0 };
  }

  const body = JSON.stringify(payload);
  let delivered = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    rows.map(async (row) => {
      const sub =
        asSubscriptionJSON(row.subscription_json) ??
        asSubscriptionJSON({
          endpoint: row.endpoint,
          keys: (row.subscription_json as PushSubscriptionJSON)?.keys,
        });
      if (!sub) {
        failed += 1;
        return;
      }

      try {
        await webpush.sendNotification(sub, body, {
          TTL: 60 * 60 * 12,
          urgency: "high",
          topic: "rotation-batch",
        });
        delivered += 1;
      } catch (err: unknown) {
        failed += 1;
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        // Gone / expired subscription — prune
        if (statusCode === 404 || statusCode === 410) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", row.endpoint);
          removed += 1;
        }
      }
    })
  );

  return {
    attempted: rows.length,
    delivered,
    failed,
    removed,
  };
}

export async function notifyDepartmentRotationBatch(
  supabase: SupabaseClient,
  input: {
    departmentId: string;
    departmentCode?: string | null;
    departmentName?: string | null;
    assignedWeek: string;
    bayCount: number;
  }
): Promise<DispatchResult> {
  let code = input.departmentCode ?? null;
  let name = input.departmentName ?? null;

  if (!code || !name) {
    const { data } = await supabase
      .from("departments")
      .select("code, name")
      .eq("id", input.departmentId)
      .maybeSingle();
    code = code ?? data?.code ?? null;
    name = name ?? data?.name ?? "your department";
  }

  const rows = await loadSubscriptionsForDepartment(
    supabase,
    input.departmentId,
    code
  );

  if (rows.length === 0) {
    return { attempted: 0, delivered: 0, failed: 0, removed: 0 };
  }

  const payload: RotationPushPayload = {
    title: "New weekly rotation batch",
    body: `${name}: ${input.bayCount} bay${
      input.bayCount === 1 ? "" : "s"
    } assigned for ${input.assignedWeek}. Open your Zebra checklist.`,
    url: "/dashboard",
    tag: `rotation-${code ?? input.departmentId}-${input.assignedWeek}`,
    department_id: input.departmentId,
    department_code: code ?? undefined,
    assigned_week: input.assignedWeek,
    bay_count: input.bayCount,
  };

  return dispatchPushToSubscriptions(supabase, rows, payload);
}
