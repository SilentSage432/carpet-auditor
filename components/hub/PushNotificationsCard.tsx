"use client";

import { usePushNotifications } from "@/lib/push/usePushNotifications";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist | null;
};

/** Settings card — enable phone alerts when weekly rotation batches drop. */
export function PushNotificationsCard({ specialist }: Props) {
  const push = usePushNotifications(specialist);
  const canEnable =
    specialist?.role === "Supervisor" || specialist?.role === "MasterAdmin";

  if (!canEnable) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Phone rotation alerts
      </h3>
      <p className="text-sm text-slate-300">
        Get a Web Push on your personal phone when Master Admin drops a new weekly
        bay rotation for your department.
      </p>

      {!push.supported ? (
        <p className="text-sm text-amber-300">
          This browser does not support Web Push. Use Chrome / Edge / Safari on a
          phone after installing the DeptSync PWA.
        </p>
      ) : !push.configured ? (
        <p className="text-sm text-amber-300">
          Push is not configured on the server yet (missing VAPID keys).
        </p>
      ) : (
        <div className="grid gap-2">
          <p className="font-mono text-xs text-slate-400">
            Status:{" "}
            <span className="font-semibold text-slate-200">
              {push.subscribed
                ? "Enabled"
                : push.permission === "denied"
                  ? "Blocked by browser"
                  : "Off"}
            </span>
          </p>
          {push.subscribed ? (
            <button
              type="button"
              disabled={push.busy}
              onClick={() => void push.disable()}
              className="flex min-h-12 items-center justify-center rounded-xl border border-slate-600 text-sm font-semibold text-slate-200 disabled:opacity-50"
            >
              {push.busy ? "Working…" : "Disable phone alerts"}
            </button>
          ) : (
            <button
              type="button"
              disabled={push.busy || push.permission === "denied"}
              onClick={() => void push.enable()}
              className="flex min-h-12 items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300 disabled:opacity-50"
            >
              {push.busy ? "Enabling…" : "Enable phone alerts"}
            </button>
          )}
        </div>
      )}

      {push.message ? (
        <p className="text-sm font-medium text-emerald-300" role="status">
          {push.message}
        </p>
      ) : null}
      {push.error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {push.error}
        </p>
      ) : null}
    </div>
  );
}
