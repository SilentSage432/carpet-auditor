"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StoreLocationGrid } from "@/components/admin/StoreLocationGrid";
import { openAdminTools } from "@/components/hub/admin-tools-events";
import { HubIcon } from "@/components/hub/NavIcons";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { VisualBayScannerModal } from "@/components/store-ops/VisualBayScannerModal";
import { actorFromSpecialist } from "@/lib/store-ops/auth";
import { isMasterAdmin } from "@/lib/rbac";
import {
  fetchDepartmentsDetailed,
  fetchExceptionSummary,
  fetchStoreLocationsDetailed,
  fetchThisWeekRotations,
  updateDepartmentActive,
} from "@/lib/store-ops/client";
import {
  isStoreOpsAuthFailureMessage,
  STORE_OPS_AUTH_HINT,
} from "@/lib/store-ops/auth-soft";
import { readableError } from "@/lib/store-ops/errors";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import { isoWeekLabel } from "@/lib/store-ops/week";
import type { StoreSpecialist } from "@/lib/types";

export default function StoreMapAdminPage() {
  return (
    <SessionGate
      allow={(m) => Boolean(actorFromSpecialist(m))}
      denyMessage="Store Map is for department associates, supervisors, and Master Admin."
      denyHref="/dashboard"
      denyLinkLabel="Open Floor dashboard"
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
  const [authRequired, setAuthRequired] = useState(false);
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
  const [bayScanOpen, setBayScanOpen] = useState(false);
  const [weekRotationLocations, setWeekRotationLocations] = useState<
    Array<{ locationId: string; completed: boolean }>
  >([]);
  const [barrierLocationIds, setBarrierLocationIds] = useState<string[]>([]);
  const currentWeek = isoWeekLabel();
  const master = isMasterAdmin(specialist);

  const reload = useCallback(async (member: StoreSpecialist) => {
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    try {
      const [depts, locs, weekData, exceptions] = await Promise.all([
        fetchDepartmentsDetailed(member),
        fetchStoreLocationsDetailed(member),
        fetchThisWeekRotations(member).catch(() => ({
          assigned_week: "",
          rotations: [] as Array<{
            location_id?: string;
            is_completed?: boolean;
            store_locations?: { id?: string } | null;
          }>,
        })),
        fetchExceptionSummary(member).catch(() => ({
          exceptions: [] as Array<{ bay_id: string }>,
        })),
      ]);
      setDepartments(depts.items);
      setLocations(locs.items);
      setWeekRotationLocations(
        (weekData.rotations ?? []).map((row) => ({
          locationId: String(row.location_id || row.store_locations?.id || ""),
          completed: Boolean(row.is_completed),
        })).filter((row) => row.locationId)
      );
      setBarrierLocationIds(
        (exceptions.exceptions ?? [])
          .map((row) => String(row.bay_id ?? ""))
          .filter(Boolean)
      );
      if (depts.authRequired || locs.authRequired) {
        setAuthRequired(true);
      }
    } catch (err) {
      const message = readableError(err, "Failed to load store map");
      if (isStoreOpsAuthFailureMessage(message)) {
        setAuthRequired(true);
        setDepartments([]);
        setLocations([]);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(specialist);
  }, [specialist, reload]);

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
        isActive: dept.is_active !== false,
        total: rows.length,
        active,
        pending,
        assigned,
        aisles,
        weeklyTarget: dept.weekly_bay_target ?? 10,
      };
    });
  }, [departments, locations]);

  async function toggleDepartment(deptId: string, next: boolean) {
    setToggleBusyId(deptId);
    setError(null);
    try {
      const updated = await updateDepartmentActive(specialist, deptId, next);
      setDepartments((prev) =>
        prev.map((d) => (d.id === updated.id ? updated : d))
      );
    } catch (err) {
      setError(readableError(err, "Could not update department toggle"));
    } finally {
      setToggleBusyId(null);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Store Map"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="hub-main">
        <p className="mb-2 font-mono text-[11px] text-zinc-400">
          {master ? (
            <>
              Week {currentWeek}
              {" · "}
              <button
                type="button"
                onClick={() => openAdminTools({ section: "bulk" })}
                className="font-semibold text-amber-300 underline-offset-2 hover:underline"
              >
                Bulk generate / Admin tools
              </button>
            </>
          ) : (
            <>This week&apos;s bay map</>
          )}
        </p>

        <button
          type="button"
          onClick={() => setBayScanOpen(true)}
          className="btn-primary-glow mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm"
        >
          <HubIcon id="camera" className="h-4 w-4" />
          Snap Bay AI Audit
        </button>

        {authRequired ? (
          <p className="glass-card mb-3 border-amber-500/40 bg-amber-950/25 px-3 py-2.5 text-sm text-amber-100">
            {STORE_OPS_AUTH_HINT}
            <span className="mt-1 block text-amber-200/75">
              Enter your Hub PIN on the unlock screen (or sign out and back in).
              That mints Store Ops Auth automatically — phone OTP is optional
              recovery only.
            </span>
            <button
              type="button"
              onClick={() => void reload(specialist)}
              className="mt-3 min-h-11 rounded-xl border border-amber-500/45 bg-amber-950/40 px-3 text-xs font-semibold text-amber-100"
            >
              Retry after Hub sign-in
            </button>
          </p>
        ) : null}

        {error ? (
          <p className="glass-card mb-3 border-rose-500/40 px-3 py-2.5 text-sm text-rose-200">
            {error}
            <span className="mt-1 block text-rose-200/70">
              Check <code className="font-mono text-xs">.env.local</code> has
              real Supabase URL + service role key (not placeholders), restart{" "}
              <code className="font-mono text-xs">npm run dev</code>, and confirm
              the store-ops migration ran on that same project.
            </span>
          </p>
        ) : null}

        <div className="space-y-3">
          <section className="glass-card overflow-hidden !p-0">
            <button
              type="button"
              aria-expanded={isOverviewOpen}
              onClick={() => setIsOverviewOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                  Department Overview
                </p>
                {!isOverviewOpen ? (
                  <p className="mt-1">
                    <span className="inline-flex rounded-lg border border-zinc-700/80 bg-zinc-950/70 px-2 py-1 font-mono text-[11px] font-semibold text-zinc-200">
                      {loading
                        ? "Loading…"
                        : `${departmentOverview.length} Department${
                            departmentOverview.length === 1 ? "" : "s"
                          } Registered`}
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-zinc-400">
                    High-level map status by department
                  </p>
                )}
              </div>
              <HubIcon
                id={isOverviewOpen ? "chevronUp" : "chevronDown"}
                className="h-4 w-4 shrink-0 text-zinc-300"
              />
            </button>
            {isOverviewOpen ? (
              <div className="border-t border-zinc-800/80 px-3 pb-3 pt-2">
                {loading ? (
                  <p className="text-sm text-zinc-400">Loading departments…</p>
                ) : departmentOverview.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-zinc-700 px-4 py-4 text-center text-sm text-zinc-400">
                    {master
                      ? "No departments yet. Open Admin Tools → Bulk Generate after you add departments."
                      : "No departments on this map yet. Ask your supervisor to set them up."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {departmentOverview.map((row) => (
                      <li
                        key={row.id}
                        className={`rounded-xl border px-3 py-2 ${
                          row.isActive
                            ? "border-zinc-700/80 bg-zinc-900/70"
                            : "border-zinc-800 bg-zinc-950/50 opacity-75"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-white">
                              {row.name}
                            </p>
                            <p className="truncate font-mono text-[11px] text-zinc-400">
                              {row.code} · target {row.weeklyTarget}/week ·{" "}
                              {row.isActive ? "cron on" : "paused"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="glass-pill-cyan !rounded-lg px-2 py-1 font-mono text-[10px] !normal-case tracking-normal">
                              {row.aisles} aisle{row.aisles === 1 ? "" : "s"}
                            </span>
                            {master ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={row.isActive}
                              aria-label={`${row.name} master toggle`}
                              disabled={toggleBusyId === row.id}
                              onClick={() =>
                                void toggleDepartment(row.id, !row.isActive)
                              }
                              className="flex min-h-11 min-w-11 items-center justify-center"
                            >
                              <span
                                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                                  row.isActive ? "bg-emerald-500" : "bg-zinc-600"
                                } ${toggleBusyId === row.id ? "opacity-60" : ""}`}
                              >
                                <span
                                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                                    row.isActive ? "left-[1.35rem]" : "left-0.5"
                                  }`}
                                />
                              </span>
                            </button>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-1.5 text-sm text-zinc-300">
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

          {loading ? (
            <p className="text-sm text-zinc-400">Loading locations…</p>
          ) : (
            <StoreLocationGrid
              specialist={specialist}
              departments={departments}
              locations={locations}
              assignedWeek={currentWeek}
              weekRotationLocations={weekRotationLocations}
              barrierLocationIds={barrierLocationIds}
              canMutate={master}
              onChanged={() => void reload(specialist)}
            />
          )}
        </div>
      </main>

      <VisualBayScannerModal
        open={bayScanOpen}
        onClose={() => setBayScanOpen(false)}
        specialist={specialist}
      />
    </div>
  );
}
