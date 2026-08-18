"use client";

/**
 * Supervisor weekly audit rollup + DS verification queue.
 * Stats compose audit-summary.ts; queue actions own weekly_rotations.verification_status.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  composeWeeklyAuditRollup,
  formatWeeklyAuditRollupText,
} from "@/lib/store-ops/audit-summary";
import { formatBayTag } from "@/lib/store-ops/types";
import {
  fetchExceptionSummary,
  fetchStoreHealth,
  fetchThisWeekRotations,
  fetchVerificationQueue,
  sendBackPendingBay,
  verifyAllPendingBays,
  verifyPendingBay,
  type VerificationQueueItem,
} from "@/lib/store-ops/client";
import { fetchSundayAssignments } from "@/lib/store-ops/sunday-audit";
import { hoursBySpecialistId, readShiftRoster } from "@/lib/store-ops/weekly-rotations";
import { getStoreNumber } from "@/lib/store";
import { playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  specialist: StoreSpecialist;
  assignedWeek?: string;
  departmentId?: string | null;
  onClose: () => void;
  onReviewed?: () => void;
};

export function SupervisorAuditSummaryModal({
  open,
  specialist,
  assignedWeek,
  departmentId,
  onClose,
  onReviewed,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [sendBackId, setSendBackId] = useState<string | null>(null);
  const [sendBackNote, setSendBackNote] = useState("");
  const [queue, setQueue] = useState<VerificationQueueItem[]>([]);
  const [rollup, setRollup] = useState<ReturnType<
    typeof composeWeeklyAuditRollup
  > | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [health, weekData, exceptions, queueData] = await Promise.all([
        fetchStoreHealth(specialist, assignedWeek),
        fetchThisWeekRotations(specialist, departmentId ?? undefined),
        fetchExceptionSummary(specialist, assignedWeek),
        fetchVerificationQueue(specialist, {
          department_id: departmentId ?? undefined,
          assigned_week: assignedWeek,
        }).catch(() => ({ assigned_week: assignedWeek ?? "", pending_count: 0, items: [] })),
      ]);
      const week = assignedWeek || weekData.assigned_week || health.assigned_week;
      const assignments = week
        ? await fetchSundayAssignments(week, getStoreNumber())
        : {};
      const hours = week
        ? hoursBySpecialistId(readShiftRoster(week, getStoreNumber()))
        : {};
      setRollup(
        composeWeeklyAuditRollup({
          week,
          health,
          rotations: weekData.rotations ?? [],
          assignments,
          shiftHours: hours,
          exceptionLocationIds: (exceptions.exceptions ?? []).map(
            (row) => row.bay_id
          ),
        })
      );
      setQueue(queueData.items ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load weekly rollup"
      );
      setRollup(null);
      setQueue([]);
    } finally {
      setBusy(false);
    }
  }, [specialist, assignedWeek, departmentId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const copyText = useMemo(
    () => (rollup ? formatWeeklyAuditRollupText(rollup) : ""),
    [rollup]
  );

  async function copyStats() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard copy failed");
    }
  }

  async function handleVerify(rotationId: string) {
    setActionId(rotationId);
    setError(null);
    try {
      await verifyPendingBay(specialist, rotationId, departmentId ?? undefined);
      setQueue((prev) => prev.filter((row) => row.rotation_id !== rotationId));
      onReviewed?.();
      playSuccessTone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verify failed");
      playErrorTone();
    } finally {
      setActionId(null);
    }
  }

  async function handleSendBack(rotationId: string) {
    const note = sendBackNote.trim();
    if (!note) {
      setError("Add a coaching note before sending a bay back");
      return;
    }
    setActionId(rotationId);
    setError(null);
    try {
      await sendBackPendingBay(
        specialist,
        rotationId,
        note,
        departmentId ?? undefined
      );
      setQueue((prev) => prev.filter((row) => row.rotation_id !== rotationId));
      setSendBackId(null);
      setSendBackNote("");
      onReviewed?.();
      playSuccessTone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send back failed");
      playErrorTone();
    } finally {
      setActionId(null);
    }
  }

  async function handleVerifyAll() {
    setActionId("all");
    setError(null);
    try {
      const result = await verifyAllPendingBays(specialist, {
        department_id: departmentId ?? undefined,
        assigned_week: assignedWeek,
      });
      setQueue([]);
      onReviewed?.();
      playSuccessTone();
      void load();
      if (result.verified_count === 0) {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verify all failed");
      playErrorTone();
    } finally {
      setActionId(null);
    }
  }

  if (!open) return null;

  const pct = rollup?.completion_pct ?? 0;

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close weekly rollup"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-rollup-title"
        className="glass-card relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 border-emerald-500/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
              DS verification queue
            </p>
            <h2 id="weekly-rollup-title" className="glass-title mt-1 text-lg">
              Weekly audit rollup
            </h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              {rollup?.assigned_week || assignedWeek || "This week"}
              {rollup?.department_name ? ` · ${rollup.department_name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-zinc-700 text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error ? (
          <p className="mb-3 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {busy && !rollup && queue.length === 0 ? (
          <p className="text-sm text-zinc-400">Composing this week&apos;s queue…</p>
        ) : (
          <div className="space-y-4">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
                  Awaiting DS ({queue.length})
                </p>
                {queue.length > 0 ? (
                  <button
                    type="button"
                    disabled={actionId === "all"}
                    onClick={() => void handleVerifyAll()}
                    className="flex min-h-10 items-center justify-center rounded-xl border border-emerald-400/50 bg-emerald-600/90 px-3 text-xs font-bold text-zinc-950 disabled:opacity-50"
                  >
                    {actionId === "all"
                      ? "Closing week…"
                      : "Verify All & Close Out Week"}
                  </button>
                ) : null}
              </div>
              {queue.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 px-3 py-3 text-sm text-zinc-400">
                  No bays waiting for DS review.
                </p>
              ) : (
                <ul className="space-y-2">
                  {queue.map((item) => {
                    const tag = formatBayTag({
                      aisle: item.aisle,
                      bay: item.bay,
                    });
                    const sending = sendBackId === item.rotation_id;
                    return (
                      <li
                        key={item.rotation_id}
                        className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-bold tracking-tight text-zinc-50">
                              {tag}
                              {item.type ? ` · ${item.type}` : ""}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-400">
                              {item.associate_name || "Associate"}
                              {item.completed_at
                                ? ` · ${new Date(item.completed_at).toLocaleString([], {
                                    weekday: "short",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}`
                                : ""}
                            </p>
                          </div>
                          {item.audit ? (
                            <span className="shrink-0 rounded-full border border-cyan-400/40 bg-cyan-950/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-cyan-200">
                              Audit {item.audit.verdict}
                            </span>
                          ) : null}
                        </div>
                        {item.audit?.image_url ? (
                          <img
                            src={item.audit.image_url}
                            alt={`${tag} audit photo`}
                            className="mt-2 max-h-40 w-full rounded-lg object-cover"
                          />
                        ) : null}
                        {sending ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={sendBackNote}
                              onChange={(e) => setSendBackNote(e.target.value)}
                              rows={3}
                              placeholder="Coaching note for the associate"
                              className="glass-input min-h-[72px] w-full text-sm"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSendBackId(null);
                                  setSendBackNote("");
                                }}
                                className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-200"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={actionId === item.rotation_id}
                                onClick={() => void handleSendBack(item.rotation_id)}
                                className="flex min-h-11 items-center justify-center rounded-xl border border-rose-400/50 bg-rose-600 px-3 text-sm font-bold text-white disabled:opacity-50"
                              >
                                {actionId === item.rotation_id
                                  ? "Sending…"
                                  : "Send Back with Note"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={Boolean(actionId)}
                              onClick={() => void handleVerify(item.rotation_id)}
                              className="flex min-h-11 items-center justify-center rounded-xl border border-emerald-400/50 bg-emerald-600/90 px-3 text-sm font-bold text-zinc-950 disabled:opacity-50"
                            >
                              {actionId === item.rotation_id
                                ? "Verifying…"
                                : "Verify & Pass"}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(actionId)}
                              onClick={() => {
                                setSendBackId(item.rotation_id);
                                setSendBackNote("");
                              }}
                              className="flex min-h-11 items-center justify-center rounded-xl border border-rose-400/40 bg-rose-950/40 px-3 text-sm font-bold text-rose-100 disabled:opacity-50"
                            >
                              Send Back with Note
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {rollup ? (
              <>
                <section className="rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-3 py-3">
                  <p className="text-sm font-semibold text-zinc-100">
                    {rollup.completed}/{rollup.quota} bays vs weekly quota
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-zinc-400">
                    Assigned {rollup.assigned} · remaining {rollup.remaining} · {pct}%
                  </p>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{
                        width: `${Math.min(100, pct)}%`,
                      }}
                    />
                  </div>
                </section>

                <section>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                    By associate / shift
                  </p>
                  {rollup.associates.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-400">
                      No Sunday assignments this week. Completions stay unassigned
                      rather than guessed.
                    </p>
                  ) : (
                    <ul className="mt-2 divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
                      {rollup.associates.map((row) => (
                        <li
                          key={row.specialist_id}
                          className="flex min-h-11 items-center justify-between gap-2 px-3 py-2"
                        >
                          <span className="min-w-0 truncate text-sm text-zinc-100">
                            {row.specialist_name}
                            {row.shift_hours ? (
                              <span className="ml-1 font-mono text-[10px] text-amber-200/90">
                                {row.shift_hours}h
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-zinc-400">
                            {row.completed}/{row.assigned}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {rollup.unassigned.assigned > 0 ? (
                    <p className="mt-2 font-mono text-xs text-zinc-500">
                      Unassigned {rollup.unassigned.completed}/
                      {rollup.unassigned.assigned} complete
                    </p>
                  ) : null}
                </section>

                <section className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                      Resolved barriers
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold text-emerald-100">
                      {rollup.resolved_barriers}
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                      Open barriers
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold text-amber-100">
                      {rollup.open_barriers}
                    </p>
                  </div>
                </section>

                <button
                  type="button"
                  onClick={() => void copyStats()}
                  className="btn-primary-glow flex min-h-14 w-full items-center justify-center rounded-xl text-sm"
                >
                  {copied ? "Copied" : "Copy weekly stats"}
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
