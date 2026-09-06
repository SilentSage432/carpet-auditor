"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, Focus, Layers, Zap } from "lucide-react";
import { StoreLocationGrid } from "@/components/admin/StoreLocationGrid";
import { isMasterAdmin, isSimplifiedAssociateView } from "@/lib/rbac";
import {
  setAdminWorkingDepartment,
  workingDepartmentId,
} from "@/lib/admin-department-context";
import { accessibleDepartments } from "@/lib/department-access";
import { useWorkingDepartment } from "@/lib/use-working-department";
import {
  fetchDepartmentsDetailed,
  fetchExceptionSummary,
  fetchLocationAttention,
  fetchOperationalContextLocationRelevanceResolve,
  fetchStoreLocationsDetailed,
  fetchThisWeekRotations,
  invalidateStoreOpsListCaches,
  peekCachedDepartments,
  peekCachedRotations,
  peekCachedStoreLocations,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import {
  indexMapLocationSeasonalViews,
  type MapLocationSeasonalView,
} from "@/lib/store-ops/map-location-context";
import { fingerprintsEqual } from "@/lib/store-ops/cache";
import {
  isStoreOpsAuthFailureMessage,
  STORE_OPS_AUTH_HINT,
} from "@/lib/store-ops/auth-soft";
import { readableError, isExistingDepartmentConflict } from "@/lib/store-ops/errors";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import { isWeekVerifiedForMapOverlay } from "@/lib/store-ops/rotation-metrics";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { isSupervisor } from "@/lib/specialists";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import type {
  AttentionEvidenceDimension,
  LocationAttentionSignal,
} from "@/lib/store-ops/location-attention-contract";
import {
  indexAttentionSignalsByLocation,
  mapAttentionStatusLabel,
  type MapAttentionClientStatus,
} from "@/lib/store-ops/location-attention-presentation";
import {
  isAttentionResponseCurrent,
  nextAttentionRequestToken,
} from "@/lib/store-ops/location-attention-request";
import {
  clearMapAttentionInvestigationHref,
  composeMapAttentionInvestigationView,
  resolveMapAttentionInvestigationIntent,
} from "@/lib/store-ops/map-attention-investigation";

const ICON_STROKE = 1.75;

const VisualBayScannerModal = dynamic(
  () =>
    import("@/components/store-ops/VisualBayScannerModal").then(
      (mod) => mod.VisualBayScannerModal
    ),
  { ssr: false }
);

export function MapTab({ specialist }: WorkflowTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [bayScanOpen, setBayScanOpen] = useState(false);
  const [mapMode, setMapMode] = useState<"standard" | "heatmap">("standard");
  const [weekRotationLocations, setWeekRotationLocations] = useState<
    Array<{ locationId: string; completed: boolean }>
  >([]);
  const [barrierLocationIds, setBarrierLocationIds] = useState<string[]>([]);
  const [seasonalByLocationId, setSeasonalByLocationId] = useState<
    Map<string, MapLocationSeasonalView>
  >(() => new Map());
  const [attentionStatus, setAttentionStatus] =
    useState<MapAttentionClientStatus>("IDLE");
  const [attentionByLocationId, setAttentionByLocationId] = useState<
    Map<string, LocationAttentionSignal>
  >(() => new Map());
  const [attentionGeneratedAt, setAttentionGeneratedAt] = useState<
    string | null
  >(null);
  const [attentionDegraded, setAttentionDegraded] = useState(false);
  const [attentionUnavailable, setAttentionUnavailable] = useState<
    AttentionEvidenceDimension[]
  >([]);
  const attentionGenRef = useRef(0);
  const attentionAbortRef = useRef<AbortController | null>(null);
  const currentWeek = isoWeekLabel();
  const master = isMasterAdmin(specialist);
  const locatorOnly = isSimplifiedAssociateView(specialist);
  const canReadSeasonal = isSupervisor(specialist);
  const canReadAttention = isSupervisor(specialist);
  const heatmap = mapMode === "heatmap";
  const working = useWorkingDepartment(specialist);
  const activeDepartmentId = workingDepartmentId(specialist, departments);
  const visibleDepartments = useMemo(() => {
    if (working === "all" || !activeDepartmentId) return departments;
    return departments.filter((dept) => dept.id === activeDepartmentId);
  }, [departments, working, activeDepartmentId]);
  const visibleLocations = useMemo(() => {
    if (working === "all" || !activeDepartmentId) return locations;
    const ids = new Set(visibleDepartments.map((dept) => dept.id));
    return locations.filter((loc) => ids.has(loc.department_id));
  }, [locations, working, activeDepartmentId, visibleDepartments]);

  const investigationIntent = useMemo(
    () =>
      resolveMapAttentionInvestigationIntent({
        searchParams,
        allowedDepartmentScopes: accessibleDepartments(specialist),
      }),
    [searchParams, specialist]
  );

  const investigationView = useMemo(
    () =>
      composeMapAttentionInvestigationView({
        intent: investigationIntent,
        attentionStatus,
        signals: attentionByLocationId,
      }),
    [investigationIntent, attentionStatus, attentionByLocationId]
  );

  const emphasizeAttentionMarkers = Boolean(
    investigationView &&
      (attentionStatus === "AVAILABLE" || attentionStatus === "DEGRADED") &&
      investigationView.elevated_count > 0
  );

  const investigationIntentKey = investigationIntent
    ? `${investigationIntent.kind}:${investigationIntent.departmentScope}`
    : null;
  const [appliedInvestigationKey, setAppliedInvestigationKey] = useState<
    string | null
  >(null);
  if (investigationIntentKey !== appliedInvestigationKey) {
    setAppliedInvestigationKey(investigationIntentKey);
    if (investigationIntentKey) {
      setMapMode("standard");
    }
  }

  useEffect(() => {
    if (!investigationIntent) return;
    if (working !== investigationIntent.departmentScope) {
      setAdminWorkingDepartment(investigationIntent.departmentScope);
    }
  }, [investigationIntent, working]);

  const clearAttentionPaint = useCallback(() => {
    setAttentionByLocationId(new Map());
    setAttentionGeneratedAt(null);
    setAttentionDegraded(false);
    setAttentionUnavailable([]);
  }, []);

  const reload = useCallback(
    async (member: typeof specialist, silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      setAuthRequired(false);
      try {
        const depts = await fetchDepartmentsDetailed(member).catch(
          async (err) => {
            if (!isExistingDepartmentConflict(err)) throw err;
            console.warn(
              "[StoreMap] departments already exist — retrying list without seed error",
              err
            );
            invalidateStoreOpsListCaches();
            return fetchDepartmentsDetailed(member);
          }
        );

        const deptId = workingDepartmentId(member, depts.items);
        const workingAll = !deptId;

        attentionAbortRef.current?.abort();
        const abort = new AbortController();
        attentionAbortRef.current = abort;
        const token = nextAttentionRequestToken(
          attentionGenRef.current,
          workingAll || !canReadAttention ? null : deptId
        );
        attentionGenRef.current = token.generation;
        clearAttentionPaint();

        if (!canReadAttention) {
          setAttentionStatus("IDLE");
        } else if (workingAll) {
          setAttentionStatus("NEEDS_DEPARTMENT");
        } else {
          setAttentionStatus("LOADING");
        }

        const attentionPromise =
          canReadAttention && deptId
            ? fetchLocationAttention(member, deptId, { signal: abort.signal })
                .then((payload) => ({ ok: true as const, payload }))
                .catch((err: unknown) => ({ ok: false as const, err }))
            : Promise.resolve(null);

        const [locs, weekData, exceptions, seasonalResult, attentionResult] =
          await Promise.all([
            fetchStoreLocationsDetailed(member, deptId),
            fetchThisWeekRotations(member, deptId),
            fetchExceptionSummary(member),
            canReadSeasonal
              ? fetchOperationalContextLocationRelevanceResolve(member).catch(
                  (err) => {
                    console.error(
                      "[StoreMap] seasonal location context failed (non-blocking)",
                      err
                    );
                    return null;
                  }
                )
              : Promise.resolve(null),
            attentionPromise,
          ]);

        const nextWeek = (weekData.rotations ?? [])
          .map((row) => ({
            locationId: String(
              row.location_id || row.store_locations?.id || ""
            ),
            completed: isWeekVerifiedForMapOverlay(row),
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
        if (seasonalResult?.items) {
          setSeasonalByLocationId(
            indexMapLocationSeasonalViews(seasonalResult.items)
          );
        } else if (!canReadSeasonal || seasonalResult === null) {
          setSeasonalByLocationId(new Map());
        }
        if (depts.authRequired || locs.authRequired) {
          setAuthRequired(true);
        }
        if (depts.items.length > 0) {
          setError(null);
        }

        if (
          isAttentionResponseCurrent(
            token,
            attentionGenRef.current,
            workingAll || !canReadAttention ? null : deptId
          )
        ) {
          if (!canReadAttention) {
            setAttentionStatus("IDLE");
            clearAttentionPaint();
          } else if (workingAll) {
            setAttentionStatus("NEEDS_DEPARTMENT");
            clearAttentionPaint();
          } else if (!attentionResult) {
            setAttentionStatus("UNAVAILABLE");
            clearAttentionPaint();
          } else if (!attentionResult.ok) {
            const message = readableError(
              attentionResult.err,
              "Attention request failed"
            );
            if (isStoreOpsAuthFailureMessage(message)) {
              setAuthRequired(true);
              setAttentionStatus("IDLE");
              clearAttentionPaint();
            } else if (!abort.signal.aborted) {
              console.error(
                "[StoreMap] attention failed (non-blocking)",
                attentionResult.err
              );
              setAttentionStatus("UNAVAILABLE");
              clearAttentionPaint();
            }
          } else {
            const payload = attentionResult.payload;
            setAttentionByLocationId(
              indexAttentionSignalsByLocation(payload.signals)
            );
            setAttentionGeneratedAt(payload.generated_at);
            setAttentionDegraded(Boolean(payload.degraded));
            setAttentionUnavailable(payload.unavailable_evidence ?? []);
            setAttentionStatus(payload.degraded ? "DEGRADED" : "AVAILABLE");
          }
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
          setAttentionStatus("IDLE");
          clearAttentionPaint();
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    },
    [canReadSeasonal, canReadAttention, clearAttentionPaint]
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const cachedDepts = await peekCachedDepartments(specialist);
      if (cancelled) return;
      if (cachedDepts?.items.length) {
        setDepartments((prev) =>
          fingerprintsEqual(prev, cachedDepts.items) ? prev : cachedDepts.items
        );
        const deptId = workingDepartmentId(specialist, cachedDepts.items);
        const [cachedLocs, cachedWeek] = await Promise.all([
          peekCachedStoreLocations(specialist, deptId),
          peekCachedRotations(specialist, deptId),
        ]);
        if (cancelled) return;
        if (cachedLocs?.items.length) {
          setLocations((prev) =>
            fingerprintsEqual(prev, cachedLocs.items) ? prev : cachedLocs.items
          );
          setAuthRequired(
            Boolean(cachedDepts.authRequired || cachedLocs.authRequired)
          );
          setLoading(false);
        }
        if (cachedWeek) {
          const nextWeek = (cachedWeek.rotations ?? [])
            .map((row) => ({
              locationId: String(
                row.location_id || row.store_locations?.id || ""
              ),
              completed: isWeekVerifiedForMapOverlay(row),
            }))
            .filter((row) => row.locationId);
          setWeekRotationLocations((prev) =>
            fingerprintsEqual(prev, nextWeek) ? prev : nextWeek
          );
        }
      }
      if (!cancelled) void reload(specialist, true);
    }
    void boot();
    return () => {
      cancelled = true;
      attentionAbortRef.current?.abort();
    };
  }, [specialist, reload, working]);

  useEffect(() => {
    function onLocations() {
      void reload(specialist, true);
    }
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onLocations);
    return () => {
      window.removeEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onLocations);
    };
  }, [reload, specialist]);

  const attentionStatusLabel = mapAttentionStatusLabel(attentionStatus);

  return (
    <>
      <main className="hub-main">
        <p className="mb-2 font-mono text-[11px] text-zinc-400">
          {locatorOnly
            ? `Bay locator · week ${currentWeek}`
            : master
              ? `Week ${currentWeek}`
              : "This week's bay map"}
        </p>

        {attentionStatusLabel ? (
          <p
            className="mb-2 font-mono text-[10px] text-zinc-500"
            data-testid="map-attention-status"
          >
            {attentionStatusLabel}
          </p>
        ) : null}

        {investigationView ? (
          <div
            className="mb-3 flex items-start gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-1.5"
            data-testid="map-attention-investigation"
            data-status={investigationView.status}
          >
            <Focus
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400"
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9px] font-bold uppercase tracking-wide text-zinc-500">
                {investigationView.title}
              </p>
              <p className="mt-0.5 text-xs font-medium leading-snug text-zinc-200">
                {investigationView.body}
              </p>
              <p className="mt-0.5 font-mono text-[10px] leading-snug text-zinc-600">
                {investigationView.provenance}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                router.replace(clearMapAttentionInvestigationHref(), {
                  scroll: false,
                })
              }
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700/80 px-2.5 text-[11px] font-semibold text-zinc-300 transition active:scale-[0.99]"
            >
              Show all
            </button>
          </div>
        ) : null}

        <div
          className="mb-3 inline-flex h-11 w-full items-center rounded-full border border-zinc-700/80 bg-zinc-950/70 p-0.5"
          role="group"
          aria-label="Map view mode"
        >
          <button
            type="button"
            aria-pressed={!heatmap}
            onClick={() => setMapMode("standard")}
            className={`inline-flex h-10 flex-1 items-center justify-center rounded-full px-3 font-mono text-[11px] font-bold ${
              !heatmap ? "bg-accent/25 text-accent" : "text-zinc-400"
            }`}
          >
            <Layers
              className="mr-1.5 h-3.5 w-3.5"
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
            Standard Map
          </button>
          <button
            type="button"
            aria-pressed={heatmap}
            onClick={() => setMapMode("heatmap")}
            className={`inline-flex h-10 flex-1 items-center justify-center rounded-full px-3 font-mono text-[11px] font-bold ${
              heatmap ? "bg-accent/25 text-accent" : "text-zinc-400"
            }`}
          >
            <Zap
              className="mr-1.5 h-3.5 w-3.5"
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
            Velocity Heatmap
          </button>
        </div>

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
          {loading && visibleLocations.length === 0 ? (
            <p className="text-sm text-zinc-400">Loading locations…</p>
          ) : (
            <StoreLocationGrid
              specialist={specialist}
              departments={visibleDepartments}
              locations={visibleLocations}
              assignedWeek={currentWeek}
              weekRotationLocations={weekRotationLocations}
              barrierLocationIds={barrierLocationIds}
              seasonalByLocationId={seasonalByLocationId}
              attentionByLocationId={attentionByLocationId}
              attentionStatus={attentionStatus}
              attentionGeneratedAt={attentionGeneratedAt}
              attentionDegraded={attentionDegraded}
              attentionUnavailableEvidence={attentionUnavailable}
              heatmap={heatmap}
              emphasizeAttentionMarkers={emphasizeAttentionMarkers}
              onChanged={() => void reload(specialist)}
            />
          )}
        </div>

        {!locatorOnly ? (
          <button
            type="button"
            onClick={() => setBayScanOpen(true)}
            className="btn-primary-glow mt-3 flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm"
          >
            <Camera className="mr-2 h-4 w-4" strokeWidth={ICON_STROKE} />
            Snap Bay Photo
          </button>
        ) : null}
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
