"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Camera, Package } from "lucide-react";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { ExceptionFeed } from "@/components/admin/ExceptionFeed";
import { StoreHealthCard } from "@/components/StoreHealthCard";
import { ShowroomQuickTouchCard } from "@/components/dashboard/ShowroomQuickTouchCard";
import { TacticalVoiceFloorPad } from "@/components/dashboard/TacticalVoiceFloorPad";
import { BayFreshnessGrid } from "@/components/dashboard/BayFreshnessGrid";
import { FlagDownstockSheet } from "@/components/store-ops/FlagDownstockSheet";
import { OnDutyAssociateStrip } from "@/components/store-ops/OnDutyAssociateStrip";
import { ShiftAnalyticsDrawer } from "@/components/store-ops/ShiftAnalyticsDrawer";
import { ZebraChecklist } from "@/components/store-ops/ZebraChecklist";
import { ShiftBriefingCard } from "@/components/store-ops/ShiftBriefingCard";
import { PredictiveCopilotBanner } from "@/components/store-ops/PredictiveCopilotBanner";
import { StoreHealthChart } from "@/components/store-ops/StoreHealthChart";
import {
  workingDepartmentId,
} from "@/lib/admin-department-context";
import { useWorkingDepartment } from "@/lib/use-working-department";
import { isMasterAdmin, isSimplifiedAssociateView } from "@/lib/rbac";
import { canAccessDepartment } from "@/lib/department-access";
import { dedupeRoster, fetchSpecialists, isSupervisor } from "@/lib/specialists";
import {
  fetchDepartments,
  fetchStoreLocationsDetailed,
  fetchThisWeekRotations,
  peekCachedDepartments,
  peekCachedRotations,
  peekCachedStoreLocations,
  STORE_OPS_LOCATIONS_CHANGED_EVENT,
  verifyAllCompletedBays,
} from "@/lib/store-ops/client";
import { fingerprintsEqual } from "@/lib/store-ops/cache";
import {
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
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
import { departmentMeta, specialistHomeDepartment } from "@/lib/types";
import type { Department, StoreLocation, WeeklyRotationWithLocation } from "@/lib/store-ops/types";
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
  const [onDuty, setOnDuty] = useState<OnDutyWorkloadMember[]>([]);
  const [onDutyLoading, setOnDutyLoading] = useState(true);
  const [assignments, setAssignments] = useState<SundayAssignmentMap>({});
  const [pickedAssociateId, setPickedAssociateId] = useState<
    string | "all" | null
  >(null);
  const [downstockOpen, setDownstockOpen] = useState(false);

  const working = useWorkingDepartment(specialist);
  const flooringFocus = working === "flooring";
  const simplified = isSimplifiedAssociateView(specialist);
  const supervisor = isSupervisor(specialist);
  const master = isMasterAdmin(specialist);
  const assignmentDept = working === "all" ? "flooring" : working;
  const completedCount = rotations.filter((r) => r.is_completed).length;

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
        setRotations(cachedWeek.rotations ?? []);
        setLoading(false);
      }
      if (cachedLocs?.items.length) {
        setMappedLocations(cachedLocs.items);
      }
      if (!cancelled) void reload(specialist, { silent: true });
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [specialist, reload, working]);

  useEffect(() => {
    function onSunday() {
      void reload(specialist, { silent: true });
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onSunday);
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onSunday);
    window.addEventListener(SHIFT_STATUS_EVENT, onSunday);
    return () => {
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onSunday);
      window.removeEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onSunday);
      window.removeEventListener(SHIFT_STATUS_EVENT, onSunday);
    };
  }, [reload, specialist]);

  const displayRotations = useMemo(() => {
    if (!flooringFocus || !flooringDeptId) return rotations;
    return filterFlooringRotations(rotations, flooringDeptId);
  }, [rotations, flooringFocus, flooringDeptId]);

  const freshnessLocations = useMemo(() => {
    if (mappedLocations.length > 0) return mappedLocations;
    return displayRotations
      .map((row) => row.store_locations)
      .filter((loc): loc is NonNullable<typeof loc> => Boolean(loc));
  }, [mappedLocations, displayRotations]);

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
        `Week signed off — ${completedCount} completed bay${
          completedCount === 1 ? "" : "s"
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
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setBayScanOpen(true)}
              className="btn-primary-glow flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold"
            >
              <Camera className="w-4 h-4 mr-2" strokeWidth={ICON_STROKE} />
              Snap Bay AI Audit
            </button>
            <button
              type="button"
              onClick={() => setDownstockOpen(true)}
              className="flex min-h-11 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-3 text-sm font-semibold text-cyan-100"
            >
              <Package className="w-4 h-4 mr-2" strokeWidth={ICON_STROKE} />
              Flag Downstock
            </button>
          </div>
        </header>

        <OnDutyAssociateStrip
          groups={workload.groups}
          selectedId={focusAssociateId}
          onSelect={setPickedAssociateId}
          loading={onDutyLoading}
          storewide={working === "all"}
        />

        {!simplified ? (
          <SundayAuditStagingCard
            specialist={specialist}
            refreshKey={healthKey}
            forceShow={flooringFocus || master}
          />
        ) : null}

        {verifyMsg ? (
          <p className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            {verifyMsg}
          </p>
        ) : null}

        <section className="mb-3">
          {loading && displayRotations.length === 0 ? (
            <p className="text-sm text-zinc-400">Loading this week&apos;s bays…</p>
          ) : (
            <ZebraChecklist
              specialist={specialist}
              assignedWeek={week}
              rotations={displayRotations}
              onRefresh={silentRefresh}
              assignmentDepartment={assignmentDept}
              focusSpecialistId={focusAssociateId}
              onDutyMembers={onDuty}
              hideChrome
            />
          )}
        </section>

        <ShiftAnalyticsDrawer>
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
            </button>
          ) : null}
          {!simplified && completedCount > 0 ? (
            <button
              type="button"
              disabled={verifyBusy || !deptId}
              onClick={() => void signOffCompleted()}
              className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/25 px-3 text-sm font-bold text-emerald-100 disabled:opacity-40"
            >
              {verifyBusy
                ? "Signing off…"
                : `Verify completed bays (${completedCount})`}
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
        onClose={() => setRollupOpen(false)}
      />
      <VisualBayScannerModal
        open={bayScanOpen}
        onClose={() => setBayScanOpen(false)}
        specialist={specialist}
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
    </>
  );
}
