"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronRight, Users, Zap } from "lucide-react";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { ExceptionFeed } from "@/components/admin/ExceptionFeed";
import { StoreHealthCard } from "@/components/StoreHealthCard";
import { ShowroomQuickTouchCard } from "@/components/dashboard/ShowroomQuickTouchCard";
import { TacticalVoiceFloorPad } from "@/components/dashboard/TacticalVoiceFloorPad";
import { BayFreshnessGrid } from "@/components/dashboard/BayFreshnessGrid";
import { FlagDownstockSheet } from "@/components/store-ops/FlagDownstockSheet";
import { FloorAttentionSummary } from "@/components/store-ops/FloorAttentionSummary";
import { FloorOperationalContextStrip } from "@/components/store-ops/FloorOperationalContextStrip";
import { OnDutyAssociateStrip } from "@/components/store-ops/OnDutyAssociateStrip";
import { ShiftAnalyticsDrawer } from "@/components/store-ops/ShiftAnalyticsDrawer";
import { ZebraChecklist, type FloorBayFilter } from "@/components/store-ops/ZebraChecklist";
import { ShiftBriefingCard } from "@/components/store-ops/ShiftBriefingCard";
import { PredictiveCopilotBanner } from "@/components/store-ops/PredictiveCopilotBanner";
import { StoreHealthChart } from "@/components/store-ops/StoreHealthChart";
import { fetchApplianceCatalog } from "@/lib/appliance-catalog";
import { fetchApplianceScans } from "@/lib/appliance-scans";
import {
  workingDepartmentId,
} from "@/lib/admin-department-context";
import { useWorkingDepartment } from "@/lib/use-working-department";
import { isMasterAdmin, isSimplifiedAssociateView } from "@/lib/rbac";
import {
  APPLIANCE_SCANNER_OPEN_EVENT,
  type ApplianceScannerLocationContext,
} from "@/lib/specialty-tools";
import { canAccessDepartment } from "@/lib/department-access";
import { dedupeRoster, fetchSpecialists, isSupervisor } from "@/lib/specialists";
import { isStoreOpsAuthFailureMessage } from "@/lib/store-ops/auth-soft";
import {
  fetchDepartments,
  fetchLocationAttention,
  fetchStoreLocationsDetailed,
  fetchThisWeekRotations,
  peekCachedDepartments,
  peekCachedRotations,
  peekCachedStoreLocations,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
  verifyAllCompletedBays,
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
  buildSundayStagedBays,
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
  pendingSundayAssignmentCount,
  requestSundayAuditDrawer,
  SUNDAY_AUDIT_EVENT,
  type SundayAssignmentMap,
} from "@/lib/store-ops/sunday-audit";
import {
  composeShiftBoard,
  fetchShiftDays,
  isOnDutyToday,
  localWorkDate,
  SHIFT_STATUS_EVENT,
} from "@/lib/store-ops/shift-status";
import {
  composeOnDutyBayWorkload,
  DEFAULT_SHIFT_HOURS,
  hoursBetween,
  type OnDutyWorkloadMember,
} from "@/lib/store-ops/weekly-rotations";
import { getStoreNumber } from "@/lib/store";
import { composeFloorReadinessLine } from "@/lib/store-ops/floor-readiness";
import {
  composeFloorWeekProgressLine,
  composeWeeklyRotationMetrics,
} from "@/lib/store-ops/rotation-metrics";
import {
  composeBayFreshness,
  readBayTouches,
} from "@/lib/heatmap/bay-tracker";
import { resolveWeeklyBayTarget } from "@/lib/store-ops/week";
import {
  departmentMeta,
  specialistHomeDepartment,
  type ApplianceCatalogItem,
  type ApplianceScan,
} from "@/lib/types";
import {
  isApplianceSimsWorkflow,
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

const VisualBayScannerModal = dynamic(
  () =>
    import("@/components/store-ops/VisualBayScannerModal").then(
      (mod) => mod.VisualBayScannerModal
    ),
  { ssr: false }
);

const ApplianceScannerModal = dynamic(
  () =>
    import("@/components/appliances/ApplianceScannerModal").then(
      (mod) => mod.ApplianceScannerModal
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

/** Attention filter unions health flags, downstock, notes, and pending verify — do not relabel as verify-only. */
const FLOOR_FILTERS: Array<{ id: FloorBayFilter; label: string }> = [
  { id: "all", label: "All Bays" },
  { id: "mine", label: "My Bays" },
  { id: "attention", label: "Needs Attention" },
  { id: "completed", label: "Completed" },
];

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
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [bayScanOpen, setBayScanOpen] = useState(false);
  const [bayAudits, setBayAudits] = useState<
    Record<
      string,
      {
        audit_log_id: string;
        audit_verdict: "PASS" | "CONDITIONAL" | "FAIL";
      }
    >
  >({});
  const [onDuty, setOnDuty] = useState<OnDutyWorkloadMember[]>([]);
  const [onDutyLoading, setOnDutyLoading] = useState(true);
  const [assignments, setAssignments] = useState<SundayAssignmentMap>({});
  const [pickedAssociateId, setPickedAssociateId] = useState<
    string | "all" | null
  >(null);
  const [downstockOpen, setDownstockOpen] = useState(false);
  const [applianceCatalog, setApplianceCatalog] = useState<
    ApplianceCatalogItem[]
  >([]);
  const [applianceScans, setApplianceScans] = useState<ApplianceScan[]>([]);
  const [simsScannerOpen, setSimsScannerOpen] = useState(false);
  const [simsBayLocation, setSimsBayLocation] =
    useState<ApplianceScannerLocationContext | null>(null);
  const [floorBayFilter, setFloorBayFilter] = useState<FloorBayFilter>("all");
  const [rosterSheetOpen, setRosterSheetOpen] = useState(false);

  /**
   * SI-001C — Floor owns an independent attention fetch (pilot isolation).
   * Keep-alive may also keep Map mounted → ~1 Map GET + 1 Floor GET on common
   * department/evidence refresh. Not shared/synchronized snapshot state.
   * Staging/Sunday and shift-status do NOT trigger this path.
   */
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
  const rotationTitle =
    working === "all"
      ? "Floor Rotation"
      : `${
          activeDept?.name?.trim() || departmentMeta(working).shortLabel
        } Rotation`;
  const focusAssociateId =
    pickedAssociateId ?? (simplified ? String(specialist.id) : "all");

  const loadOnDuty = useCallback(async () => {
    setOnDutyLoading(true);
    try {
      const date = localWorkDate();
      const team = dedupeRoster(await fetchSpecialists());
      const days = await fetchShiftDays(date, storeNumber || getStoreNumber());
      const board = composeShiftBoard(team, days, date);
      const scope = working;
      const next: OnDutyWorkloadMember[] = [];
      for (const day of board) {
        if (!isOnDutyToday(day)) continue;
        const person = team.find((row) => String(row.id) === day.specialist_id);
        if (!person || person.is_active === false) continue;
        if (person.role === "MasterAdmin") continue;
        if (
          scope !== "all" &&
          specialistHomeDepartment(person) !== scope &&
          !canAccessDepartment(person, scope)
        ) {
          continue;
        }
        next.push({
          specialist_id: String(person.id),
          specialist_name: person.name,
          hours:
            hoursBetween(day.start_time ?? undefined, day.end_time ?? undefined) ??
            DEFAULT_SHIFT_HOURS,
          start: day.start_time,
          end: day.end_time,
        });
      }
      setOnDuty(next);
    } catch (err) {
      console.error("[FloorTab] on-duty specialists failed", err);
      setOnDuty([]);
    } finally {
      setOnDutyLoading(false);
    }
  }, [specialist, storeNumber, working]);

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
        const depts = await fetchDepartments(member);
        const nextDeptId = workingDepartmentId(member, depts);
        const [data, locs] = await Promise.all([
          fetchThisWeekRotations(member, nextDeptId),
          fetchStoreLocationsDetailed(member, nextDeptId),
        ]);
        const nextWeek = data.assigned_week || "";
        const nextRotations = data.rotations ?? [];
        const nextFlooring = findFlooringDepartment(depts)?.id ?? null;
        setDepartments((prev) => (fingerprintsEqual(prev, depts) ? prev : depts));
        setWeek((prev) => (prev === nextWeek ? prev : nextWeek));
        setDeptId((prev) => (prev === (nextDeptId ?? null) ? prev : nextDeptId ?? null));
        setRotations((prev) =>
          fingerprintsEqual(prev, nextRotations) ? prev : nextRotations
        );
        setMappedLocations((prev) =>
          fingerprintsEqual(prev, locs.items) ? prev : locs.items
        );
        setFlooringDeptId((prev) =>
          prev === nextFlooring ? prev : nextFlooring
        );
        setHealthKey((k) => k + 1);
        void loadOnDuty();
        if (nextWeek) void loadAssignments(nextWeek);
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

  /**
   * SI-001C attention reload — independent of Floor rotation reload.
   * Triggers: dept resolve/switch, STORE_OPS_LOCATIONS_CHANGED only.
   * Does not run on SUNDAY_AUDIT_EVENT or SHIFT_STATUS_EVENT.
   */
  const reloadAttention = useCallback(
    async (departmentId: string | null) => {
      // Yield so effect-driven loads are not synchronous cascading setState.
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
      const cachedWeek = await peekCachedRotations(
        specialist,
        nextDeptId ?? undefined
      );
      const cachedLocs = await peekCachedStoreLocations(
        specialist,
        nextDeptId ?? undefined
      );
      if (cancelled) return;
      if (cachedWeek) {
        setWeek(cachedWeek.assigned_week || "");
        setRotations((prev) =>
          fingerprintsEqual(prev, cachedWeek.rotations ?? [])
            ? prev
            : (cachedWeek.rotations ?? [])
        );
        setLoading(false);
      }
      if (cachedLocs?.items.length) {
        setMappedLocations((prev) =>
          fingerprintsEqual(prev, cachedLocs.items) ? prev : cachedLocs.items
        );
      }
      // Keep painted rows visible; never flash a blank skeleton on tab return.
      if (!cancelled) void reload(specialist, { silent: true });
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [specialist, reload, working]);

  useEffect(() => {
    function onFloorOpsReload() {
      void reload(specialist, { silent: true });
    }
    // Sunday staging + shift status refresh Floor ops lists only — not SI-001C.
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

  const displayRotations = useMemo(() => {
    const scoped =
      working !== "all" && deptId
        ? rotations.filter((row) => row.department_id === deptId)
        : rotations;
    if (!flooringFocus || !flooringDeptId) return scoped;
    return filterFlooringRotations(scoped, flooringDeptId);
  }, [rotations, flooringFocus, flooringDeptId, working, deptId]);

  const weekMetrics = useMemo(
    () =>
      composeWeeklyRotationMetrics({
        rotations: displayRotations,
        weeklyTarget: activeDept?.weekly_bay_target,
        locations: mappedLocations,
      }),
    [displayRotations, activeDept?.weekly_bay_target, mappedLocations]
  );
  const pendingVerifyCount = weekMetrics.pendingVerification;
  const reportedCompleteCount = weekMetrics.reportedComplete;
  const weekProgressLine = composeFloorWeekProgressLine(weekMetrics);

  const sundayPending = useMemo(() => {
    const bays = buildSundayStagedBays(displayRotations, assignments);
    return pendingSundayAssignmentCount(bays);
  }, [displayRotations, assignments]);

  const showSundayRail =
    !simplified && (flooringFocus || master || supervisor);

  const effectiveFocus = useMemo(() => {
    if (floorBayFilter === "mine") return String(specialist.id);
    return focusAssociateId;
  }, [floorBayFilter, specialist.id, focusAssociateId]);

  const hasSimsBays = useMemo(
    () =>
      displayRotations.some((row) =>
        isApplianceSimsWorkflow(row.store_locations)
      ),
    [displayRotations]
  );

  const loadApplianceLedger = useCallback(async () => {
    try {
      const [catalog, scans] = await Promise.all([
        fetchApplianceCatalog(),
        fetchApplianceScans(),
      ]);
      setApplianceCatalog(catalog);
      setApplianceScans(scans);
    } catch (err) {
      console.error("[FloorTab] appliance SIMS ledger failed", err);
    }
  }, []);

  useEffect(() => {
    if (!hasSimsBays) return;
    void loadApplianceLedger();
  }, [hasSimsBays, loadApplianceLedger, healthKey]);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<ApplianceScannerLocationContext | null>)
        .detail;
      if (detail && typeof detail === "object" && detail.location_id) {
        setSimsBayLocation(detail);
      } else {
        setSimsBayLocation(null);
      }
      setSimsScannerOpen(true);
    }
    window.addEventListener(APPLIANCE_SCANNER_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(APPLIANCE_SCANNER_OPEN_EVENT, onOpen);
    };
  }, []);

  const freshnessLocations = useMemo(() => {
    if (mappedLocations.length > 0) return mappedLocations;
    return displayRotations
      .map((row) => row.store_locations)
      .filter((loc): loc is NonNullable<typeof loc> => Boolean(loc));
  }, [mappedLocations, displayRotations]);

  const readinessLine = useMemo(() => {
    const summary = composeBayFreshness({
      locations: freshnessLocations,
      overlay: readBayTouches(storeNumber || getStoreNumber()),
    });
    return composeFloorReadinessLine({
      totalBays: summary.cells.length,
      staleCount: summary.staleCount,
      weeklyTarget:
        activeDept?.weekly_bay_target ?? resolveWeeklyBayTarget(null),
      weekMetrics,
    });
  }, [
    freshnessLocations,
    storeNumber,
    activeDept?.weekly_bay_target,
    weekMetrics,
  ]);

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

  async function signOffCompleted() {
    if (!deptId || !week) return;
    setVerifyBusy(true);
    setVerifyMsg(null);
    try {
      await verifyAllCompletedBays(specialist, {
        department_id: deptId,
        assigned_week: week,
      });
      setVerifyMsg(
        `Week signed off — ${pendingVerifyCount} bay${
          pendingVerifyCount === 1 ? "" : "s"
        } verified.`
      );
      silentRefresh();
    } catch (err) {
      setVerifyMsg(
        err instanceof Error ? err.message : "Could not sign off this week"
      );
    } finally {
      setVerifyBusy(false);
    }
  }

  return (
    <>
      <main className="hub-main">
        <header className="mb-3">
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">
            {rotationTitle}
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            {weekProgressLine}
            {week ? ` · week ${week}` : ""}
          </p>
          <p
            className="mt-1 font-mono text-[11px] leading-snug text-amber-200/90"
            data-testid="floor-readiness-line"
          >
            {readinessLine}
          </p>
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
          />
          {canReadAttention ? (
            <FloorAttentionSummary
              status={attentionStatus}
              summary={attentionSummary}
              generatedAt={attentionGeneratedAt}
              degraded={attentionDegraded}
              onViewMap={() => router.push("/admin/store-map")}
            />
          ) : null}
        </header>

        <section className="overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.75)]">
          <div className="grid grid-cols-2 gap-2 border-b border-zinc-800/80 p-3">
            {showSundayRail ? (
              <button
                type="button"
                onClick={() => requestSundayAuditDrawer()}
                className="flex min-h-12 items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-950/25 px-2.5 text-left transition active:scale-[0.99]"
              >
                <Zap
                  className="h-4 w-4 shrink-0 text-emerald-300"
                  strokeWidth={ICON_STROKE}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[9px] font-bold uppercase tracking-wide text-emerald-400/90">
                    Pending Cycle Audits
                  </span>
                  <span className="block truncate text-xs font-bold text-emerald-50">
                    {sundayPending > 0
                      ? `${sundayPending} need assignment`
                      : "Tap to stage bays"}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-emerald-400/80"
                  strokeWidth={ICON_STROKE}
                  aria-hidden
                />
              </button>
            ) : (
              <div className="flex min-h-12 items-center rounded-xl border border-dashed border-zinc-800 px-2.5 text-xs text-zinc-500">
                Cycle audits available in Flooring view
              </div>
            )}
            <button
              type="button"
              onClick={() => setRosterSheetOpen(true)}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-950/25 px-2.5 text-left transition active:scale-[0.99]"
            >
              <Users
                className="h-4 w-4 shrink-0 text-cyan-300"
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[9px] font-bold uppercase tracking-wide text-cyan-400/90">
                  Associates On Duty
                </span>
                <span className="block truncate text-xs font-bold text-cyan-50">
                  {onDutyLoading
                    ? "Loading…"
                    : `${workload.groups.length} on shift`}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-cyan-400/80"
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
            </button>
          </div>

          {supervisor && !simplified ? (
            <div className="flex flex-wrap gap-2 border-b border-zinc-800/80 px-3 py-2">
              <button
                type="button"
                onClick={() => requestSundayAuditDrawer()}
                className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/30 px-3 text-xs font-bold text-emerald-100"
              >
                <Zap className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden />
                Stage this week
              </button>
            </div>
          ) : null}

          {supervisor && !simplified && pendingVerifyCount > 0 ? (
            <div
              className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-950/25 px-3 py-2.5"
              data-testid="floor-verification-strip"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[9px] font-bold uppercase tracking-wide text-amber-300/95">
                  Awaiting your verification
                </p>
                <p className="truncate text-xs font-semibold text-amber-50">
                  {pendingVerifyCount} bay
                  {pendingVerifyCount === 1 ? "" : "s"} ready for review
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

          <div className="border-b border-zinc-800/80 px-3 py-2">
            <div
              role="tablist"
              aria-label="Bay filters"
              className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
            >
              {FLOOR_FILTERS.map((filter) => {
                const active = floorBayFilter === filter.id;
                const badge =
                  filter.id === "completed"
                    ? reportedCompleteCount
                    : filter.id === "attention"
                      ? pendingVerifyCount
                      : null;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFloorBayFilter(filter.id)}
                    className={`chip-filter shrink-0 rounded-full px-3 ${
                      active
                        ? "border-cyan-400/55 bg-cyan-950/45 text-cyan-100 shadow-[0_0_12px_-4px_rgba(34,211,238,0.55)]"
                        : "border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {filter.label}
                    {badge && badge > 0 ? ` (${badge})` : ""}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3">
            {loading && displayRotations.length === 0 ? (
              <p className="text-sm text-zinc-400">Loading this week&apos;s bays…</p>
            ) : displayRotations.length === 0 ? (
              <div
                className="rounded-2xl border border-dashed border-zinc-700 px-4 py-4 text-center"
                data-testid="floor-empty-week"
              >
                <p className="text-sm font-semibold text-zinc-200">
                  {week
                    ? `Week ${week} · 0 staged`
                    : "0 bays staged this week"}
                </p>
                <p className="mt-1 font-mono text-[11px] leading-snug text-zinc-400">
                  Target{" "}
                  {resolveWeeklyBayTarget(activeDept?.weekly_bay_target)}
                  /week
                  {mappedLocations.length > 0
                    ? ` · ${mappedLocations.length} mapped`
                    : ""}
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  {simplified
                    ? "No bays on your rotation yet — see your supervisor."
                    : supervisor
                      ? "Stage this week to build the floor plan and assign bays."
                      : "Ask your supervisor to stage this week's bays."}
                </p>
                {supervisor && !simplified ? (
                  <button
                    type="button"
                    onClick={() => requestSundayAuditDrawer()}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 text-sm font-bold text-emerald-100"
                  >
                    <Zap
                      className="h-3.5 w-3.5"
                      strokeWidth={ICON_STROKE}
                      aria-hidden
                    />
                    Stage this week
                  </button>
                ) : null}
              </div>
            ) : (
              <ZebraChecklist
                key={`${working}-${floorBayFilter}`}
                specialist={specialist}
                assignedWeek={week}
                rotations={displayRotations}
                onRefresh={silentRefresh}
                assignmentDepartment={assignmentDept}
                focusSpecialistId={effectiveFocus}
                onDutyMembers={onDuty}
                externalAudits={bayAudits}
                hideChrome
                floorBayFilter={floorBayFilter}
                simsScans={applianceScans}
                simsCatalog={applianceCatalog}
              />
            )}
          </div>
        </section>

        <OnDutyAssociateStrip
          groups={workload.groups}
          selectedId={focusAssociateId}
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

        {verifyMsg ? (
          <p className="mb-3 mt-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            {verifyMsg}
          </p>
        ) : null}

        <ShiftAnalyticsDrawer>
          {!simplified ? (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBayScanOpen(true)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/25 px-3 text-sm font-semibold text-emerald-100"
              >
                Snap Bay Photo
              </button>
              <button
                type="button"
                onClick={() => setDownstockOpen(true)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-3 text-sm font-semibold text-cyan-100"
              >
                Flag Downstock
              </button>
            </div>
          ) : null}
          {!simplified ? (
            <TacticalVoiceFloorPad
              specialist={specialist}
              storeNumber={storeNumber}
              week={week}
              rotations={displayRotations}
              departmentId={deptId}
            />
          ) : null}
          <BayFreshnessGrid
            locations={freshnessLocations}
            refreshKey={healthKey}
          />
          <ShiftBriefingCard specialist={specialist} refreshKey={healthKey} />
          {!simplified ? (
            <>
              <PredictiveCopilotBanner
                specialist={specialist}
                week={week}
                rotations={displayRotations}
                departmentId={deptId}
                refreshKey={healthKey}
                onApplied={silentRefresh}
              />
              <StoreHealthChart specialist={specialist} refreshKey={healthKey} />
              <StoreHealthCard specialist={specialist} refreshKey={healthKey} />
              <ShowroomQuickTouchCard
                specialist={specialist}
                refreshKey={healthKey}
                onTouched={() => setHealthKey((k) => k + 1)}
              />
            </>
          ) : null}
          {supervisor && !simplified ? (
            <button
              type="button"
              onClick={() => setRollupOpen(true)}
              className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 text-sm font-bold text-emerald-100"
            >
              Weekly audit rollup
              {pendingVerifyCount > 0 ? ` (${pendingVerifyCount})` : ""}
            </button>
          ) : null}
          {!simplified && pendingVerifyCount > 0 ? (
            <button
              type="button"
              disabled={verifyBusy || !deptId}
              onClick={() => void signOffCompleted()}
              className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/25 px-3 text-sm font-bold text-emerald-100 disabled:opacity-40"
            >
              {verifyBusy
                ? "Signing off…"
                : `Verify awaiting review (${pendingVerifyCount})`}
            </button>
          ) : null}
          {!simplified ? (
            <ExceptionFeed specialist={specialist} refreshKey={healthKey} />
          ) : null}
        </ShiftAnalyticsDrawer>
      </main>

      <SupervisorAuditSummaryModal
        open={rollupOpen}
        specialist={specialist}
        assignedWeek={week}
        departmentId={deptId}
        onClose={() => setRollupOpen(false)}
        onReviewed={silentRefresh}
      />
      <VisualBayScannerModal
        open={bayScanOpen}
        onClose={() => setBayScanOpen(false)}
        specialist={specialist}
        auditContext={
          deptId
            ? {
                department_id: deptId,
              }
            : undefined
        }
        onAuditValidated={(payload) => {
          if (!payload.rotation_id) return;
          setBayAudits((prev) => ({
            ...prev,
            [payload.rotation_id!]: {
              audit_log_id: payload.audit_log_id,
              audit_verdict: payload.audit_verdict,
            },
          }));
        }}
      />
      {downstockOpen ? (
        <FlagDownstockSheet
          specialist={specialist}
          week={week}
          department={assignmentDept}
          rotations={displayRotations}
          onClose={() => setDownstockOpen(false)}
          onFlagged={silentRefresh}
        />
      ) : null}
      <ApplianceScannerModal
        open={simsScannerOpen}
        onClose={() => {
          setSimsScannerOpen(false);
          setSimsBayLocation(null);
        }}
        catalog={applianceCatalog}
        onCatalogChange={setApplianceCatalog}
        scannedBy={specialist.name}
        activeSpecialist={specialist}
        scannerEnabled={simsScannerOpen}
        bayLocation={simsBayLocation}
        onLogged={(record) => {
          setApplianceScans((prev) => [
            record,
            ...prev.filter((row) => row.id !== record.id),
          ]);
          void fetchApplianceScans()
            .then(setApplianceScans)
            .catch(() => undefined);
        }}
      />
    </>
  );
}
