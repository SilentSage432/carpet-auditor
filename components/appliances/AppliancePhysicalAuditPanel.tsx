"use client";

/**
 * Physical audit controls — two-phase lifecycle (APP-AUD-002A):
 * ACTIVE physical observation → Close physical count → reconcile (mutable) → history.
 * CLOSED ≠ reconciliation complete. Export does not mutate lifecycle.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
  APPLIANCE_RECENT_CLOSED_AUDIT_LIMIT,
  applianceAuditReconciliationToCsv,
  composeApplianceReconciliationProgress,
  deriveApplianceVariance,
  formatAppliancePhysicalAuditStatus,
  formatApplianceReconciliationPhase,
  type ApplianceAuditSession,
  type AppliancePhysicalItemCount,
  type ApplianceReconciliationProgress,
  type ApplianceReconciliationSnapshot,
  type ApplianceReconOutcome,
} from "@/lib/appliances/physical-audit";
import { shareOrDownloadTextFile } from "@/lib/appliances/audit-export";
import { getPendingApplianceScanSyncForAudit } from "@/lib/sync-queue";
import { getStoreNumber } from "@/lib/store";

type Props = {
  onActiveSessionChange: (session: ApplianceAuditSession | null) => void;
  onStatus: (message: string, tone?: "ok" | "error") => void;
  /** Incremented by scanner Review / Finish — opens active audit review. */
  reviewFinishToken?: number;
  /** After Start, parent should open scanner with audit context. */
  onStarted?: (session: ApplianceAuditSession) => void;
};

type ReconDraft = {
  declared_lowes_oh: string;
  outcome: "" | ApplianceReconOutcome;
  notes: string;
};

type RecentAuditCard = {
  session: ApplianceAuditSession;
  physical_unit_count: number;
  unique_item_count: number;
  progress: ApplianceReconciliationProgress;
};

function formatAuditWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function seedDrafts(
  items: AppliancePhysicalItemCount[],
  snapshots: ApplianceReconciliationSnapshot[]
): Record<string, ReconDraft> {
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
  return next;
}

export function AppliancePhysicalAuditPanel({
  onActiveSessionChange,
  onStatus,
  reviewFinishToken = 0,
  onStarted,
}: Props) {
  const [active, setActive] = useState<ApplianceAuditSession | null>(null);
  const [closedSessions, setClosedSessions] = useState<ApplianceAuditSession[]>(
    []
  );
  const [recentCards, setRecentCards] = useState<RecentAuditCard[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ApplianceAuditDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reconOpen, setReconOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ReconDraft>>({});
  const [reconSaving, setReconSaving] = useState(false);
  const [pendingAuditScans, setPendingAuditScans] = useState(0);
  const [highlightClosedId, setHighlightClosedId] = useState<string | null>(
    null
  );

  const refreshPending = useCallback(() => {
    if (!active) {
      setPendingAuditScans(0);
      return;
    }
    setPendingAuditScans(
      getPendingApplianceScanSyncForAudit(active.id, getStoreNumber()).length
    );
  }, [active]);

  const loadRecentCards = useCallback(
    async (closed: ApplianceAuditSession[]) => {
      const slice = closed.slice(0, APPLIANCE_RECENT_CLOSED_AUDIT_LIMIT);
      const cards = await Promise.all(
        slice.map(async (session) => {
          try {
            const loaded = await fetchApplianceAuditDetail(session.id);
            const progress =
              loaded.summary.reconciliation ??
              composeApplianceReconciliationProgress(
                loaded.physical_items,
                loaded.snapshots
              );
            return {
              session,
              physical_unit_count: loaded.summary.physical_unit_count,
              unique_item_count: loaded.summary.unique_item_count,
              progress,
            } satisfies RecentAuditCard;
          } catch {
            return {
              session,
              physical_unit_count: 0,
              unique_item_count: 0,
              progress: composeApplianceReconciliationProgress([], []),
            } satisfies RecentAuditCard;
          }
        })
      );
      setRecentCards(cards);
    },
    []
  );

  const refresh = useCallback(async () => {
    try {
      const [activeRows, all] = await Promise.all([
        fetchApplianceAuditSessions({ status: "ACTIVE" }),
        fetchApplianceAuditSessions({ status: "ALL" }),
      ]);
      const current = activeRows[0] ?? null;
      setActive(current);
      onActiveSessionChange(current);
      const closed = all
        .filter((s) => s.status === "CLOSED")
        .sort((a, b) =>
          String(b.closed_at ?? b.started_at).localeCompare(
            String(a.closed_at ?? a.started_at)
          )
        );
      setClosedSessions(closed);
      await loadRecentCards(closed);
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not load physical audits",
        "error"
      );
    }
  }, [loadRecentCards, onActiveSessionChange, onStatus]);

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
        setDrafts(seedDrafts(loaded.physical_items, loaded.snapshots));
        setDetailOpen(true);
        setReconOpen(false);
        onStatus("Review observed units — then Close physical count");
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

  const detailProgress = useMemo(() => {
    if (!detail) return null;
    return (
      detail.summary.reconciliation ??
      composeApplianceReconciliationProgress(
        detail.physical_items,
        detail.snapshots
      )
    );
  }, [detail]);

  async function handleStart() {
    setBusy(true);
    try {
      const { session } = await startAppliancePhysicalAudit();
      setActive(session);
      onActiveSessionChange(session);
      setHighlightClosedId(null);
      onStatus("Physical audit active — scans join this count");
      onStarted?.(session);
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
      setHighlightClosedId(closed.id);
      onStatus(
        "Physical count closed — evidence frozen. Reconcile Lowe's OH when ready."
      );
      await refresh();
      const loaded = await fetchApplianceAuditDetail(closed.id);
      setDetail(loaded);
      setDrafts(seedDrafts(loaded.physical_items, loaded.snapshots));
      setDetailOpen(true);
      setReconOpen(false);
    } catch (err) {
      onStatus(
        err instanceof Error ? err.message : "Could not close physical count",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(
    session: ApplianceAuditSession,
    opts?: { openRecon?: boolean }
  ) {
    setBusy(true);
    try {
      const loaded = await fetchApplianceAuditDetail(session.id);
      setDetail(loaded);
      setDrafts(seedDrafts(loaded.physical_items, loaded.snapshots));
      setDetailOpen(true);
      setReconOpen(Boolean(opts?.openRecon) && session.status === "CLOSED");
      if (session.status === "CLOSED") {
        setHighlightClosedId(session.id);
      }
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
      setDrafts(seedDrafts(loaded.physical_items, loaded.snapshots));
      const progress = composeApplianceReconciliationProgress(
        loaded.physical_items,
        loaded.snapshots
      );
      onStatus(
        `Reconciliation saved — ${snapshots.filter((s) => s.declared_lowes_oh != null).length} OH declaration(s). ${formatApplianceReconciliationPhase(progress.phase)}.`
      );
      await loadRecentCards(closedSessions);
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
    const filename = `appliance-physical-audit-${detail.session.started_at.slice(0, 10)}.csv`;
    try {
      const mode = await shareOrDownloadTextFile(csv, {
        filename,
        title: "Appliance Physical Audit",
        text: "Observed physical count + DS-declared Lowe's OH + derived variance",
      });
      if (mode === "cancelled") {
        onStatus("Share cancelled");
        return;
      }
      onStatus(
        mode === "shared"
          ? "Audit CSV shared (lifecycle unchanged)"
          : "Audit CSV downloaded (lifecycle unchanged)"
      );
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
      data-testid="appliance-physical-audit-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-cyan-300">
            Physical audit
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Phase 1: observe &amp; freeze count. Phase 2: declare Lowe&apos;s OH
            after close. Closing is not reconciliation complete.
          </p>
        </div>
        {active ? (
          <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
            Physical audit active
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
          data-testid="start-physical-audit"
          className="flex min-h-11 items-center justify-center rounded-xl border border-cyan-400/50 bg-cyan-600/90 px-2 text-xs font-bold text-zinc-950 disabled:opacity-40"
        >
          Start physical audit
        </button>
        <button
          type="button"
          disabled={busy || !active}
          onClick={() => void handleClose()}
          data-testid="close-physical-count"
          className="flex min-h-11 items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/90 px-2 text-xs font-bold text-zinc-950 disabled:opacity-40"
        >
          Close physical count
        </button>
      </div>

      {active ? (
        <p className="font-mono text-[11px] text-cyan-100/90">
          Physical audit active · {active.id.slice(0, 8)}…
          {pendingAuditScans > 0
            ? ` · ${pendingAuditScans} unsynced observation(s) — sync before close`
            : ""}
        </p>
      ) : null}

      {highlightClosedId && !active ? (
        <div
          data-testid="awaiting-reconciliation-banner"
          className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2"
        >
          <p className="text-xs font-semibold text-amber-100">
            Physical count closed — awaiting reconciliation
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const session =
                closedSessions.find((s) => s.id === highlightClosedId) ??
                recentCards.find((c) => c.session.id === highlightClosedId)
                  ?.session;
              if (session) void openHistory(session, { openRecon: true });
            }}
            className="mt-2 flex min-h-10 w-full items-center justify-center rounded-xl border border-emerald-400/50 bg-emerald-600/90 px-3 text-xs font-bold text-zinc-950 disabled:opacity-40"
          >
            Reconcile just-closed audit
          </button>
        </div>
      ) : null}

      {recentCards.length > 0 ? (
        <div className="space-y-1.5 pt-1" data-testid="recent-physical-audits">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Recent physical audits
          </p>
          <ul className="space-y-1.5">
            {recentCards.map((card) => {
              const highlighted = card.session.id === highlightClosedId;
              return (
                <li key={card.session.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openHistory(card.session)}
                    className={`flex min-h-12 w-full flex-col gap-0.5 rounded-xl border px-2.5 py-2 text-left ${
                      highlighted
                        ? "border-amber-400/50 bg-amber-950/25"
                        : "border-slate-800 bg-slate-950/60"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-100">
                        {formatAuditWhen(
                          card.session.closed_at ?? card.session.started_at
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        Physical count closed
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-cyan-200/90">
                      {card.physical_unit_count} units · {card.unique_item_count}{" "}
                      items · OH {card.progress.with_declared_oh}/
                      {card.progress.audited_item_count}
                      {card.progress.non_zero_variance > 0
                        ? ` · ${card.progress.non_zero_variance} variance`
                        : ""}
                      {card.progress.needs_follow_up_count > 0
                        ? ` · ${card.progress.needs_follow_up_count} follow-up`
                        : ""}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">
                      {formatApplianceReconciliationPhase(card.progress.phase)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {closedSessions.length > recentCards.length ? (
            <button
              type="button"
              data-testid="view-all-audit-history"
              onClick={() => setShowFullHistory((v) => !v)}
              className="flex min-h-10 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950/40 px-3 text-xs font-semibold text-slate-300"
            >
              {showFullHistory
                ? "Hide full history"
                : "View all audit history"}
            </button>
          ) : null}
          {showFullHistory ? (
            <ul
              data-testid="full-audit-history"
              className="max-h-48 space-y-1 overflow-y-auto pt-1"
            >
              {closedSessions.map((session) => (
                <li key={`full-${session.id}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openHistory(session)}
                    className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 text-left text-xs text-slate-200"
                  >
                    <span className="font-mono">
                      {formatAuditWhen(session.closed_at ?? session.started_at)}
                    </span>
                    <span className="text-slate-500">View</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
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
                      : formatAppliancePhysicalAuditStatus(
                          detail.session.status
                        )}
                  </h2>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                    {detail.summary.physical_unit_count} observed units ·{" "}
                    {detail.summary.unique_item_count} items
                    {detailProgress
                      ? ` · ${formatApplianceReconciliationPhase(detailProgress.phase)}`
                      : ""}
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
                          Close physical count
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
                        Finish reviewing observed units, then Close physical
                        count before declaring Lowe&apos;s OH.
                      </p>
                    ) : detailProgress ? (
                      <p
                        className="text-center text-[11px] text-slate-400"
                        data-testid="detail-recon-progress"
                      >
                        {formatApplianceReconciliationPhase(detailProgress.phase)}
                        {" · "}
                        OH {detailProgress.with_declared_oh}/
                        {detailProgress.audited_item_count}
                        {detailProgress.without_declared_oh > 0
                          ? ` · ${detailProgress.without_declared_oh} without OH`
                          : ""}
                        {detailProgress.non_zero_variance > 0
                          ? ` · ${detailProgress.non_zero_variance} non-zero variance`
                          : ""}
                        {detailProgress.resolved_count > 0
                          ? ` · ${detailProgress.resolved_count} resolved`
                          : ""}
                        {detailProgress.needs_follow_up_count > 0
                          ? ` · ${detailProgress.needs_follow_up_count} follow-up`
                          : ""}
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
                            <p className="mt-1 text-[11px] leading-snug text-slate-400">
                              Observed breakdown: Showroom {item.showroom_count}
                              {" · "}Staged pickup {item.staged_pickup_count}
                              {" · "}Staged delivery {item.staged_delivery_count}
                              {" · "}No staged disposition recorded{" "}
                              {item.no_staged_disposition_count}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-400">
                      Enter Lowe&apos;s OH from Zebra/computer. Saving updates the{" "}
                      <span className="font-semibold text-slate-300">
                        current reconciliation record
                      </span>{" "}
                      only — observed physical counts stay frozen. Blank OH leaves
                      variance unset (not zero). Outcome is optional.
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
                              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                                Observed breakdown: Showroom{" "}
                                {item.showroom_count}
                                {" · "}Staged pickup {item.staged_pickup_count}
                                {" · "}Staged delivery{" "}
                                {item.staged_delivery_count}
                                {" · "}No staged disposition recorded{" "}
                                {item.no_staged_disposition_count}
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
                      {reconSaving ? "Saving…" : "Save reconciliation"}
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
