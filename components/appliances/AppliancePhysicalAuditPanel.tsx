"use client";

/**
 * Physical audit controls — start / close / history / open reconcile.
 * Destructive Reset remains separate on the action bar.
 */

import { useCallback, useEffect, useState } from "react";
import { HubPortal } from "@/components/hub/HubPortal";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  closeAppliancePhysicalAudit,
  fetchApplianceAuditDetail,
  fetchApplianceAuditSessions,
  saveApplianceReconciliation,
  startAppliancePhysicalAudit,
  type ApplianceAuditDetail,
} from "@/lib/appliances/audit-client";
import {
  applianceAuditReconciliationToCsv,
  deriveApplianceVariance,
  type ApplianceAuditSession,
  type AppliancePhysicalItemCount,
  type ApplianceReconciliationSnapshot,
  type ApplianceReconOutcome,
} from "@/lib/appliances/physical-audit";
import { getPendingApplianceScanSyncForAudit } from "@/lib/sync-queue";
import { getStoreNumber } from "@/lib/store";

type Props = {
  onActiveSessionChange: (session: ApplianceAuditSession | null) => void;
  onStatus: (message: string, tone?: "ok" | "error") => void;
  /** Incremented by scanner Review / Finish — opens active audit review. */
  reviewFinishToken?: number;
};

type ReconDraft = {
  declared_lowes_oh: string;
  outcome: "" | ApplianceReconOutcome;
  notes: string;
};

export function AppliancePhysicalAuditPanel({
  onActiveSessionChange,
  onStatus,
  reviewFinishToken = 0,
}: Props) {
  const [active, setActive] = useState<ApplianceAuditSession | null>(null);
  const [history, setHistory] = useState<ApplianceAuditSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ApplianceAuditDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reconOpen, setReconOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ReconDraft>>({});
  const [reconSaving, setReconSaving] = useState(false);
  const [pendingAuditScans, setPendingAuditScans] = useState(0);

  const refreshPending = useCallback(() => {
    if (!active) {
      setPendingAuditScans(0);
      return;
    }
    setPendingAuditScans(
      getPendingApplianceScanSyncForAudit(active.id, getStoreNumber()).length
    );
  }, [active]);

  const refresh = useCallback(async () => {
    try {
      const [activeRows, all] = await Promise.all([
        fetchApplianceAuditSessions({ status: "ACTIVE" }),
        fetchApplianceAuditSessions({ status: "ALL" }),
      ]);
      const current = activeRows[0] ?? null;
      setActive(current);
      onActiveSessionChange(current);
      setHistory(all.filter((s) => s.status === "CLOSED").slice(0, 20));
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not load physical audits",
        "error"
      );
    }
  }, [onActiveSessionChange, onStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    refreshPending();
    if (typeof window === "undefined") return;
    const onQueue = () => refreshPending();
    window.addEventListener("carpet-sync-queue-changed", onQueue);
    window.addEventListener("online", onQueue);
    return () => {
      window.removeEventListener("carpet-sync-queue-changed", onQueue);
      window.removeEventListener("online", onQueue);
    };
  }, [refreshPending]);

  useEffect(() => {
    if (!reviewFinishToken) return;
    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled) return;
      const sessions = await fetchApplianceAuditSessions({ status: "ACTIVE" });
      const current = sessions[0];
      if (!current) {
        onStatus("No active physical audit to review", "error");
        return;
      }
      setActive(current);
      onActiveSessionChange(current);
      try {
        const loaded = await fetchApplianceAuditDetail(current.id);
        if (cancelled) return;
        setDetail(loaded);
        seedDrafts(loaded.physical_items, loaded.snapshots);
        setDetailOpen(true);
        setReconOpen(false);
        onStatus("Review observed units — then Close physical audit");
      } catch (err) {
        onStatus(
          err instanceof Error ? err.message : "Could not open audit review",
          "error"
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token edge only
  }, [reviewFinishToken]);

  async function handleStart() {
    setBusy(true);
    try {
      const { session } = await startAppliancePhysicalAudit();
      setActive(session);
      onActiveSessionChange(session);
      onStatus("Physical audit started — scans will join this audit");
      await refresh();
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not start audit",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (!active) return;
    setBusy(true);
    try {
      const closed = await closeAppliancePhysicalAudit(active.id);
      setActive(null);
      onActiveSessionChange(null);
      onStatus(
        `Physical audit closed — ${closed.id.slice(0, 8)}… preserved`
      );
      await refresh();
      const loaded = await fetchApplianceAuditDetail(closed.id);
      setDetail(loaded);
      setDetailOpen(true);
      seedDrafts(loaded.physical_items, loaded.snapshots);
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not close audit",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  function seedDrafts(
    items: AppliancePhysicalItemCount[],
    snapshots: ApplianceReconciliationSnapshot[]
  ) {
    const byItem = new Map(snapshots.map((s) => [s.item_number, s]));
    const next: Record<string, ReconDraft> = {};
    for (const item of items) {
      const snap = byItem.get(item.item_number);
      next[item.item_number] = {
        declared_lowes_oh:
          snap?.declared_lowes_oh != null ? String(snap.declared_lowes_oh) : "",
        outcome: snap?.outcome ?? "",
        notes: snap?.notes ?? "",
      };
    }
    setDrafts(next);
  }

  async function openHistory(session: ApplianceAuditSession) {
    setBusy(true);
    try {
      const loaded = await fetchApplianceAuditDetail(session.id);
      setDetail(loaded);
      seedDrafts(loaded.physical_items, loaded.snapshots);
      setDetailOpen(true);
      setReconOpen(false);
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not open audit",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRecon() {
    if (!detail) return;
    setReconSaving(true);
    try {
      const items = detail.physical_items.map((item) => {
        const draft = drafts[item.item_number] ?? {
          declared_lowes_oh: "",
          outcome: "" as const,
          notes: "",
        };
        const raw = draft.declared_lowes_oh.trim();
        const declared_lowes_oh =
          raw === "" ? null : Math.floor(Number(raw));
        return {
          item_number: item.item_number,
          declared_lowes_oh,
          outcome: draft.outcome || null,
          notes: draft.notes,
        };
      });
      const snapshots = await saveApplianceReconciliation(
        detail.session.id,
        items
      );
      const loaded = await fetchApplianceAuditDetail(detail.session.id);
      setDetail(loaded);
      seedDrafts(loaded.physical_items, loaded.snapshots);
      onStatus(
        `Updated ${snapshots.filter((s) => s.declared_lowes_oh != null).length} Lowe's OH declaration(s)`
      );
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Reconciliation save failed",
        "error"
      );
    } finally {
      setReconSaving(false);
    }
  }

  async function handleExport() {
    if (!detail) return;
    const csv = applianceAuditReconciliationToCsv({
      session: detail.session,
      items: detail.physical_items,
      snapshots: detail.snapshots,
    });
    // Reuse share helper by wrapping as File via temporary download path.
    const filename = `appliance-physical-audit-${detail.session.started_at.slice(0, 10)}.csv`;
    try {
      const file = new File([csv], filename, {
        type: "text/csv;charset=utf-8",
      });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: "Appliance Physical Audit",
          text: "Physical count + declared Lowe's OH",
          files: [file],
        });
        onStatus("Audit CSV shared");
        return;
      }
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      onStatus("Audit CSV downloaded");
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not export audit",
        "error"
      );
    }
  }

  return (
    <section
      aria-label="Appliance physical audit"
      className="space-y-2 rounded-xl border border-cyan-500/35 bg-cyan-950/20 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-cyan-300">
            Physical audit
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Observed units only — reconcile declared Lowe&apos;s OH after close.
          </p>
        </div>
        {active ? (
          <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
            ACTIVE
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-slate-600 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400">
            Idle
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy || active != null}
          onClick={() => void handleStart()}
          className="flex min-h-11 items-center justify-center rounded-xl border border-cyan-400/50 bg-cyan-600/90 px-2 text-xs font-bold text-zinc-950 disabled:opacity-40"
        >
          Start physical audit
        </button>
        <button
          type="button"
          disabled={busy || !active}
          onClick={() => void handleClose()}
          className="flex min-h-11 items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/90 px-2 text-xs font-bold text-zinc-950 disabled:opacity-40"
        >
          Close physical audit
        </button>
      </div>

      {active ? (
        <p className="font-mono text-[11px] text-cyan-100/90">
          Scans join audit {active.id.slice(0, 8)}…
          {pendingAuditScans > 0
            ? ` · ${pendingAuditScans} unsynced observation(s) — sync before close`
            : ""}
        </p>
      ) : null}

      {history.length > 0 ? (
        <div className="space-y-1.5 pt-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Prior audits
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {history.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openHistory(session)}
                  className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 text-left text-xs text-slate-200"
                >
                  <span className="font-mono">
                    {session.started_at
                      ? new Date(session.started_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : session.id.slice(0, 8)}
                  </span>
                  <span className="text-slate-500">View</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detailOpen && detail ? (
        <HubPortal>
          <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-slate-950/75">
            <button
              type="button"
              aria-label="Close audit detail"
              className="absolute inset-0"
              onClick={() => {
                setDetailOpen(false);
                setReconOpen(false);
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Physical audit detail"
              className="hub-modal-sheet relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t-2 border-cyan-500/40 bg-slate-950"
            >
              <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-600" />
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div>
                  <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-cyan-200">
                    {reconOpen
                      ? "Reconcile with Lowe's"
                      : "Physical audit"}
                  </h2>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                    {detail.summary.physical_unit_count} observed units ·{" "}
                    {detail.summary.unique_item_count} items ·{" "}
                    {detail.session.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (reconOpen) setReconOpen(false);
                    else {
                      setDetailOpen(false);
                      setReconOpen(false);
                    }
                  }}
                  className="flex min-h-10 items-center rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-300"
                >
                  {reconOpen ? "Back" : "Done"}
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-6">
                {!reconOpen ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {detail.session.status === "ACTIVE" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleClose()}
                          className="flex min-h-11 items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/90 px-2 text-xs font-bold text-zinc-950 disabled:opacity-40"
                        >
                          Close physical audit
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReconOpen(true)}
                          className="flex min-h-11 items-center justify-center rounded-xl border border-emerald-400/50 bg-emerald-600/90 px-2 text-xs font-bold text-zinc-950"
                        >
                          Reconcile with Lowe&apos;s
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleExport()}
                        className="flex min-h-11 items-center justify-center rounded-xl border border-sky-500/40 bg-sky-950/40 px-2 text-xs font-bold text-sky-100"
                      >
                        Share / Export CSV
                      </button>
                    </div>
                    {detail.session.status === "ACTIVE" ? (
                      <p className="text-center text-[11px] text-amber-100/80">
                        Close the physical audit to reconcile declared Lowe&apos;s
                        OH.
                      </p>
                    ) : null}
                    <ul className="space-y-2">
                      {detail.physical_items.map((item) => {
                        const snap = detail.snapshots.find(
                          (s) => s.item_number === item.item_number
                        );
                        return (
                          <li
                            key={item.item_number}
                            className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2"
                          >
                            <p className="font-mono text-sm font-bold text-slate-50">
                              {item.item_number}
                            </p>
                            <p className="truncate text-sm text-slate-300">
                              {item.description ||
                                `${item.category}${item.sub_category ? ` · ${item.sub_category}` : ""}`}
                            </p>
                            <p className="mt-1 font-mono text-xs text-cyan-200">
                              Physical count: {item.physical_count}
                              {snap?.declared_lowes_oh != null
                                ? ` · Declared OH: ${snap.declared_lowes_oh} · Variance: ${snap.variance}`
                                : " · Lowe's OH not entered"}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-400">
                      Enter Lowe&apos;s OH from Zebra/computer. Blank OH leaves
                      variance unset (not zero). Physical count is observed and
                      not editable.
                    </p>
                    <ul className="space-y-3">
                      {detail.physical_items.map((item) => {
                        const draft = drafts[item.item_number] ?? {
                          declared_lowes_oh: "",
                          outcome: "" as const,
                          notes: "",
                        };
                        const ohRaw = draft.declared_lowes_oh.trim();
                        const oh =
                          ohRaw === "" ? null : Math.floor(Number(ohRaw));
                        const variance = deriveApplianceVariance(
                          item.physical_count,
                          Number.isFinite(oh as number) ? oh : null
                        );
                        return (
                          <li
                            key={item.item_number}
                            className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-3"
                          >
                            <div>
                              <p className="font-mono text-sm font-bold text-slate-50">
                                {item.item_number}
                              </p>
                              <p className="text-sm text-slate-300">
                                {item.description || item.category}
                              </p>
                              <p className="mt-1 font-mono text-xs text-cyan-200">
                                Physical count: {item.physical_count}
                                {variance != null
                                  ? ` · Variance: ${variance}`
                                  : ""}
                              </p>
                            </div>
                            <NumberField
                              label="Declared Lowe's OH"
                              mode="integer"
                              value={draft.declared_lowes_oh}
                              onChange={(v) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.item_number]: {
                                    ...draft,
                                    declared_lowes_oh: v,
                                  },
                                }))
                              }
                              placeholder="Leave blank if not yet checked"
                            />
                            <label className="block space-y-1">
                              <span className="text-sm font-medium text-slate-200">
                                Outcome (optional)
                              </span>
                              <select
                                value={draft.outcome}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.item_number]: {
                                      ...draft,
                                      outcome: e.target
                                        .value as ReconDraft["outcome"],
                                    },
                                  }))
                                }
                                className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
                              >
                                <option value="">—</option>
                                <option value="RESOLVED">Resolved</option>
                                <option value="NEEDS_FOLLOW_UP">
                                  Needs follow-up
                                </option>
                              </select>
                            </label>
                            <TextField
                              label="Notes (optional)"
                              value={draft.notes}
                              onChange={(v) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.item_number]: { ...draft, notes: v },
                                }))
                              }
                              placeholder="Human-declared note only"
                            />
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      disabled={reconSaving}
                      onClick={() => void handleSaveRecon()}
                      className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
                    >
                      {reconSaving
                        ? "Saving…"
                        : "Save reconciliation"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </HubPortal>
      ) : null}
    </section>
  );
}
