"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { StoreLocationGrid } from "@/components/admin/StoreLocationGrid";
import { AisleBayManager } from "@/components/admin/AisleBayManager";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  canManageMapConsole,
  canMutateStoreMap,
  isMasterAdmin,
  isSimplifiedAssociateView,
} from "@/lib/rbac";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  adminWorkingDepartmentLabel,
  workingDepartment,
  workingDepartmentId,
} from "@/lib/admin-department-context";
import {
  fetchDepartmentsDetailed,
  fetchExceptionSummary,
  fetchStoreLocationsDetailed,
  fetchThisWeekRotations,
  invalidateStoreOpsListCaches,
  peekCachedDepartments,
  peekCachedRotations,
  peekCachedStoreLocations,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import { fingerprintsEqual } from "@/lib/store-ops/cache";
import {
  isStoreOpsAuthFailureMessage,
  STORE_OPS_AUTH_HINT,
} from "@/lib/store-ops/auth-soft";
import { readableError, isExistingDepartmentConflict } from "@/lib/store-ops/errors";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import { isoWeekLabel } from "@/lib/store-ops/week";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

const VisualBayScannerModal = dynamic(
  () =>
    import("@/components/store-ops/VisualBayScannerModal").then(
      (mod) => mod.VisualBayScannerModal
    ),
  { ssr: false }
);

export function MapTab({ specialist }: WorkflowTabProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [bayScanOpen, setBayScanOpen] = useState(false);
  const [mapSurface, setMapSurface] = useState<"visual" | "manage">("visual");
  const [weekRotationLocations, setWeekRotationLocations] = useState<
    Array<{ locationId: string; completed: boolean }>
  >([]);
  const [barrierLocationIds, setBarrierLocationIds] = useState<string[]>([]);
  const [contextTick, setContextTick] = useState(0);
  const currentWeek = isoWeekLabel();
  const master = isMasterAdmin(specialist);
  const mapConsole = canManageMapConsole(specialist);
  const mutateMap = canMutateStoreMap(specialist);
  const locatorOnly = isSimplifiedAssociateView(specialist);
  const contextLabel = (() => {
    const scope = workingDepartment(specialist);
    if (scope === "all") return "Full Store";
    return adminWorkingDepartmentLabel(
      scope as Parameters<typeof adminWorkingDepartmentLabel>[0]
    );
  })();

  const reload = useCallback(async (member: typeof specialist, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    setAuthRequired(false);
    try {
      const depts = await fetchDepartmentsDetailed(member).catch(async (err) => {
        if (!isExistingDepartmentConflict(err)) throw err;
        console.warn(
          "[StoreMap] departments already exist — retrying list without seed error",
          err
        );
        invalidateStoreOpsListCaches();
        return fetchDepartmentsDetailed(member);
      });

      const deptId = workingDepartmentId(member, depts.items);
      const [locs, weekData, exceptions] = await Promise.all([
        fetchStoreLocationsDetailed(member, deptId),
        fetchThisWeekRotations(member, deptId),
        fetchExceptionSummary(member),
      ]);

      const nextWeek = (weekData.rotations ?? [])
        .map((row) => ({
          locationId: String(row.location_id || row.store_locations?.id || ""),
          completed: Boolean(row.is_completed),
        }))
        .filter((row) => row.locationId);
      const nextBarriers = (exceptions.exceptions ?? [])
        .map((row) => String(row.bay_id ?? ""))
        .filter(Boolean);

      setDepartments((prev) =>
        fingerprintsEqual(prev, depts.items) ? prev : depts.items
      );
      setLocations((prev) =>
        fingerprintsEqual(prev, locs.items) ? prev : locs.items
      );
      setWeekRotationLocations((prev) =>
        fingerprintsEqual(prev, nextWeek) ? prev : nextWeek
      );
      setBarrierLocationIds((prev) =>
        fingerprintsEqual(prev, nextBarriers) ? prev : nextBarriers
      );
      if (depts.authRequired || locs.authRequired) {
        setAuthRequired(true);
      }
      if (depts.items.length > 0) {
        setError(null);
      }
    } catch (err) {
      const message = readableError(err, "Failed to load store map");
      if (
        isExistingDepartmentConflict(err) ||
        isExistingDepartmentConflict(message)
      ) {
        console.warn("[StoreMap] departments already exist", err);
        setError(null);
        return;
      }
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
    let cancelled = false;
    async function boot() {
      const cachedDepts = await peekCachedDepartments(specialist);
      if (cancelled) return;
      if (cachedDepts?.items.length) {
        setDepartments(cachedDepts.items);
        const deptId = workingDepartmentId(specialist, cachedDepts.items);
        const [cachedLocs, cachedWeek] = await Promise.all([
          peekCachedStoreLocations(specialist, deptId),
          peekCachedRotations(specialist, deptId),
        ]);
        if (cancelled) return;
        if (cachedLocs?.items.length) {
          setLocations(cachedLocs.items);
          setAuthRequired(
            Boolean(cachedDepts.authRequired || cachedLocs.authRequired)
          );
          setLoading(false);
        }
        if (cachedWeek) {
          setWeekRotationLocations(
            (cachedWeek.rotations ?? [])
              .map((row) => ({
                locationId: String(
                  row.location_id || row.store_locations?.id || ""
                ),
                completed: Boolean(row.is_completed),
              }))
              .filter((row) => row.locationId)
          );
        }
      }
      if (!cancelled) void reload(specialist, true);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [specialist, reload, contextTick]);

  useEffect(() => {
    function onCtx() {
      setContextTick((n) => n + 1);
    }
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, onCtx);
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onCtx);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onCtx);
      window.removeEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onCtx);
    };
  }, []);

  useEffect(() => {
    if (!mapConsole) setMapSurface("visual");
  }, [mapConsole]);

  return (
    <>
      <main className="hub-main">
        <p className="mb-2 font-mono text-[11px] text-zinc-400">
          {locatorOnly ? (
            <>Bay locator · week {currentWeek}</>
          ) : master ? (
            <>
              Week {currentWeek}
              {" · "}
              <Link
                href="/settings#bulk-generate"
                className="font-semibold text-amber-300 underline-offset-2 hover:underline"
              >
                Bulk generate in Settings
              </Link>
            </>
          ) : (
            <>This week&apos;s bay map</>
          )}
        </p>

        {mapConsole ? (
        <div
          className="mb-3 inline-flex h-11 w-full items-center rounded-full border border-zinc-700/80 bg-zinc-950/70 p-0.5"
          role="group"
          aria-label="Map surface"
        >
          <button
            type="button"
            aria-pressed={mapSurface === "visual"}
            onClick={() => setMapSurface("visual")}
            className={`inline-flex h-10 flex-1 items-center justify-center rounded-full px-3 font-mono text-[11px] font-bold ${
              mapSurface === "visual"
                ? "bg-accent/25 text-accent"
                : "text-zinc-400"
            }`}
          >
            Visual Grid
          </button>
          <button
            type="button"
            aria-pressed={mapSurface === "manage"}
            onClick={() => setMapSurface("manage")}
            className={`inline-flex h-10 flex-1 items-center justify-center rounded-full px-3 font-mono text-[11px] font-bold ${
              mapSurface === "manage"
                ? "bg-accent/25 text-accent"
                : "text-zinc-400"
            }`}
          >
            Manage Aisles & Bays
          </button>
        </div>
        ) : null}

        {mapSurface === "visual" && !locatorOnly ? (
          <button
            type="button"
            onClick={() => setBayScanOpen(true)}
            className="btn-primary-glow mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm"
          >
            <HubIcon id="camera" className="h-4 w-4" />
            Snap Bay AI Audit
          </button>
        ) : null}

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
          {loading && locations.length === 0 ? (
            <p className="text-sm text-zinc-400">Loading locations…</p>
          ) : mapSurface === "manage" && mapConsole ? (
            <AisleBayManager
              specialist={specialist}
              departments={departments}
              locations={locations}
              canMutate={mutateMap}
              contextLabel={contextLabel}
              onChanged={() => void reload(specialist)}
            />
          ) : (
            <StoreLocationGrid
              specialist={specialist}
              departments={departments}
              locations={locations}
              assignedWeek={currentWeek}
              weekRotationLocations={weekRotationLocations}
              barrierLocationIds={barrierLocationIds}
              canMutate={mutateMap}
              onChanged={() => void reload(specialist)}
              onRequestManage={
                mapConsole ? () => setMapSurface("manage") : undefined
              }
            />
          )}
        </div>
      </main>

      {bayScanOpen ? (
        <VisualBayScannerModal
          open={bayScanOpen}
          onClose={() => setBayScanOpen(false)}
          specialist={specialist}
        />
      ) : null}
    </>
  );
}
