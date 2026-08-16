"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { ExceptionFeed } from "@/components/admin/ExceptionFeed";
import { StoreHealthCard } from "@/components/StoreHealthCard";
import { ShowroomQuickTouchCard } from "@/components/dashboard/ShowroomQuickTouchCard";
import { TacticalVoiceFloorPad } from "@/components/dashboard/TacticalVoiceFloorPad";
import { BayFreshnessGrid } from "@/components/dashboard/BayFreshnessGrid";
import { ZebraChecklist } from "@/components/store-ops/ZebraChecklist";
import { ShiftBriefingCard } from "@/components/store-ops/ShiftBriefingCard";
import { PredictiveCopilotBanner } from "@/components/store-ops/PredictiveCopilotBanner";
import { StoreHealthChart } from "@/components/store-ops/StoreHealthChart";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  isFlooringWorkingContext,
  workingDepartmentId,
} from "@/lib/admin-department-context";
import {
  isMasterAdmin,
  isSimplifiedAssociateView,
  visibleFloorAuditTabs,
} from "@/lib/rbac";
import { isSupervisor } from "@/lib/specialists";
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
  filterFlooringRotations,
  findFlooringDepartment,
  SUNDAY_AUDIT_EVENT,
} from "@/lib/store-ops/sunday-audit";
import type { StoreLocation, WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import Link from "next/link";

const SupervisorAuditSummaryModal = dynamic(
  () =>
    import("@/components/store-ops/SupervisorAuditSummaryModal").then(
      (mod) => mod.SupervisorAuditSummaryModal
    ),
  { ssr: false }
);

export function FloorTab({ specialist, storeNumber }: WorkflowTabProps) {
  const [week, setWeek] = useState("");
  const [deptId, setDeptId] = useState<string | null>(null);
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [mappedLocations, setMappedLocations] = useState<StoreLocation[]>([]);
  const [flooringDeptId, setFlooringDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthKey, setHealthKey] = useState(0);
  const [contextTick, setContextTick] = useState(0);
  const [rollupOpen, setRollupOpen] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const flooringFocus = isFlooringWorkingContext(specialist);
  const simplified = isSimplifiedAssociateView(specialist);
  const supervisor = isSupervisor(specialist);
  const master = isMasterAdmin(specialist);
  const scanTabs = simplified ? [] : visibleFloorAuditTabs(specialist);
  const completedCount = rotations.filter((r) => r.is_completed).length;

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
      } catch (err) {
        console.error("[FloorTab] live rotations failed", err);
      } finally {
        if (!opts?.silent) setLoading(false);
        else setLoading(false);
      }
    },
    []
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
  }, [specialist, reload, contextTick]);

  useEffect(() => {
    function onCtx() {
      setContextTick((n) => n + 1);
    }
    function onSunday() {
      void reload(specialist, { silent: true });
    }
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, onCtx);
    window.addEventListener(SUNDAY_AUDIT_EVENT, onSunday);
    window.addEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onSunday);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onCtx);
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onSunday);
      window.removeEventListener(STORE_OPS_LOCATIONS_CHANGED_EVENT, onSunday);
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

        {!simplified ? (
          <SundayAuditStagingCard
            specialist={specialist}
            refreshKey={healthKey}
            forceShow={flooringFocus || master}
          />
        ) : null}

        {scanTabs.length > 0 ? (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {scanTabs.map((tab) => (
              <Link
                key={tab.id}
                href={`/?section=${tab.id}`}
                className="chip-filter shrink-0 rounded-full border border-zinc-700/80 bg-zinc-950/60 text-zinc-200"
              >
                {tab.label} scan
              </Link>
            ))}
          </div>
        ) : null}

        {!simplified ? (
          <>
            <ShiftBriefingCard specialist={specialist} refreshKey={healthKey} />
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
          </>
        ) : (
          <ShiftBriefingCard specialist={specialist} refreshKey={healthKey} />
        )}

        {supervisor && !simplified ? (
          <button
            type="button"
            onClick={() => setRollupOpen(true)}
            className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 text-sm font-bold text-emerald-100"
          >
            Weekly audit rollup
          </button>
        ) : null}

        {!simplified ? (
          <ShowroomQuickTouchCard
            specialist={specialist}
            refreshKey={healthKey}
            onTouched={() => setHealthKey((k) => k + 1)}
          />
        ) : null}

        {verifyMsg ? (
          <p className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            {verifyMsg}
          </p>
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

        <section className="mb-3">
          <p className="glass-subtitle mb-1.5 text-emerald-400">
            {simplified ? "Your assigned bays" : "This week's bays"}
            {flooringFocus && !simplified ? " · Flooring" : ""}
          </p>
          {loading && displayRotations.length === 0 ? (
            <p className="text-sm text-zinc-400">Loading this week&apos;s bays…</p>
          ) : (
            <ZebraChecklist
              specialist={specialist}
              assignedWeek={week}
              rotations={displayRotations}
              onRefresh={silentRefresh}
            />
          )}
        </section>

        {!simplified ? (
          <ExceptionFeed specialist={specialist} refreshKey={healthKey} />
        ) : null}
      </main>

      <SupervisorAuditSummaryModal
        open={rollupOpen}
        specialist={specialist}
        assignedWeek={week}
        onClose={() => setRollupOpen(false)}
      />
    </>
  );
}
