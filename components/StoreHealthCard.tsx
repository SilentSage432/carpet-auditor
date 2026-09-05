"use client";

import { useCallback, useEffect, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  fetchStoreHealth,
  type StoreHealthSnapshotClient,
} from "@/lib/store-ops/client";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist;
  /** Bump to refetch after checklist completes */
  refreshKey?: number | string;
};

/**
 * Store Health Scorecard — first card on Zebra dashboard.
 * DS: department pace + barriers. Super Admin: storewide grid + bottleneck summary.
 * Pace % / quota progress use verified complete (Art VI). Reported is labeled separately.
 */
export function StoreHealthCard({ specialist, refreshKey }: Props) {
  const [data, setData] = useState<StoreHealthSnapshotClient | null>(null);
  const [loading, setLoading] = useState(true);
  const master = isMasterAdmin(specialist);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await fetchStoreHealth(specialist);
      setData(snapshot);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  if (loading && !data) {
    return (
      <section className="mb-3 rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2.5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
          Store Health Scorecard
        </p>
        <p className="mt-2 text-sm text-slate-400">Loading weekly pace…</p>
      </section>
    );
  }

  if (!data) return null;

  if (master) {
    return <SuperAdminHealth data={data} />;
  }

  return <DepartmentSupervisorHealth data={data} />;
}

function DepartmentSupervisorHealth({
  data,
}: {
  data: StoreHealthSnapshotClient;
}) {
  const dept = data.department;
  const assigned = dept?.assigned ?? data.totals.assigned;
  const verified =
    dept?.verified_complete ??
    data.totals.verified_complete ??
    0;
  const reported =
    dept?.reported_complete ??
    data.totals.reported_complete ??
    dept?.completed ??
    data.totals.completed;
  const awaiting =
    dept?.pending_verification ?? data.totals.pending_verification ?? 0;
  const target = dept?.weekly_bay_target ?? Math.max(assigned, 1);
  const pct =
    assigned > 0
      ? data.department?.completion_pct ?? data.totals.completion_pct
      : 0;
  const deficit =
    dept?.verified_target_deficit ??
    data.totals.verified_target_deficit ??
    Math.max(0, target - verified);
  const barriers = data.barriers;
  const [barriersOpen, setBarriersOpen] = useState(false);

  return (
    <section className="mb-3 rounded-2xl border-2 border-emerald-500/35 bg-emerald-950/25 px-3 py-2.5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
        Store Health Scorecard
      </p>
      <h2 className="mt-0.5 text-base font-bold text-slate-50">My Department Pace</h2>
      <p className="mt-0.5 font-mono text-xs text-slate-400">
        {data.assigned_week || "This week"}
        {dept ? ` · ${dept.department_name}` : ""}
      </p>

      <div className="mt-2">
        <div className="mb-1.5 flex items-end justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">
            {verified}/{assigned > 0 ? assigned : target} Bays Verified
          </p>
          <p className="font-mono text-xs text-emerald-300">{pct}%</p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width]"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Target {target}/week · deficit {deficit}
          {awaiting > 0 ? ` · ${awaiting} awaiting review` : ""}
          {reported > verified
            ? ` · ${reported} reported`
            : ""}
        </p>
      </div>

      {barriers.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={barriersOpen}
            onClick={() => setBarriersOpen((o) => !o)}
            className="flex min-h-11 w-full items-center justify-between text-left font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300"
          >
            Logged barriers ({barriers.length})
            <HubIcon
              id={barriersOpen ? "chevronUp" : "chevronDown"}
              className="h-4 w-4"
            />
          </button>
          {barriersOpen ? (
            <ul className="mt-2 space-y-1.5">
              {barriers.slice(0, 5).map((b) => (
                <li
                  key={b.id}
                  className="rounded-lg border border-amber-500/25 bg-slate-950/50 px-3 py-2 text-sm text-amber-100"
                >
                  {b.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SuperAdminHealth({ data }: { data: StoreHealthSnapshotClient }) {
  const { totals, departments, bottleneck_summary } = data;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const verified = totals.verified_complete ?? 0;
  const reported = totals.reported_complete ?? totals.completed;
  const awaiting = totals.pending_verification ?? 0;

  return (
    <section className="mb-3 rounded-2xl border-2 border-amber-400/40 bg-amber-950/20 px-3 py-2.5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
        Store Health Scorecard
      </p>
      <h2 className="mt-0.5 text-base font-bold text-slate-50">
        Storewide Verification
      </h2>
      <p className="mt-0.5 font-mono text-xs text-slate-400">
        {data.assigned_week || "This week"} · {verified}/{totals.assigned}{" "}
        verified · {totals.completion_pct}%
        {awaiting > 0 ? ` · ${awaiting} awaiting` : ""}
        {reported > verified ? ` · ${reported} reported` : ""}
      </p>

      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-amber-400 transition-[width]"
          style={{ width: `${Math.min(100, totals.completion_pct)}%` }}
        />
      </div>

      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((o) => !o)}
        className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-amber-500/25 bg-slate-950/40 px-3 text-left text-sm font-semibold text-amber-100"
      >
        <span>
          Departments &amp; bottlenecks
          {bottleneck_summary.length > 0
            ? ` · ${bottleneck_summary.length} flagged`
            : ""}
        </span>
        <HubIcon
          id={detailsOpen ? "chevronUp" : "chevronDown"}
          className="h-4 w-4 text-slate-400"
        />
      </button>

      {detailsOpen ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {departments.length === 0 ? (
              <p className="text-sm text-slate-400 sm:col-span-2">
                No department rotations this week yet.
              </p>
            ) : (
              departments.map((d) => (
                <div
                  key={d.department_id}
                  className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-50">
                      {d.department_name}
                    </p>
                    <span className="font-mono text-[10px] font-bold text-slate-400">
                      {d.completion_pct}%
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">
                    {d.verified_complete ?? 0}/{d.assigned || d.weekly_bay_target}{" "}
                    verified
                    {(d.pending_verification ?? 0) > 0
                      ? ` · ${d.pending_verification} awaiting`
                      : ""}
                    {d.exception_count > 0
                      ? ` · ${d.exception_count} barrier${
                          d.exception_count === 1 ? "" : "s"
                        }`
                      : ""}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-slate-950/50 px-3 py-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Bottleneck Summary
            </p>
            {bottleneck_summary.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">
                No flagged operational delays this week.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {bottleneck_summary.map((b) => (
                  <li
                    key={b.label}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 font-mono text-xs font-semibold text-amber-100"
                  >
                    {b.label}: {b.count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
