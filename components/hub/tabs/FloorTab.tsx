"use client";

/**
 * Floor — UX-REDUCE-002 "This Week" operational surface.
 * People → physical bays from sunday_bay_assignments + weekly_rotations.
 * Engine / verification / schedule / call-out semantics unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Users, Zap } from "lucide-react";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { ShowroomQuickTouchCard } from "@/components/dashboard/ShowroomQuickTouchCard";
import { TacticalVoiceFloorPad } from "@/components/dashboard/TacticalVoiceFloorPad";
import { FloorAttentionSummary } from "@/components/store-ops/FloorAttentionSummary";
import { FloorOperationalContextStrip } from "@/components/store-ops/FloorOperationalContextStrip";
import { OnDutyAssociateStrip } from "@/components/store-ops/OnDutyAssociateStrip";
import { ThisWeekOwnershipBoard } from "@/components/store-ops/ThisWeekOwnershipBoard";
import { ExecutiveFloorPadIntentBridge } from "@/components/hub/ExecutiveFloorPadIntentBridge";
import { workingDepartmentId } from "@/lib/admin-department-context";
import { useWorkingDepartment } from "@/lib/use-working-department";
import {
  isMasterAdmin,
  isSimplifiedAssociateView,
} from "@/lib/rbac";
import { dedupeRoster, fetchSpecialists, isSupervisor } from "@/lib/specialists";
import { isStoreOpsAuthFailureMessage } from "@/lib/store-ops/auth-soft";
import {
  fetchDepartments,
  fetchExceptionSummary,
  fetchLocationAttention,
  fetchStoreLocationsDetailed,
  fetchThisWeekRotations,
  peekCachedDepartments,
  peekCachedRotations,
  peekCachedStoreLocations,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import { fingerprintsEqual } from "@/lib/store-ops/cache";
import { readableError } from "@/lib/store-ops/errors";
import type { MapAttentionClientStatus } from "@/lib/store-ops/location-attention-presentation";
import {
  nextAttentionRequestToken,
  isAttentionResponseCurrent,
} from "@/lib/store-ops/location-attention-request";
import {
  composeLocationAttentionSummary,
  type LocationAttentionSummary,
} from "@/lib/store-ops/location-attention-summary";
import {
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
  requestSundayAuditDrawer,
  SUNDAY_AUDIT_EVENT,
  type SundayAssignmentMap,
} from "@/lib/store-ops/sunday-audit";
import {
  fetchShiftDaysRange,
  fetchStoreTimezone,
  SHIFT_STATUS_EVENT,
  shiftRowKey,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import {
  composeCurrentAvailability,
  isLaterToday,
  isScheduledNow,
  previousStoreLocalWorkDate,
  storeLocalWorkDate,
  type CurrentAvailability,
} from "@/lib/store-ops/current-availability";
import { useStoreClockTick } from "@/lib/store-ops/use-store-clock";
import { DEFAULT_STORE_TIMEZONE } from "@/lib/store-ops/sunday-schedule";
import { knownShiftHours } from "@/lib/store-ops/labor-availability";
import {
  composeOnDutyBayWorkload,
  type OnDutyWorkloadMember,
} from "@/lib/store-ops/weekly-rotations";
import { getStoreNumber } from "@/lib/store";
import { shouldShowFloorAttentionSummary } from "@/lib/store-ops/floor-attention-visibility";
import { buildMapCurrentAttentionHref } from "@/lib/store-ops/map-attention-investigation";
import {
  composeThisWeekOwnership,
  composeThisWeekProgressLine,
} from "@/lib/store-ops/this-week-ownership";
import {
  departmentMeta,
  specialistHomeDepartment,
  type StoreSpecialist,
} from "@/lib/types";
import {
  type Department,
  type StoreLocation,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

const ICON_STROKE = 1.75;

const SupervisorAuditSummaryModal = dynamic(
  () =>
    import("@/components/store-ops/SupervisorAuditSummaryModal").then(
      (mod) => mod.SupervisorAuditSummaryModal
    ),
  { ssr: false }
);

function rotationBayRef(rotation: WeeklyRotationWithLocation) {
  return {
    rotationId: rotation.id,
    aisle: rotation.store_locations?.aisle ?? "",
    bay: rotation.store_locations?.bay ?? 0,
    type: rotation.store_locations?.type,
    riskScore: 0,
  };
}

export function FloorTab({ specialist, storeNumber }: WorkflowTabProps) {
  const router = useRouter();
  const [week, setWeek] = useState("");
  const [deptId, setDeptId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [mappedLocations, setMappedLocations] = useState<StoreLocation[]>([]);
  const [flooringDeptId, setFlooringDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthKey, setHealthKey] = useState(0);
  const [rollupOpen, setRollupOpen] = useState(false);
  const [shiftTeam, setShiftTeam] = useState<StoreSpecialist[]>([]);
  const [shiftDays, setShiftDays] = useState<Record<string, AssociateShiftDay>>(
    {}
  );
  const [storeTimezone, setStoreTimezone] = useState(DEFAULT_STORE_TIMEZONE);
  const [onDutyLoading, setOnDutyLoading] = useState(true);
  const clockNow = useStoreClockTick();
  const [assignments, setAssignments] = useState<SundayAssignmentMap>({});
  const [pickedAssociateId, setPickedAssociateId] = useState<string | "all">(
    "all"
  );
  const [rosterSheetOpen, setRosterSheetOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [barrierRotationIds, setBarrierRotationIds] = useState<string[]>([]);

  const [attentionStatus, setAttentionStatus] =
    useState<MapAttentionClientStatus>("IDLE");
  const [attentionSummary, setAttentionSummary] =
    useState<LocationAttentionSummary | null>(null);
  const [attentionGeneratedAt, setAttentionGeneratedAt] = useState<
    string | null
  >(null);
  const [attentionDegraded, setAttentionDegraded] = useState(false);
  const attentionGenRef = useRef(0);
  const attentionAbortRef = useRef<AbortController | null>(null);

  const working = useWorkingDepartment(specialist);
  const flooringFocus = working === "flooring";
  const simplified = isSimplifiedAssociateView(specialist);
  const supervisor = isSupervisor(specialist);
  const master = isMasterAdmin(specialist);
  const canReadAttention = supervisor;
  const assignmentDept = working === "all" ? "flooring" : working;

  const activeDept = useMemo(
    () => departments.find((dept) => dept.id === deptId) ?? null,
    [departments, deptId]
  );
  const weekTitle =
    working === "all"
      ? "This Week"
      : `${
          activeDept?.name?.trim() || departmentMeta(working).shortLabel
        } · This Week`;

  const storeToday = storeLocalWorkDate(clockNow, storeTimezone);
  const storeYesterday = previousStoreLocalWorkDate(clockNow, storeTimezone);

  const loadOnDuty = useCallback(async () => {
    setOnDutyLoading(true);
    try {
      const store = storeNumber || getStoreNumber();
      const [tz, team, days] = await Promise.all([
        fetchStoreTimezone(store),
        fetchSpecialists().then(dedupeRoster),
        fetchShiftDaysRange(storeYesterday, storeToday, store),
      ]);
      setStoreTimezone(tz);
      setShiftTeam(team);
      setShiftDays(days);
    } catch (err) {
      console.error("[FloorTab] on-duty specialists failed", err);
      setShiftTeam([]);
      setShiftDays({});
    } finally {
      setOnDutyLoading(false);
    }
  }, [storeNumber, storeToday, storeYesterday]);

  const onDuty = useMemo(() => {
    const scope = working;
    const next: OnDutyWorkloadMember[] = [];
    for (const person of shiftTeam) {
      if (person.is_active === false) continue;
      if (person.role === "MasterAdmin") continue;
      if (scope !== "all" && specialistHomeDepartment(person) !== scope) {
        continue;
      }
      const todayRow = shiftDays[shiftRowKey(String(person.id), storeToday)];
      const yesterdayRow =
        shiftDays[shiftRowKey(String(person.id), storeYesterday)];
      const availability = composeCurrentAvailability({
        row: todayRow,
        previousDay: yesterdayRow,
        now: clockNow,
        timeZone: storeTimezone,
      });
      if (!isScheduledNow(availability)) continue;
      const hours = knownShiftHours(
        todayRow?.start_time ?? yesterdayRow?.start_time,
        todayRow?.end_time ?? yesterdayRow?.end_time
      );
      next.push({
        specialist_id: String(person.id),
        specialist_name: person.name,
        hours: hours ?? 0,
        start: todayRow?.start_time ?? yesterdayRow?.start_time,
        end: todayRow?.end_time ?? yesterdayRow?.end_time,
      });
    }
    return next;
  }, [
    shiftTeam,
    shiftDays,
    working,
    clockNow,
    storeTimezone,
    storeToday,
    storeYesterday,
  ]);

  const laterTodayCount = useMemo(() => {
    const scope = working;
    let count = 0;
    for (const person of shiftTeam) {
      if (person.is_active === false) continue;
      if (person.role === "MasterAdmin") continue;
      if (scope !== "all" && specialistHomeDepartment(person) !== scope) {
        continue;
      }
      const availability = composeCurrentAvailability({
        row: shiftDays[shiftRowKey(String(person.id), storeToday)],
        previousDay: shiftDays[shiftRowKey(String(person.id), storeYesterday)],
        now: clockNow,
        timeZone: storeTimezone,
      });
      if (isLaterToday(availability)) count += 1;
    }
    return count;
  }, [
    shiftTeam,
    shiftDays,
    working,
    clockNow,
    storeTimezone,
    storeToday,
    storeYesterday,
  ]);

  const availabilityById = useMemo(() => {
    const map: Record<string, CurrentAvailability> = {};
    for (const person of shiftTeam) {
      map[String(person.id)] = composeCurrentAvailability({
        row: shiftDays[shiftRowKey(String(person.id), storeToday)],
        previousDay: shiftDays[shiftRowKey(String(person.id), storeYesterday)],
        now: clockNow,
        timeZone: storeTimezone,
      });
    }
    return map;
  }, [shiftTeam, shiftDays, storeToday, storeYesterday, clockNow, storeTimezone]);

  const loadAssignments = useCallback(
    async (assignedWeek: string) => {
      if (!assignedWeek) {
        setAssignments({});
        return;
      }
      try {
        const map = await fetchSundayAssignments(
          assignedWeek,
          getStoreNumber(),
          assignmentDept
        );
        setAssignments((prev) => (fingerprintsEqual(prev, map) ? prev : map));
      } catch {
        /* Keep last known assignments when the floor is offline. */
      }
    },
    [assignmentDept]
  );

  const reload = useCallback(
    async (member: typeof specialist, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        // P0 gate: departments → weekly rotations → sunday_bay_assignments.
        // store_locations is P2 topology hint only — must not block ownership paint.
        const depts = await fetchDepartments(member);
        const nextDeptId = workingDepartmentId(member, depts);
        const data = await fetchThisWeekRotations(member, nextDeptId);
        const nextWeek = data.assigned_week || "";
        const nextRotations = data.rotations ?? [];
        const nextFlooring = findFlooringDepartment(depts)?.id ?? null;
        setDepartments((prev) => (fingerprintsEqual(prev, depts) ? prev : depts));
        setWeek((prev) => (prev === nextWeek ? prev : nextWeek));
        setDeptId((prev) =>
          prev === (nextDeptId ?? null) ? prev : nextDeptId ?? null
        );
        setRotations((prev) =>
          fingerprintsEqual(prev, nextRotations) ? prev : nextRotations
        );
        setFlooringDeptId((prev) =>
          prev === nextFlooring ? prev : nextFlooring
        );
        setHealthKey((k) => k + 1);

        // P1/P2 supporting — do not contend with ownership resolution.
        void loadOnDuty();
        void fetchStoreLocationsDetailed(member, nextDeptId)
          .then((locs) => {
            setMappedLocations((prev) =>
              fingerprintsEqual(prev, locs.items) ? prev : locs.items
            );
          })
          .catch((err) => {
            console.error("[FloorTab] store locations failed (non-blocking)", err);
          });

        // P0 ownership: await authoritative sunday_bay_assignments before unlock.
        if (nextWeek) {
          await loadAssignments(nextWeek);
        } else {
          setAssignments({});
        }
      } catch (err) {
        console.error("[FloorTab] live rotations failed", err);
      } finally {
        setLoading(false);
      }
    },
    [loadOnDuty, loadAssignments]
  );

  const silentRefresh = useCallback(() => {
    void reload(specialist, { silent: true });
  }, [reload, specialist]);

  const clearAttentionPaint = useCallback(() => {
    setAttentionSummary(null);
    setAttentionGeneratedAt(null);
    setAttentionDegraded(false);
  }, []);

  const reloadAttention = useCallback(
    async (departmentId: string | null) => {
      await Promise.resolve();

      if (!canReadAttention) {
        attentionAbortRef.current?.abort();
        attentionAbortRef.current = null;
        const token = nextAttentionRequestToken(attentionGenRef.current, null);
        attentionGenRef.current = token.generation;
        setAttentionStatus("IDLE");
        clearAttentionPaint();
        return;
      }

      if (working === "all" || !departmentId) {
        attentionAbortRef.current?.abort();
        attentionAbortRef.current = null;
        const token = nextAttentionRequestToken(attentionGenRef.current, null);
        attentionGenRef.current = token.generation;
        setAttentionStatus(
          working === "all" ? "NEEDS_DEPARTMENT" : "LOADING"
        );
        clearAttentionPaint();
        return;
      }

      attentionAbortRef.current?.abort();
      const abort = new AbortController();
      attentionAbortRef.current = abort;
      const token = nextAttentionRequestToken(
        attentionGenRef.current,
        departmentId
      );
      attentionGenRef.current = token.generation;
      clearAttentionPaint();
      setAttentionStatus("LOADING");

      try {
        const payload = await fetchLocationAttention(specialist, departmentId, {
          signal: abort.signal,
        });
        if (
          !isAttentionResponseCurrent(
            token,
            attentionGenRef.current,
            departmentId
          )
        ) {
          return;
        }
        setAttentionSummary(composeLocationAttentionSummary(payload.signals));
        setAttentionGeneratedAt(payload.generated_at);
        setAttentionDegraded(Boolean(payload.degraded));
        setAttentionStatus(payload.degraded ? "DEGRADED" : "AVAILABLE");
      } catch (err) {
        if (abort.signal.aborted) return;
        if (
          !isAttentionResponseCurrent(
            token,
            attentionGenRef.current,
            departmentId
          )
        ) {
          return;
        }
        const message = readableError(err, "Attention request failed");
        if (isStoreOpsAuthFailureMessage(message)) {
          setAttentionStatus("IDLE");
          clearAttentionPaint();
          return;
        }
        console.error("[FloorTab] attention failed (non-blocking)", err);
        setAttentionStatus("UNAVAILABLE");
        clearAttentionPaint();
      }
    },
    [canReadAttention, clearAttentionPaint, specialist, working]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadFloorAttention() {
      if (cancelled) return;
      await reloadAttention(deptId);
    }
    void loadFloorAttention();
    return () => {
      cancelled = true;
      attentionAbortRef.current?.abort();
    };
  }, [deptId, reloadAttention, working, specialist]);

  useEffect(() => {
    function onLocationsChanged() {
      void reloadAttention(deptId);
    }
    window.addEventListener(
      STORE_OPS_LOCATIONS_CHANGED_EVENT,
      onLocationsChanged
    );
    return () => {
      window.removeEventListener(
        STORE_OPS_LOCATIONS_CHANGED_EVENT,
        onLocationsChanged
      );
    };
  }, [deptId, reloadAttention]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const cachedDepts = await peekCachedDepartments(specialist);
      if (cancelled) return;
      const deptItems = cachedDepts?.items ?? [];
      const nextDeptId = workingDepartmentId(specialist, deptItems);
      if (deptItems.length) {
        setDepartments(deptItems);
        setDeptId(nextDeptId ?? null);
        setFlooringDeptId(findFlooringDepartment(deptItems)?.id ?? null);
      }
      // Parallel peeks: rotations are P0; locations are supporting topology.
      const [cachedWeek, cachedLocs] = await Promise.all([
        peekCachedRotations(specialist, nextDeptId ?? undefined),
        peekCachedStoreLocations(specialist, nextDeptId ?? undefined),
      ]);
      if (cancelled) return;
      if (cachedWeek) {
        const peekWeek = cachedWeek.assigned_week || "";
        setWeek(peekWeek);
        setRotations((prev) =>
          fingerprintsEqual(prev, cachedWeek.rotations ?? [])
            ? prev
            : (cachedWeek.rotations ?? [])
        );
        // Start ownership fetch from durable rotation week without waiting
        // for the full live reload (still authoritative live assignments).
        if (peekWeek) void loadAssignments(peekWeek);
      }
      if (cachedLocs?.items.length) {
        setMappedLocations((prev) =>
          fingerprintsEqual(prev, cachedLocs.items) ? prev : cachedLocs.items
        );
      }
      if (!cancelled) void reload(specialist, { silent: true });
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [specialist, reload, working, loadAssignments]);

  useEffect(() => {
    function onFloorOpsReload() {
      void reload(specialist, { silent: true });
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onFloorOpsReload);
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onFloorOpsReload);
    window.addEventListener(SHIFT_STATUS_EVENT, onFloorOpsReload);
    return () => {
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onFloorOpsReload);
      window.removeEventListener(
        STORE_OPS_LOCATIONS_CHANGED_EVENT,
        onFloorOpsReload
      );
      window.removeEventListener(SHIFT_STATUS_EVENT, onFloorOpsReload);
    };
  }, [reload, specialist]);

  useEffect(() => {
    if (!supervisor || simplified) {
      setBarrierRotationIds([]);
      return;
    }
    let cancelled = false;
    void fetchExceptionSummary(specialist, week || undefined)
      .then((payload) => {
        if (cancelled) return;
        const ids = (payload.exceptions ?? [])
          .map((row) => String(row.rotation_id ?? "").trim())
          .filter(Boolean);
        setBarrierRotationIds(ids);
      })
      .catch((err) => {
        console.error("[FloorTab] exceptions failed (non-blocking)", err);
        if (!cancelled) setBarrierRotationIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [supervisor, simplified, specialist, week, healthKey]);

  const displayRotations = useMemo(() => {
    const scoped =
      working !== "all" && deptId
        ? rotations.filter((row) => row.department_id === deptId)
        : rotations;
    if (!flooringFocus || !flooringDeptId) return scoped;
    return filterFlooringRotations(scoped, flooringDeptId);
  }, [rotations, flooringFocus, flooringDeptId, working, deptId]);

  const ownershipPlan = useMemo(
    () =>
      composeThisWeekOwnership({
        rotations: displayRotations,
        assignments,
        roster: shiftTeam,
        barrierRotationIds,
      }),
    [displayRotations, assignments, shiftTeam, barrierRotationIds]
  );

  const weekProgressLine = composeThisWeekProgressLine(ownershipPlan);
  const pendingVerifyCount = ownershipPlan.pendingVerificationCount;

  const showMasterAdvancedRecovery =
    !simplified && master && ownershipPlan.isHealthyOwnedPlan;

  const showAttentionStrip =
    canReadAttention &&
    shouldShowFloorAttentionSummary({
      status: attentionStatus,
      summary: attentionSummary,
      degraded: attentionDegraded,
    });

  const workload = useMemo(
    () =>
      composeOnDutyBayWorkload({
        bays: displayRotations
          .filter((row) => !row.is_completed)
          .map(rotationBayRef),
        assignments,
        onDuty,
      }),
    [displayRotations, assignments, onDuty]
  );

  const mappedPhysicalHint =
    mappedLocations.length === 0 && !loading
      ? "No mapped locations yet — ask Master Admin to set up topology."
      : null;

  const needsAttention =
    supervisor &&
    !simplified &&
    (pendingVerifyCount > 0 ||
      ownershipPlan.needsOwnershipRecovery ||
      ownershipPlan.barrierBayCount > 0 ||
      (ownershipPlan.needsDispatchRecovery && !loading));

  return (
    <>
      <main className="hub-main">
        <header className="mb-2" data-testid="floor-command-header">
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">
            {weekTitle}
          </h1>
          {week ? (
            <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
              Week {week}
            </p>
          ) : null}
        </header>

        {/* Needs Attention — exceptional state only */}
        {needsAttention ? (
          <section
            className="mb-2 space-y-2"
            data-testid="floor-needs-attention"
          >
            {pendingVerifyCount > 0 ? (
              <div
                className="flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-2.5"
                data-testid="floor-verification-strip"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-wide text-amber-300/95">
                    Needs attention
                  </p>
                  <p className="truncate text-xs font-semibold text-amber-50">
                    {pendingVerifyCount} bay
                    {pendingVerifyCount === 1 ? "" : "s"} awaiting verification
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRollupOpen(true)}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/45 bg-amber-950/40 px-3 text-xs font-bold text-amber-50"
                >
                  Review
                </button>
              </div>
            ) : null}

            {ownershipPlan.needsOwnershipRecovery ? (
              <div
                className="rounded-xl border border-cyan-500/35 bg-cyan-950/25 px-3 py-2.5"
                data-testid="floor-ownership-recovery"
              >
                <p className="text-xs font-semibold text-cyan-50">
                  This week&apos;s ownership is incomplete
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-cyan-100/75">
                  {ownershipPlan.unownedPhysicalBayCount} physical bay
                  {ownershipPlan.unownedPhysicalBayCount === 1 ? "" : "s"} still
                  need an owner.
                </p>
                <button
                  type="button"
                  onClick={() => requestSundayAuditDrawer()}
                  className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-950/40 px-3 text-xs font-semibold text-cyan-50"
                >
                  <Zap
                    className="h-3.5 w-3.5"
                    strokeWidth={ICON_STROKE}
                    aria-hidden
                  />
                  Assign this week
                </button>
              </div>
            ) : null}

            {ownershipPlan.needsDispatchRecovery && !loading ? (
              <div
                className="rounded-xl border border-zinc-700/80 bg-zinc-950/50 px-3 py-2.5"
                data-testid="floor-no-plan"
              >
                <p className="text-xs font-semibold text-zinc-100">
                  No weekly rotation yet
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                  {mappedPhysicalHint ||
                    (master
                      ? "Sunday automatic dispatch should create this week’s plan. Use recovery only if it missed."
                      : "Ask your Master Admin if this week’s plan did not arrive.")}
                </p>
                {master ? (
                  <button
                    type="button"
                    onClick={() => requestSundayAuditDrawer()}
                    className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-zinc-600 px-3 text-xs font-semibold text-zinc-200"
                  >
                    <Zap
                      className="h-3.5 w-3.5"
                      strokeWidth={ICON_STROKE}
                      aria-hidden
                    />
                    Recovery tools
                  </button>
                ) : null}
              </div>
            ) : null}

            {ownershipPlan.barrierBayCount > 0 &&
            pendingVerifyCount === 0 &&
            !ownershipPlan.needsOwnershipRecovery ? (
              <div
                className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2"
                data-testid="floor-barrier-attention"
              >
                <p className="text-xs font-semibold text-rose-100">
                  {ownershipPlan.barrierBayCount} barrier
                  {ownershipPlan.barrierBayCount === 1 ? "" : "s"} · coverage
                  still owed
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Quiet week progress — not alarming */}
        <div className="mb-2" data-testid="floor-week-state">
          <p
            className="text-xs text-zinc-400"
            data-testid="floor-week-progress-line"
          >
            {loading && !ownershipPlan.hasPlan
              ? "Loading this week…"
              : weekProgressLine}
          </p>
        </div>

        {/* Availability context — supporting, not allocation */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRosterSheetOpen(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-zinc-700/90 bg-zinc-900/60 px-3 text-xs font-semibold text-zinc-200"
          >
            <Users
              className="h-3.5 w-3.5 text-zinc-400"
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
            {onDutyLoading
              ? "On now…"
              : `On now · ${workload.groups.length}`}
          </button>
          {laterTodayCount > 0 ? (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              {laterTodayCount} later today
            </span>
          ) : null}
        </div>

        {/* Primary: people → physical bays */}
        {ownershipPlan.hasPlan ? (
          <ThisWeekOwnershipBoard
            plan={ownershipPlan}
            specialist={specialist}
            departmentId={deptId}
            availabilityById={availabilityById}
            onlySpecialistId={simplified ? String(specialist.id) : null}
            allowExtraBay={!simplified && supervisor}
            onRefresh={silentRefresh}
          />
        ) : null}

        {/* Healthy week: no Stage/Assign chrome. Master may reach advanced recovery quietly. */}
        {showMasterAdvancedRecovery ? (
          <div className="mt-2" data-testid="floor-master-recovery-quiet">
            <button
              type="button"
              onClick={() => requestSundayAuditDrawer()}
              className="text-[11px] font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
            >
              Advanced recovery
            </button>
          </div>
        ) : null}

        {showAttentionStrip ? (
          <div className="mt-2">
            <FloorAttentionSummary
              status={attentionStatus}
              summary={attentionSummary}
              generatedAt={attentionGeneratedAt}
              degraded={attentionDegraded}
              onViewMap={() => {
                if (working === "all") {
                  router.push("/admin/store-map");
                  return;
                }
                router.push(
                  buildMapCurrentAttentionHref({ departmentScope: working })
                );
              }}
            />
          </div>
        ) : null}

        {/* Seasonal context only — fiscal demoted */}
        <div className="mt-2">
          <FloorOperationalContextStrip
            specialist={specialist}
            workingDepartment={working}
            departmentCode={activeDept?.code ?? null}
            departmentLabel={
              activeDept?.name?.trim() ||
              (working !== "all"
                ? departmentMeta(working).shortLabel
                : null)
            }
            refreshKey={healthKey}
            omitFiscal
          />
        </div>

        <OnDutyAssociateStrip
          groups={workload.groups}
          selectedId={pickedAssociateId}
          onSelect={setPickedAssociateId}
          loading={onDutyLoading}
          storewide={working === "all"}
          hideStrip
          sheetOpen={rosterSheetOpen}
          onSheetOpenChange={setRosterSheetOpen}
        />

        {!simplified ? (
          <SundayAuditStagingCard
            specialist={specialist}
            refreshKey={healthKey}
            forceShow={flooringFocus || master}
            variant="modal-only"
          />
        ) : null}

        {/* Secondary: Floor Pad (protected) + demoted showroom */}
        {!simplified ? (
          <section className="mt-3 space-y-2" data-testid="floor-secondary-tools">
            <div data-testid="floor-drawer-actions">
              <TacticalVoiceFloorPad
                specialist={specialist}
                storeNumber={storeNumber}
                week={week}
                rotations={displayRotations}
                departmentId={deptId}
              />
            </div>
            <button
              type="button"
              aria-expanded={secondaryOpen}
              onClick={() => setSecondaryOpen((v) => !v)}
              className="flex min-h-9 w-full items-center justify-between rounded-lg px-1 text-left text-[11px] font-semibold text-zinc-500"
            >
              <span>Showroom tools</span>
              <span>{secondaryOpen ? "Hide" : "Show"}</span>
            </button>
            {secondaryOpen ? (
              <ShowroomQuickTouchCard
                specialist={specialist}
                refreshKey={healthKey}
                onTouched={() => setHealthKey((k) => k + 1)}
              />
            ) : null}
          </section>
        ) : null}

        <Suspense fallback={null}>
          <ExecutiveFloorPadIntentBridge />
        </Suspense>
      </main>

      <SupervisorAuditSummaryModal
        open={rollupOpen}
        specialist={specialist}
        assignedWeek={week}
        departmentId={deptId}
        onClose={() => setRollupOpen(false)}
        onReviewed={silentRefresh}
      />
    </>
  );
}
