"use client";

/**
 * RD-1 / OPS-OVERVIEW-001 — Floor Command supervisory landing.
 * Composes real This Week, Walkthrough, and MAP-003 priority evidence only.
 * No fabricated KPIs, urgency scores, or AI insights.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  fetchOperationalSections,
  fetchThisWeekRotations,
  fetchWalkthroughInbox,
  fetchWeekBayPriorities,
  invalidateStoreOpsListCaches,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
  STORE_OPS_WALKTHROUGHS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import {
  composeThisWeekOwnership,
  composeThisWeekProgressLine,
  type ThisWeekOwnershipPlan,
} from "@/lib/store-ops/this-week-ownership";
import {
  fetchSundayAssignments,
  type SundayAssignmentMap,
} from "@/lib/store-ops/sunday-audit";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { resolveNextRotationWeekLabel } from "@/lib/store-ops/week-bay-priority";
import { formatMapCalendarWeekChrome } from "@/lib/store-ops/week-copy";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import type { WalkthroughInbox } from "@/lib/store-ops/walkthroughs";
import type { WeekBayPriorityView } from "@/lib/store-ops/week-bay-priority";
import {
  indexBaySectionLookups,
  type OperationalSectionView,
} from "@/lib/store-ops/operational-sections";
import {
  composeOverviewAttention,
  composeOverviewOpenFollowUps,
  composeOverviewPeopleRows,
  composeOverviewPriorityRows,
  composeOverviewReviewRows,
} from "@/lib/store-ops/overview-command";

export function OverviewTab({ specialist }: WorkflowTabProps) {
  const week = isoWeekLabel();
  const nextWeek = resolveNextRotationWeekLabel();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walkError, setWalkError] = useState<string | null>(null);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ThisWeekOwnershipPlan | null>(null);
  const [walkInbox, setWalkInbox] = useState<WalkthroughInbox | null>(null);
  const [sections, setSections] = useState<OperationalSectionView[]>([]);
  const [priorities, setPriorities] = useState<WeekBayPriorityView[]>([]);
  const [priorityWeek, setPriorityWeek] = useState(nextWeek);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWalkError(null);
    setPriorityError(null);
    try {
      const weekPayload = await fetchThisWeekRotations(specialist);
      const rotations = weekPayload.rotations as WeeklyRotationWithLocation[];
      const [assignmentsResult, sectionsResult] = await Promise.all([
        fetchSundayAssignments(weekPayload.assigned_week || week).catch(
          () => ({}) as SundayAssignmentMap
        ),
        fetchOperationalSections(specialist, {
          includeMembers: true,
          includeRetired: false,
        }).catch(() => ({ sections: [] as OperationalSectionView[] })),
      ]);
      const activeSections = (sectionsResult.sections ?? []).filter(
        (s) => s.is_active
      );
      setSections(activeSections);
      setPlan(
        composeThisWeekOwnership({
          rotations,
          assignments: assignmentsResult,
          baySectionByKey: indexBaySectionLookups(activeSections),
        })
      );

      try {
        const { inbox } = await fetchWalkthroughInbox(specialist);
        setWalkInbox(inbox);
      } catch (err) {
        setWalkInbox(null);
        setWalkError(
          err instanceof Error ? err.message : "Could not load follow-ups"
        );
      }

      try {
        const pri = await fetchWeekBayPriorities(specialist, {
          week_label: nextWeek,
        });
        setPriorities(pri.priorities ?? []);
        setPriorityWeek(pri.week_label || nextWeek);
      } catch (err) {
        setPriorities([]);
        setPriorityError(
          err instanceof Error ? err.message : "Could not load priorities"
        );
      }
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : "Could not load Overview");
    } finally {
      setLoading(false);
    }
  }, [specialist, week, nextWeek]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChanged() {
      invalidateStoreOpsListCaches();
      void reload();
    }
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onChanged);
    window.addEventListener(STORE_OPS_WALKTHROUGHS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onChanged);
      window.removeEventListener(STORE_OPS_WALKTHROUGHS_CHANGED_EVENT, onChanged);
    };
  }, [reload]);

  const attention = useMemo(
    () =>
      composeOverviewAttention({
        plan,
        inbox: walkInbox,
        sections,
      }),
    [plan, walkInbox, sections]
  );
  const openFollowUps = useMemo(
    () => composeOverviewOpenFollowUps({ inbox: walkInbox, sections }),
    [walkInbox, sections]
  );
  const reviewRows = useMemo(
    () => composeOverviewReviewRows({ inbox: walkInbox, sections }),
    [walkInbox, sections]
  );
  const priorityRows = useMemo(
    () =>
      composeOverviewPriorityRows({
        priorities,
        weekLabel: priorityWeek,
      }),
    [priorities, priorityWeek]
  );
  const people = useMemo(() => composeOverviewPeopleRows(plan), [plan]);
  const progress = plan ? composeThisWeekProgressLine(plan) : null;

  return (
    <main className="hub-main hub-floor-command">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 pb-28 pt-3 sm:px-4 lg:max-w-5xl lg:flex-row lg:items-start lg:gap-6">
        <div className="min-w-0 flex-1 space-y-4">
          <section
            aria-label="This week"
            className="sticky top-0 z-[1] -mx-1 rounded-2xl border border-zinc-800/80 bg-zinc-950/90 px-3 py-3 backdrop-blur-md sm:mx-0"
            data-testid="overview-week-strip"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              {formatMapCalendarWeekChrome(week, "master")}
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-zinc-50">
              Overview
            </h2>
            {loading ? (
              <p className="mt-2 text-sm text-zinc-500">Loading week evidence…</p>
            ) : error ? (
              <p className="mt-2 text-sm text-rose-300" role="alert">
                {error}
              </p>
            ) : progress ? (
              <p className="mt-2 text-sm text-zinc-300">{progress}</p>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">
                Week evidence unavailable.
              </p>
            )}
            {!loading && !error && plan ? (
              <p className="mt-1 text-[11px] text-zinc-500">
                Assignment ≠ completion · Zebra entry is operator-recorded only
              </p>
            ) : null}
          </section>

          <section aria-label="Needs attention" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Needs attention
            </h3>
            {loading ? (
              <div className="h-16 animate-pulse rounded-xl bg-zinc-900/80" />
            ) : attention.length > 0 ? (
              <ul className="space-y-2" data-testid="overview-attention-list">
                {attention.map((item) => (
                  <li key={item.id}>
                    <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2">
                      <Link
                        href={item.href}
                        className="flex min-h-11 items-start justify-between gap-3 text-sm font-medium text-amber-100 transition active:scale-[0.99]"
                      >
                        <span className="min-w-0">
                          <span className="block">{item.label}</span>
                          {item.detail ? (
                            <span className="mt-0.5 block text-xs font-normal text-amber-100/70">
                              {item.detail}
                            </span>
                          ) : null}
                          {item.ownerLabel ? (
                            <span className="mt-0.5 block text-[11px] font-normal text-amber-100/55">
                              {item.ownerLabel}
                            </span>
                          ) : null}
                        </span>
                        <HubIcon
                          id="chevronRight"
                          className="mt-1 h-4 w-4 shrink-0"
                        />
                      </Link>
                      {item.mapHref ? (
                        <Link
                          href={item.mapHref}
                          className="mt-1 inline-flex min-h-10 items-center text-xs font-semibold text-accent"
                        >
                          Open on Map
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : plan?.isHealthyOwnedPlan && !walkError ? (
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3 py-3 text-sm text-emerald-100/90">
                Week on track — no attention items from current plan evidence.
              </p>
            ) : (
              <p className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-400">
                No attention signals from loaded week evidence.
              </p>
            )}
          </section>

          <section
            aria-label="Next week priorities"
            className="space-y-2"
            data-testid="overview-priorities"
          >
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Next week priorities
            </h3>
            {loading ? (
              <div className="h-14 animate-pulse rounded-xl bg-zinc-900/80" />
            ) : priorityError ? (
              <p className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-400">
                Priorities unavailable — not shown as zero.
              </p>
            ) : priorityRows.length > 0 ? (
              <ul className="space-y-2">
                {priorityRows.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2"
                  >
                    <Link
                      href={row.mapHref}
                      className="flex min-h-11 items-start justify-between gap-2 text-sm font-semibold text-zinc-100"
                    >
                      <span className="min-w-0">
                        <span className="block">{row.label}</span>
                        <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                          {row.weekLabel} · {row.intentNote}
                        </span>
                        {row.detail || row.ownerLabel ? (
                          <span className="mt-0.5 block text-[11px] font-normal text-zinc-400">
                            {[row.detail, row.ownerLabel]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <HubIcon
                        id="map"
                        className="mt-1 h-4 w-4 shrink-0 text-zinc-500"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/40 px-3 py-3 text-sm text-zinc-400">
                No supervisory priorities for {priorityWeek}. Flag bays from Map
                — priority is intent, not an assignment.
              </p>
            )}
          </section>

          <section aria-label="Primary actions" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Link
              href="/dashboard"
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-100"
            >
              <HubIcon id="calendar" className="h-4 w-4" />
              This Week
            </Link>
            <Link
              href="/admin/store-map"
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-100"
            >
              <HubIcon id="map" className="h-4 w-4" />
              Map
            </Link>
            <Link
              href="/walkthroughs"
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-100"
            >
              <HubIcon id="notes" className="h-4 w-4" />
              Walkthroughs
            </Link>
          </section>
        </div>

        <aside className="w-full space-y-4 lg:w-80 lg:shrink-0">
          <section aria-label="People this week" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              People this week
            </h3>
            {loading ? (
              <div className="h-24 animate-pulse rounded-xl bg-zinc-900/80" />
            ) : people.length > 0 ? (
              <ul className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800/80 bg-zinc-950/50">
                {people.map((owner) => (
                  <li
                    key={owner.specialistId}
                    className="flex min-h-12 items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100">
                        {owner.specialistName}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {[owner.roleLabel, owner.sectionLabel]
                          .filter(Boolean)
                          .join(" · ") || "Assigned this week"}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-xs text-zinc-400">
                      {owner.verifiedCount}/{owner.bayCount}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-400">
                <p>No owned bays in the current week plan.</p>
                <Link
                  href="/settings?manage=team"
                  className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent"
                >
                  Open Team in More
                </Link>
              </div>
            )}
          </section>

          <section aria-label="Follow-ups" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Follow-ups
            </h3>
            {walkError ? (
              <p
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-400"
                role="status"
                data-testid="overview-followups-unavailable"
              >
                Follow-ups unavailable — counts not shown.
              </p>
            ) : walkInbox && walkInbox.open_count > 0 ? (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3 text-sm">
                <p className="font-semibold text-zinc-100">
                  {walkInbox.open_count} open
                  {walkInbox.attention_count > 0
                    ? ` · ${walkInbox.attention_count} past due`
                    : ""}
                </p>
                <ul className="mt-2 space-y-2">
                  {openFollowUps.map((fu) => (
                    <li key={fu.id} className="text-xs text-zinc-400">
                      <Link
                        href={fu.href}
                        className="font-medium text-zinc-200 underline-offset-2 hover:underline"
                      >
                        {fu.label}
                      </Link>
                      {fu.detail ? (
                        <span className="block text-zinc-500">{fu.detail}</span>
                      ) : null}
                      {fu.ownerLabel ? (
                        <span className="block text-zinc-600">{fu.ownerLabel}</span>
                      ) : null}
                      {fu.mapHref ? (
                        <Link
                          href={fu.mapHref}
                          className="mt-0.5 inline-flex min-h-9 items-center font-semibold text-accent"
                        >
                          Map
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/walkthroughs"
                  className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent"
                >
                  Open Walkthroughs
                </Link>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/40 px-3 py-3 text-sm text-zinc-400">
                <p>No open walkthrough follow-ups.</p>
                <Link
                  href="/walkthroughs"
                  className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent"
                >
                  Start a walkthrough
                </Link>
              </div>
            )}
            {!walkError && reviewRows.length > 0 ? (
              <div
                className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5"
                data-testid="overview-walkthrough-review-hint"
              >
                <p className="text-xs text-zinc-400">
                  {walkInbox?.review_count ?? reviewRows.length} opportunit
                  {(walkInbox?.review_count ?? reviewRows.length) === 1
                    ? "y"
                    : "ies"}{" "}
                  without a follow-up — decide on Walkthroughs (not open work).
                </p>
                <ul className="mt-2 space-y-1.5">
                  {reviewRows.map((row) => (
                    <li key={row.id}>
                      <Link
                        href={row.href}
                        className="text-xs font-medium text-zinc-300 underline-offset-2 hover:underline"
                      >
                        {row.label.length > 72
                          ? `${row.label.slice(0, 72)}…`
                          : row.label}
                      </Link>
                      {row.detail || row.ownerLabel ? (
                        <span className="block text-[11px] text-zinc-500">
                          {[row.detail, row.ownerLabel]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </main>
  );
}
