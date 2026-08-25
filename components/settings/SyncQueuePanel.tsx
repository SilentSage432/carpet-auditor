"use client";

/**
 * Supervisor sync queue diagnostics — pending + quarantined actions.
 * Presentation only; lib/sync-queue owns queue semantics.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/hub/ConfirmModal";
import {
  OFFLINE_CAPABILITY_ROWS,
  offlineCapabilityModeLabel,
  type OfflineCapabilityMode,
} from "@/lib/offline-capability";
import { useSyncQueueSummary } from "@/lib/network";
import { isMasterAdmin, isDepartmentSupervisor } from "@/lib/rbac";
import {
  syncActionLabel,
  syncFailureReasonLabel,
} from "@/lib/sync-conflict";
import { getStoreNumber } from "@/lib/store";
import {
  discardQuarantinedAction,
  getPendingSync,
  getQuarantinedSync,
  QUARANTINE_THRESHOLD,
  retryQuarantinedAction,
  SYNC_QUEUE_CHANGED_EVENT,
  type SyncAction,
} from "@/lib/sync-queue";
import type { StoreSpecialist } from "@/lib/types";

type SyncQueuePanelProps = {
  specialist: StoreSpecialist | null | undefined;
  storeNumber?: string;
};

function modeTone(mode: OfflineCapabilityMode): string {
  switch (mode) {
    case "offline_queue":
      return "text-emerald-300 bg-emerald-950/50 border-emerald-500/30";
    case "offline_read":
      return "text-sky-300 bg-sky-950/50 border-sky-500/30";
    case "online_only":
      return "text-amber-300 bg-amber-950/40 border-amber-500/30";
  }
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function SyncActionRow({
  action,
  canManage,
  onRetry,
  onDiscard,
}: {
  action: SyncAction;
  canManage: boolean;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const quarantined = action.status === "quarantined";
  const attempts = action.attempts ?? 0;

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">
            {syncActionLabel(action.type)}
          </p>
          <span
            className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              quarantined
                ? "border-amber-500/40 bg-amber-950/60 text-amber-200"
                : "border-sky-500/30 bg-sky-950/50 text-sky-200"
            }`}
          >
            {quarantined ? "Quarantined · Attention required" : "Pending"}
          </span>
        </div>
        <p className="font-mono text-[10px] text-slate-500">
          {formatWhen(action.created_at)}
        </p>
      </div>

      {quarantined && action.failure_reason ? (
        <p className="mt-2 text-xs text-amber-200/90">
          {syncFailureReasonLabel(action.failure_reason)}
        </p>
      ) : null}

      {action.last_error ? (
        <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-slate-400">
          {action.last_error}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] text-slate-500">
        Attempts:{" "}
        <span className="font-mono text-slate-300">
          {attempts} / {QUARANTINE_THRESHOLD}
        </span>
      </p>

      {canManage && quarantined ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onRetry(action.id)}
            className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 text-xs font-semibold text-emerald-300"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry Now
          </button>
          <button
            type="button"
            onClick={() => onDiscard(action.id)}
            className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-red-500/40 text-xs font-semibold text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Discard
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function SyncQueuePanel({
  specialist,
  storeNumber: storeNumberProp,
}: SyncQueuePanelProps) {
  const storeNumber =
    storeNumberProp ??
    (typeof window !== "undefined" ? getStoreNumber() : "");
  const summary = useSyncQueueSummary(storeNumber);
  const canManage =
    isMasterAdmin(specialist) || isDepartmentSupervisor(specialist);

  const [pending, setPending] = useState<SyncAction[]>([]);
  const [quarantined, setQuarantined] = useState<SyncAction[]>([]);
  const [discardId, setDiscardId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setPending(getPendingSync(storeNumber));
    setQuarantined(getQuarantinedSync(storeNumber));
  }, [storeNumber]);

  useEffect(() => {
    refresh();
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, refresh);
  }, [refresh]);

  const isClean = useMemo(
    () => summary.pending === 0 && summary.quarantined === 0,
    [summary.pending, summary.quarantined]
  );

  function handleRetry(id: string) {
    retryQuarantinedAction(id);
    refresh();
  }

  function handleDiscardConfirm() {
    if (!discardId) return;
    discardQuarantinedAction(discardId);
    setDiscardId(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-300">Sync queue</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Pending replays automatically. Quarantined items need supervisor
          review.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <span className="text-slate-400">
            Pending:{" "}
            <span className="font-mono font-semibold text-sky-300">
              {summary.pending}
            </span>
          </span>
          <span className="text-slate-400">
            Blocked:{" "}
            <span className="font-mono font-semibold text-amber-300">
              {summary.quarantined}
            </span>
          </span>
        </div>
      </div>

      {isClean ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-3 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          All changes synchronized with store cloud
        </div>
      ) : (
        <ul className="space-y-2">
          {quarantined.map((action) => (
            <SyncActionRow
              key={action.id}
              action={action}
              canManage={canManage}
              onRetry={handleRetry}
              onDiscard={setDiscardId}
            />
          ))}
          {pending.map((action) => (
            <SyncActionRow
              key={action.id}
              action={action}
              canManage={false}
              onRetry={handleRetry}
              onDiscard={setDiscardId}
            />
          ))}
        </ul>
      )}

      {summary.quarantined > 0 && !canManage ? (
        <p className="flex items-start gap-2 text-xs text-amber-200/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Ask a department supervisor to retry or discard blocked items.
        </p>
      ) : null}

      <div className="border-t border-slate-800 pt-4">
        <p className="text-sm font-semibold text-slate-300">
          Offline capability matrix
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          What works on dead zones vs what needs live network.
        </p>
        <ul className="mt-3 space-y-2">
          {OFFLINE_CAPABILITY_ROWS.map((row) => (
            <li
              key={row.module}
              className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-200">
                  {row.module}
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${modeTone(row.mode)}`}
                >
                  {offlineCapabilityModeLabel(row.mode)}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {row.summary}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <ConfirmModal
        open={discardId != null}
        title="Discard blocked sync item?"
        message="This permanently removes the queued change from this device. The local offline copy may still exist until you clear cache."
        confirmLabel="Discard"
        cancelLabel="Keep"
        danger
        onClose={() => setDiscardId(null)}
        onConfirm={handleDiscardConfirm}
      />
    </div>
  );
}
