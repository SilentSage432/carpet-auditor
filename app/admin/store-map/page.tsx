"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BulkLocationGenerator } from "@/components/admin/BulkLocationGenerator";
import { ForceRotationModal } from "@/components/admin/ForceRotationModal";
import { StoreLocationGrid } from "@/components/admin/StoreLocationGrid";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { SuperAdminQuickActions } from "@/components/hub/SuperAdminQuickActions";
import { isMasterAdmin } from "@/lib/rbac";
import {
  fetchDepartments,
  fetchStoreLocations,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import { isoWeekLabel } from "@/lib/store-ops/week";
import type { StoreSpecialist } from "@/lib/types";

export default function StoreMapAdminPage() {
  return (
    <SessionGate
      allow={isMasterAdmin}
      denyMessage="Store Map is restricted to Super Admin / Master Admin."
      denyHref="/dashboard"
      denyLinkLabel="Open Zebra dashboard"
    >
      {({ specialist, storeNumber, logout }) => (
        <StoreMapBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function StoreMapBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapMgmtOpen, setMapMgmtOpen] = useState(false);
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const currentWeek = isoWeekLabel();

  const reload = useCallback(async (member: StoreSpecialist) => {
    setLoading(true);
    setError(null);
    try {
      const [depts, locs] = await Promise.all([
        fetchDepartments(member),
        fetchStoreLocations(member),
      ]);
      setDepartments(depts);
      setLocations(locs);
    } catch (err) {
      setError(readableError(err, "Failed to load store map"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(specialist);
  }, [specialist, reload]);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === "#bulk-generate" || hash === "#map-management") {
      setMapMgmtOpen(true);
    }
    if (hash === "#weekly-rotation") {
      setForceOpen(true);
    }
  }, [loading]);

  const departmentOverview = useMemo(() => {
    return departments.map((dept) => {
      const rows = locations.filter((l) => l.department_id === dept.id);
      const active = rows.filter((l) => l.is_active).length;
      const pending = rows.filter(
        (l) => l.is_active && l.status === "PENDING"
      ).length;
      const assigned = rows.filter(
        (l) => l.is_active && l.status === "ASSIGNED"
      ).length;
      const aisles = new Set(rows.map((l) => l.aisle)).size;
      return {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        total: rows.length,
        active,
        pending,
        assigned,
        aisles,
        weeklyTarget: dept.weekly_bay_target ?? 10,
      };
    });
  }, [departments, locations]);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Store Map"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <SuperAdminQuickActions
          specialist={specialist}
          onBulkGenerate={() => {
            setMapMgmtOpen(true);
            window.requestAnimationFrame(() => {
              document
                .getElementById("map-management")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }}
          onTriggerRotation={() => setForceOpen(true)}
        />

        <section className="mb-5 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
            Automated engine
          </p>
          <p className="mt-1 text-sm font-medium text-slate-100">
            Automated Cron: Active · Last Draw: Current ISO Week ({currentWeek})
          </p>
        </section>

        {error ? (
          <p className="mb-4 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
            <span className="mt-1 block text-red-200/70">
              Check <code className="font-mono text-xs">.env.local</code> has
              real Supabase URL + service role key (not placeholders), restart{" "}
              <code className="font-mono text-xs">npm run dev</code>, and confirm
              the store-ops migration ran on that same project.
            </span>
          </p>
        ) : null}

        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/60">
            <button
              type="button"
              aria-expanded={isOverviewOpen}
              onClick={() => setIsOverviewOpen((open) => !open)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                  Department Overview
                </p>
                {!isOverviewOpen ? (
                  <p className="mt-1">
                    <span className="inline-flex rounded-lg bg-slate-800 px-2 py-1 font-mono text-[11px] font-semibold text-slate-200">
                      {loading
                        ? "Loading…"
                        : `${departmentOverview.length} Department${
                            departmentOverview.length === 1 ? "" : "s"
                          } Registered`}
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-slate-400">
                    High-level map status by department
                  </p>
                )}
              </div>
              <span
                aria-hidden
                className="shrink-0 font-mono text-base text-slate-300"
              >
                {isOverviewOpen ? "▲" : "▼"}
              </span>
            </button>
            {isOverviewOpen ? (
              <div className="border-t border-slate-800 px-3 pb-4 pt-3">
                {loading ? (
                  <p className="text-sm text-slate-400">Loading departments…</p>
                ) : departmentOverview.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-400">
                    No departments yet. Seed departments, then use Map
                    Management.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {departmentOverview.map((row) => (
                      <li
                        key={row.id}
                        className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-50">
                              {row.name}
                            </p>
                            <p className="font-mono text-[11px] text-slate-400">
                              {row.code} · target {row.weeklyTarget}/week
                            </p>
                          </div>
                          <span className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 font-mono text-[10px] font-bold text-slate-300">
                            {row.aisles} aisle{row.aisles === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-300">
                          {row.total} tags · {row.active} active · {row.pending}{" "}
                          pending · {row.assigned} assigned
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </section>

          <section
            id="map-management"
            className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/60"
          >
            <button
              type="button"
              id="bulk-generate"
              aria-expanded={mapMgmtOpen}
              onClick={() => setMapMgmtOpen((open) => !open)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                  Map Management &amp; Bulk Add
                </p>
                <p className="mt-0.5 text-sm text-slate-400">
                  Expand to generate aisle/bay Selling + Topstock tags
                </p>
              </div>
              <span
                aria-hidden
                className="shrink-0 font-mono text-base text-slate-300"
              >
                {mapMgmtOpen ? "▲" : "▼"}
              </span>
            </button>
            {mapMgmtOpen ? (
              <div className="border-t border-slate-800 px-3 pb-4 pt-3">
                <BulkLocationGenerator
                  specialist={specialist}
                  departments={departments}
                  onGenerated={() => void reload(specialist)}
                />
              </div>
            ) : null}
          </section>

          {loading ? (
            <p className="text-sm text-slate-400">Loading locations…</p>
          ) : (
            <StoreLocationGrid
              specialist={specialist}
              departments={departments}
              locations={locations}
              onChanged={() => void reload(specialist)}
            />
          )}
        </div>
      </main>

      <ForceRotationModal
        open={forceOpen}
        onClose={() => setForceOpen(false)}
        specialist={specialist}
        departments={departments}
        initialDepartmentId={departments[0]?.id}
        onForced={() => void reload(specialist)}
      />
    </div>
  );
}
