"use client";

/**
 * RD-1 Overview — Floor Command landing.
 * Composes real This Week evidence only. No fabricated KPIs or AI insights.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  fetchThisWeekRotations,
  invalidateStoreOpsListCaches,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
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
import { formatMapCalendarWeekChrome } from "@/lib/store-ops/week-copy";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";

type AttentionItem = {
  id: string;
  label: string;
  href: string;
};

function attentionFromPlan(plan: ThisWeekOwnershipPlan): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (plan.needsDispatchRecovery) {
    items.push({
      id: "no-plan",
      label: "No weekly plan staged yet",
      href: "/dashboard",
    });
  }
  if (plan.needsOwnershipRecovery) {
    items.push({
      id: "unowned",
      label: `${plan.unownedPhysicalBayCount} staged bay${
        plan.unownedPhysicalBayCount === 1 ? "" : "s"
      } still need an owner`,
      href: "/dashboard",
    });
  }
  if (plan.pendingVerificationCount > 0) {
    items.push({
      id: "verify",
      label: `${plan.pendingVerificationCount} bay${
        plan.pendingVerificationCount === 1 ? "" : "s"
      } awaiting verification`,
      href: "/dashboard",
    });
  }
  if (plan.barrierBayCount > 0) {
    items.push({
      id: "barrier",
      label: `${plan.barrierBayCount} bay${
        plan.barrierBayCount === 1 ? "" : "s"
      } with an open barrier`,
      href: "/dashboard",
    });
  }
  return items;
}

export function OverviewTab({ specialist }: WorkflowTabProps) {
  const week = isoWeekLabel();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ThisWeekOwnershipPlan | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const weekPayload = await fetchThisWeekRotations(specialist);
      const rotations = weekPayload.rotations as WeeklyRotationWithLocation[];
      let assignments: SundayAssignmentMap = {};
      try {
        assignments = await fetchSundayAssignments(
          weekPayload.assigned_week || week
        );
      } catch {
        assignments = {};
      }
      setPlan(composeThisWeekOwnership({ rotations, assignments }));
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : "Could not load Overview");
    } finally {
      setLoading(false);
    }
  }, [specialist, week]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChanged() {
      invalidateStoreOpsListCaches();
      void reload();
    }
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onChanged);
    };
  }, [reload]);

  const attention = plan ? attentionFromPlan(plan) : [];
  const progress = plan ? composeThisWeekProgressLine(plan) : null;

  return (
    <main className="hub-main hub-floor-command">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 pb-28 pt-3 sm:px-4 lg:max-w-5xl lg:flex-row lg:items-start lg:gap-6">
        <div className="min-w-0 flex-1 space-y-4">
          <section
            aria-label="This week"
            className="sticky top-0 z-[1] -mx-1 rounded-2xl border border-zinc-800/80 bg-zinc-950/90 px-3 py-3 backdrop-blur-md sm:mx-0"
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
          </section>

          <section aria-label="Needs attention" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Needs attention
            </h3>
            {loading ? (
              <div className="h-16 animate-pulse rounded-xl bg-zinc-900/80" />
            ) : attention.length > 0 ? (
              <ul className="space-y-2">
                {attention.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-sm font-medium text-amber-100 transition active:scale-[0.99]"
                    >
                      <span>{item.label}</span>
                      <HubIcon id="chevronRight" className="h-4 w-4 shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : plan?.isHealthyOwnedPlan ? (
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3 py-3 text-sm text-emerald-100/90">
                Week on track — no attention items from current plan evidence.
              </p>
            ) : (
              <p className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-400">
                No attention signals from loaded week evidence.
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
            ) : plan && plan.owners.length > 0 ? (
              <ul className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800/80 bg-zinc-950/50">
                {plan.owners.map((owner) => (
                  <li
                    key={owner.specialistId}
                    className="flex min-h-12 items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100">
                        {owner.specialistName}
                      </p>
                      {owner.roleLabel ? (
                        <p className="truncate text-[11px] text-zinc-500">
                          {owner.roleLabel}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 font-mono text-xs text-zinc-400">
                      {owner.verifiedCount}/{owner.bays.length}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-400">
                <p>No owned bays in the current week plan.</p>
                <Link
                  href="/roster"
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
            <div className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/40 px-3 py-3 text-sm text-zinc-400">
              <p>
                Walkthrough follow-ups are not stored yet. Capture stays in Floor
                Pad until the walkthrough domain lands.
              </p>
              <Link
                href="/walkthroughs"
                className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent"
              >
                Open Walkthroughs
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
