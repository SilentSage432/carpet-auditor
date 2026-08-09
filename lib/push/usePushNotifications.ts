"use client";

/**
 * Client hook — enable/disable Web Push for weekly rotation alerts.
 * Composes hub specialist session + /api/push/subscribe.
 */

import { useCallback, useEffect, useState } from "react";
import type { StoreSpecialist } from "@/lib/types";
import { actorFromSpecialist, storeOpsAuthHeaders } from "@/lib/store-ops/auth";
import {
  getExistingPushSubscription,
  isPushSupported,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
} from "@/lib/push/browser";

type PushState = {
  supported: boolean;
  configured: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  busy: boolean;
  error: string | null;
  message: string | null;
};

const INITIAL: PushState = {
  supported: false,
  configured: false,
  permission: "unsupported",
  subscribed: false,
  busy: false,
  error: null,
  message: null,
};

export function usePushNotifications(specialist: StoreSpecialist | null) {
  const [state, setState] = useState<PushState>(INITIAL);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) {
      setState({
        ...INITIAL,
        supported: false,
        permission: "unsupported",
      });
      return;
    }

    const vapidRes = await fetch("/api/push/vapid-public-key");
    const vapidBody = (await vapidRes.json().catch(() => ({}))) as {
      publicKey?: string | null;
    };
    const configured = Boolean(vapidBody.publicKey);
    const sub = await getExistingPushSubscription();

    setState((prev) => ({
      ...prev,
      supported: true,
      configured,
      permission: Notification.permission,
      subscribed: Boolean(sub),
      error: null,
    }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, specialist?.id]);

  const enable = useCallback(async () => {
    if (!specialist) {
      setState((s) => ({ ...s, error: "Sign in before enabling alerts" }));
      return;
    }
    const actor = actorFromSpecialist(specialist);
    if (!actor || actor.role !== "department_supervisor") {
      // Allow Master Admin to register too (optional monitoring), but primary = supervisors
      if (!actor) {
        setState((s) => ({
          ...s,
          error: "Only supervisors can enable rotation phone alerts",
        }));
        return;
      }
    }

    setState((s) => ({ ...s, busy: true, error: null, message: null }));
    try {
      const vapidRes = await fetch("/api/push/vapid-public-key");
      const vapidBody = (await vapidRes.json()) as {
        publicKey?: string;
        error?: string;
      };
      if (!vapidBody.publicKey) {
        throw new Error(vapidBody.error || "VAPID public key is not configured");
      }

      const subscription = await subscribeBrowserPush(vapidBody.publicKey);
      const headers = storeOpsAuthHeaders(
        actorFromSpecialist(specialist) ?? {
          specialistId: specialist.id,
          role: "department_supervisor",
          departmentCode: specialist.assigned_department,
        }
      );

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers,
        body: JSON.stringify({ subscription }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to save subscription");

      setState((s) => ({
        ...s,
        busy: false,
        subscribed: true,
        permission: "granted",
        message: "Phone alerts enabled for new weekly rotation batches.",
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        busy: false,
        error: err instanceof Error ? err.message : "Enable failed",
      }));
    }
  }, [specialist]);

  const disable = useCallback(async () => {
    if (!specialist) return;
    setState((s) => ({ ...s, busy: true, error: null, message: null }));
    try {
      const endpoint = await unsubscribeBrowserPush();
      if (endpoint) {
        const actor = actorFromSpecialist(specialist);
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: storeOpsAuthHeaders(
            actor ?? {
              specialistId: specialist.id,
              role: "department_supervisor",
              departmentCode: specialist.assigned_department,
            }
          ),
          body: JSON.stringify({ endpoint }),
        });
      }
      setState((s) => ({
        ...s,
        busy: false,
        subscribed: false,
        message: "Phone alerts disabled.",
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        busy: false,
        error: err instanceof Error ? err.message : "Disable failed",
      }));
    }
  }, [specialist]);

  return { ...state, enable, disable, refresh };
}
