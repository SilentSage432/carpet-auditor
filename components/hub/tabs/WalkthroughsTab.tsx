"use client";

/**
 * RD-5 / WALK-005 Walkthroughs — collaborative leadership follow-through.
 * Real persisted observations / follow-ups only. No scoring. No fabricated history.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import { WalkthroughCaptureSheet } from "@/components/walkthroughs/WalkthroughCaptureSheet";
import { FollowUpCloseSheet } from "@/components/walkthroughs/FollowUpCloseSheet";
import { ObservationDetailSheet } from "@/components/walkthroughs/ObservationDetailSheet";
import {
  endWalkthroughSessionClient,
  fetchOperationalSections,
  fetchWalkthroughInbox,
  STORE_OPS_WALKTHROUGHS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import type { OperationalSectionView } from "@/lib/store-ops/operational-sections";
import {
  observationTypeLabel,
  type WalkthroughFollowUpView,
  type WalkthroughInbox,
  type WalkthroughObservationView,
} from "@/lib/store-ops/walkthroughs";
import { buildExecutiveFloorPadHref } from "@/lib/specialty-tools";
import { dedupeRoster, fetchSpecialists, isSupervisor } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";
import { toastError, toastSuccess } from "@/lib/toast";

function typeTone(type: string): string {
  if (type === "positive") return "text-emerald-200 border-emerald-700/50 bg-emerald-950/30";
  if (type === "opportunity") return "text-amber-200 border-amber-700/50 bg-amber-950/30";
  return "text-zinc-200 border-zinc-700/60 bg-zinc-900/50";
}

function followUpStatusChip(item: WalkthroughObservationView): {
  label: string;
  className: string;
} | null {
  if (item.has_open_follow_up) {
    return {
      label: "Follow-up open",
      className:
        "border-amber-700/50 bg-amber-950/40 text-amber-100",
    };
  }
  if ((item.done_follow_up_count ?? 0) > 0) {
    return {
      label: "Follow-up done",
      className:
        "border-emerald-700/40 bg-emerald-950/30 text-emerald-100",
    };
  }
  if (item.awaiting_follow_up_decision) {
    return {
      label: "Needs decision",
      className: "border-zinc-600 bg-zinc-900 text-zinc-300",
    };
  }
  return null;
}

function ObservationCard({
  item,
  onOpen,
}: {
  item: WalkthroughObservationView;
  onOpen: (item: WalkthroughObservationView) => void;
}) {
  const status = followUpStatusChip(item);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="w-full rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3 text-left transition active:bg-zinc-900/80"
        data-testid="walkthrough-observation-card"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${typeTone(
                item.observation_type
              )}`}
            >
              {item.type_label ?? observationTypeLabel(item.observation_type)}
            </span>
            {status ? (
              <span
                className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${status.className}`}
              >
                {status.label}
              </span>
            ) : null}
          </div>
          <time className="shrink-0 font-mono text-[10px] text-zinc-500">
            {new Date(item.observed_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </div>
        <p className="mt-2 text-sm leading-snug text-zinc-100">{item.body}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          {item.associate_name ? <span>With {item.associate_name}</span> : null}
          {item.section_name ? <span>Section: {item.section_name}</span> : null}
          {item.place_label ? <span>{item.place_label}</span> : null}
        </div>
      </button>
    </li>
  );
}

function FollowUpCard({
  item,
  canMutate,
  onClose,
  onOpenObservation,
}: {
  item: WalkthroughFollowUpView;
  canMutate: boolean;
  onClose: (item: WalkthroughFollowUpView) => void;
  onOpenObservation?: (observationId: string) => void;
}) {
  return (
    <li className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-100">{item.action_text}</p>
        {item.needs_attention ? (
          <span className="shrink-0 rounded-lg border border-amber-700/50 bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-100">
            Needs attention
          </span>
        ) : item.status === "done" ? (
          <span className="shrink-0 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-100">
            Done
          </span>
        ) : (
          <span className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
            Open
          </span>
        )}
      </div>
      {item.observation_body ? (
        onOpenObservation ? (
          <button
            type="button"
            onClick={() => onOpenObservation(item.observation_id)}
            className="mt-1 block text-left text-xs text-zinc-500 underline-offset-2 hover:underline"
          >
            From: {item.observation_body}
          </button>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">From: {item.observation_body}</p>
        )
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {item.responsible_name ? <span>{item.responsible_name}</span> : null}
        {item.section_name ? <span>Section: {item.section_name}</span> : null}
        {item.due_on ? <span>Target {item.due_on}</span> : null}
        {item.place_label ? <span>{item.place_label}</span> : null}
      </div>
      {item.needs_attention ? (
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Past target date — a reminder for follow-through, not an evaluation.
        </p>
      ) : null}
      {canMutate && item.status === "open" ? (
        <button
          type="button"
          onClick={() => onClose(item)}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/80 text-sm font-semibold text-zinc-100"
        >
          Close with evidence
        </button>
      ) : null}
      {item.status === "done" && item.completion_evidence ? (
        <p className="mt-2 text-xs text-zinc-400">{item.completion_evidence}</p>
      ) : null}
    </li>
  );
}

export function WalkthroughsTab({ specialist }: WorkflowTabProps) {
  const searchParams = useSearchParams();
  const deepLinkObservationId = String(
    searchParams.get("observation") ?? ""
  ).trim();
  const canMutate = isSupervisor(specialist);
  const canOpenFloorPad = canMutate;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inbox, setInbox] = useState<WalkthroughInbox | null>(null);
  const [team, setTeam] = useState<StoreSpecialist[]>([]);
  const [sections, setSections] = useState<OperationalSectionView[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [closing, setClosing] = useState<WalkthroughFollowUpView | null>(null);
  const [viewing, setViewing] = useState<WalkthroughObservationView | null>(
    null
  );
  const [ending, setEnding] = useState(false);
  const deepLinkHandledRef = useRef<string | null>(null);

  const allFollowUps = useMemo(() => {
    if (!inbox) return [] as WalkthroughFollowUpView[];
    const byId = new Map<string, WalkthroughFollowUpView>();
    for (const fu of [
      ...inbox.open_follow_ups,
      ...inbox.completed_follow_ups,
      ...inbox.attention_follow_ups,
    ]) {
      byId.set(fu.id, fu);
    }
    return [...byId.values()];
  }, [inbox]);

  const observationsById = useMemo(() => {
    const map = new Map<string, WalkthroughObservationView>();
    if (!inbox) return map;
    for (const o of [
      ...inbox.recent_observations,
      ...inbox.review_observations,
    ]) {
      map.set(o.id, o);
    }
    return map;
  }, [inbox]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ inbox: next }, roster, sectionPayload] = await Promise.all([
        fetchWalkthroughInbox(specialist),
        fetchSpecialists().then(dedupeRoster).catch(() => [] as StoreSpecialist[]),
        fetchOperationalSections(specialist, { includeMembers: false }).catch(
          () => ({ sections: [] as OperationalSectionView[] })
        ),
      ]);
      setInbox(next);
      setTeam(roster);
      setSections(sectionPayload.sections.filter((s) => s.is_active));
      setViewing((prev) => {
        if (!prev) return null;
        const refreshed =
          next.recent_observations.find((o) => o.id === prev.id) ??
          next.review_observations.find((o) => o.id === prev.id) ??
          null;
        return refreshed;
      });
      // OPS-OVERVIEW-001 — honor ?observation= deep-link after inbox load.
      const deepId = deepLinkObservationId;
      if (deepId && deepLinkHandledRef.current !== deepId) {
        deepLinkHandledRef.current = deepId;
        const found =
          next.recent_observations.find((o) => o.id === deepId) ??
          next.review_observations.find((o) => o.id === deepId) ??
          null;
        if (found) {
          setViewing(found);
        } else {
          const fu = [
            ...next.open_follow_ups,
            ...next.completed_follow_ups,
            ...next.attention_follow_ups,
          ].find((f) => f.observation_id === deepId);
          if (fu) {
            setViewing({
              id: deepId,
              store_id: fu.store_id,
              session_id: fu.session_id,
              observation_type: fu.observation_type ?? "general",
              body: fu.observation_body ?? "Observation",
              associate_specialist_id: null,
              section_id: fu.section_id ?? null,
              department_id: fu.department_id ?? null,
              aisle: fu.aisle ?? null,
              bay: fu.bay ?? null,
              observed_at: fu.created_at,
              created_by_specialist_id: fu.created_by_specialist_id,
              created_at: fu.created_at,
              updated_at: fu.updated_at,
              place_label: fu.place_label ?? null,
              section_name: fu.section_name ?? null,
              type_label: fu.observation_type
                ? observationTypeLabel(fu.observation_type)
                : undefined,
              has_open_follow_up: fu.status === "open",
              open_follow_up_count: fu.status === "open" ? 1 : 0,
              done_follow_up_count: fu.status === "done" ? 1 : 0,
            });
          }
        }
      }
    } catch (err) {
      setInbox(null);
      const message =
        err instanceof Error ? err.message : "Could not load walkthroughs";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [specialist, deepLinkObservationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onChanged = () => void reload();
    window.addEventListener(STORE_OPS_WALKTHROUGHS_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(STORE_OPS_WALKTHROUGHS_CHANGED_EVENT, onChanged);
  }, [reload]);

  async function endActive() {
    if (!inbox?.active_session) return;
    setEnding(true);
    try {
      await endWalkthroughSessionClient(specialist, inbox.active_session.id);
      toastSuccess("Walkthrough ended");
      await reload();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not end walkthrough"
      );
    } finally {
      setEnding(false);
    }
  }

  const openObservationById = useCallback(
    (observationId: string) => {
      const found = observationsById.get(observationId);
      if (found) {
        setViewing(found);
        return;
      }
      // Observation may be outside recent window — synthesize minimal view from follow-up.
      const fu = allFollowUps.find((f) => f.observation_id === observationId);
      if (!fu) return;
      setViewing({
        id: observationId,
        store_id: fu.store_id,
        session_id: fu.session_id,
        observation_type: fu.observation_type ?? "general",
        body: fu.observation_body ?? "Observation",
        associate_specialist_id: null,
        section_id: fu.section_id ?? null,
        department_id: fu.department_id ?? null,
        aisle: fu.aisle ?? null,
        bay: fu.bay ?? null,
        observed_at: fu.created_at,
        created_by_specialist_id: fu.created_by_specialist_id,
        created_at: fu.created_at,
        updated_at: fu.updated_at,
        place_label: fu.place_label ?? null,
        section_name: fu.section_name ?? null,
        type_label: fu.observation_type
          ? observationTypeLabel(fu.observation_type)
          : undefined,
        has_open_follow_up: fu.status === "open",
        open_follow_up_count: fu.status === "open" ? 1 : 0,
        done_follow_up_count: fu.status === "done" ? 1 : 0,
      });
    },
    [observationsById, allFollowUps]
  );

  const empty =
    !loading &&
    inbox &&
    inbox.recent_observations.length === 0 &&
    inbox.open_follow_ups.length === 0 &&
    inbox.completed_follow_ups.length === 0 &&
    inbox.review_observations.length === 0;

  const openNonAttention =
    inbox?.open_follow_ups.filter((f) => !f.needs_attention) ?? [];

  return (
    <main className="hub-main hub-floor-command">
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-3 pb-28 pt-4 sm:px-4">
        <header>
          <h2 className="text-lg font-bold tracking-tight text-zinc-50">
            Walkthroughs
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Observe · discuss · agree · follow through — not scoring.
          </p>
        </header>

        {canMutate ? (
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => setCaptureOpen(true)}
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-bold text-zinc-950"
              data-testid="walkthrough-begin"
            >
              <HubIcon id="notes" className="h-5 w-5" />
              {inbox?.active_session
                ? "Add observation"
                : "Begin walkthrough"}
            </button>
            {inbox?.active_session ? (
              <button
                type="button"
                disabled={ending}
                onClick={() => void endActive()}
                className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/70 text-sm font-semibold text-zinc-200 disabled:opacity-50"
              >
                {ending ? "Ending…" : "End active walkthrough"}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm text-zinc-400">
            Walkthrough capture is available to the department supervisor.
          </p>
        )}

        {loading ? (
          <div className="h-28 animate-pulse rounded-2xl bg-zinc-900/80" />
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-3 text-sm text-rose-100">
            {error}
            {/not migrated|missing_relation|503/i.test(error) ? (
              <p className="mt-1 text-xs text-rose-200/80">
                Apply the local walkthrough migration before expecting persisted
                records.
              </p>
            ) : null}
          </div>
        ) : null}

        {empty ? (
          <section
            aria-label="No walkthrough activity"
            className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/50 px-4 py-6"
            data-testid="walkthrough-empty"
          >
            <h3 className="text-base font-semibold text-zinc-100">
              No walkthrough history yet
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Start a walkthrough to capture positives, opportunities, and
              optional follow-ups. Nothing here is invented sample data.
            </p>
          </section>
        ) : null}

        {inbox && inbox.attention_count > 0 ? (
          <section aria-label="Follow-ups needing attention" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-amber-200/90">
              Needs attention · {inbox.attention_count}
            </h3>
            <ul className="space-y-2">
              {inbox.attention_follow_ups.map((item) => (
                <FollowUpCard
                  key={item.id}
                  item={item}
                  canMutate={canMutate}
                  onClose={setClosing}
                  onOpenObservation={openObservationById}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {openNonAttention.length > 0 ? (
          <section aria-label="Open follow-ups" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Open follow-ups · {inbox?.open_count ?? 0}
            </h3>
            <ul className="space-y-2">
              {openNonAttention.map((item) => (
                <FollowUpCard
                  key={item.id}
                  item={item}
                  canMutate={canMutate}
                  onClose={setClosing}
                  onOpenObservation={openObservationById}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {inbox && inbox.review_count > 0 ? (
          <section
            aria-label="Opportunities needing a follow-up decision"
            className="space-y-2"
            data-testid="walkthrough-review-observations"
          >
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Needs follow-up decision · {inbox.review_count}
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              Opportunities without an open follow-up. Not open work until you
              add one — positives never appear here.
            </p>
            <ul className="space-y-2">
              {inbox.review_observations.map((item) => (
                <ObservationCard
                  key={item.id}
                  item={item}
                  onOpen={setViewing}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {inbox && inbox.recent_observations.length > 0 ? (
          <section aria-label="Recent observations" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Recent observations
            </h3>
            <ul className="space-y-2">
              {inbox.recent_observations.map((item) => (
                <ObservationCard
                  key={item.id}
                  item={item}
                  onOpen={setViewing}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {inbox && inbox.completed_follow_ups.length > 0 ? (
          <section aria-label="Completed follow-ups" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Recently completed
            </h3>
            <ul className="space-y-2">
              {inbox.completed_follow_ups.map((item) => (
                <FollowUpCard
                  key={item.id}
                  item={item}
                  canMutate={false}
                  onClose={setClosing}
                  onOpenObservation={openObservationById}
                />
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-2">
          {canOpenFloorPad ? (
            <Link
              href={buildExecutiveFloorPadHref()}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-violet-500/35 bg-violet-950/25 px-3 text-sm font-semibold text-violet-100"
            >
              <HubIcon id="notes" className="h-4 w-4" />
              Open Floor Pad (freeform notes)
            </Link>
          ) : null}
          <Link
            href="/overview"
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-100"
          >
            Back to Overview
          </Link>
        </div>
      </div>

      {captureOpen ? (
        <WalkthroughCaptureSheet
          specialist={specialist}
          team={team}
          sections={sections}
          activeSessionId={inbox?.active_session?.id ?? null}
          onClose={() => setCaptureOpen(false)}
          onSaved={() => void reload()}
        />
      ) : null}

      {viewing ? (
        <ObservationDetailSheet
          specialist={specialist}
          observation={viewing}
          followUps={allFollowUps}
          team={team}
          canMutate={canMutate}
          onClose={() => setViewing(null)}
          onSaved={() => void reload()}
          onCloseFollowUp={(fu) => {
            setClosing(fu);
          }}
        />
      ) : null}

      {closing ? (
        <FollowUpCloseSheet
          specialist={specialist}
          followUp={closing}
          onClose={() => setClosing(null)}
          onSaved={() => void reload()}
        />
      ) : null}
    </main>
  );
}
