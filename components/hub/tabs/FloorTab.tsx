"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { StoreHealthCard } from "@/components/StoreHealthCard";
import { ShowroomQuickTouchCard } from "@/components/dashboard/ShowroomQuickTouchCard";
import { ZebraChecklist } from "@/components/store-ops/ZebraChecklist";
import { ShiftBriefingCard } from "@/components/store-ops/ShiftBriefingCard";
import { StoreHealthChart } from "@/components/store-ops/StoreHealthChart";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  isFlooringWorkingContext,
  workingDepartmentId,
} from "@/lib/admin-department-context";
import { isAssociate, isMasterAdmin, visibleFloorAuditTabs } from "@/lib/rbac";
import { isSupervisor } from "@/lib/specialists";
import {
  fetchDepartments,
  fetchThisWeekRotations,
} from "@/lib/store-ops/client";
import {
  filterFlooringRotations,
  findFlooringDepartment,
  SUNDAY_AUDIT_EVENT,
} from "@/lib/store-ops/sunday-audit";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

const SupervisorAuditSummaryModal = dynamic(
  () =>
    import("@/components/store-ops/SupervisorAuditSummaryModal").then(
      (mod) => mod.SupervisorAuditSummaryModal
    ),
  { ssr: false }
);

export function FloorTab({ specialist }: WorkflowTabProps) {
  const [week, setWeek] = useState("");
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [flooringDeptId, setFlooringDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthKey, setHealthKey] = useState(0);
  const [contextTick, setContextTick] = useState(0);
  const [rollupOpen, setRollupOpen] = useState(false);
  const flooringFocus = isFlooringWorkingContext(specialist);
  const associate = isAssociate(specialist);

  const reload = useCallback(
    async (member: typeof specialist, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const depts = await fetchDepartments(member).catch(() => []);
        const deptId = workingDepartmentId(member, depts);
        const data = await fetchThisWeekRotations(member, deptId);
        setWeek(data.assigned_week || "");
        setRotations(data.rotations ?? []);
        setFlooringDeptId(findFlooringDepartment(depts)?.id ?? null);
        setHealthKey((k) => k + 1);
      } catch {
        setWeek("");
        setRotations([]);
        setError(null);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    []
  );

  const silentRefresh = useCallback(() => {
    void reload(specialist, { silent: true });
  }, [reload, specialist]);

  useEffect(() => {
    void reload(specialist);
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
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onCtx);
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onSunday);
    };
  }, [reload, specialist]);

  const displayRotations = useMemo(() => {
    if (!flooringFocus || !flooringDeptId) return rotations;
    return filterFlooringRotations(rotations, flooringDeptId);
  }, [rotations, flooringFocus, flooringDeptId]);

  return (
    <>
      <main className="hub-main">
        {!associate ? (
          <SundayAuditStagingCard
            specialist={specialist}
            refreshKey={healthKey}
            forceShow={flooringFocus || isMasterAdmin(specialist)}
          />
        ) : null}
        {!associate && visibleFloorAuditTabs(specialist).length > 0 ? (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {visibleFloorAuditTabs(specialist).map((tab) => (
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
        {!associate ? (
          <>
            <ShiftBriefingCard specialist={specialist} refreshKey={healthKey} />
            <StoreHealthChart specialist={specialist} refreshKey={healthKey} />
            <StoreHealthCard specialist={specialist} refreshKey={healthKey} />
          </>
        ) : null}
        {isSupervisor(specialist) ? (
          <button
            type="button"
            onClick={() => setRollupOpen(true)}
            className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 text-sm font-bold text-emerald-100"
          >
            Weekly audit rollup
          </button>
        ) : null}

        {!associate ? (
          <ShowroomQuickTouchCard
            specialist={specialist}
            refreshKey={healthKey}
            onTouched={() => setHealthKey((k) => k + 1)}
          />
        ) : null}
        {!associate && !isMasterAdmin(specialist) ? (
          <Link
            href="/verify-rotation"
            className="mb-3 block text-center text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
          >
            End-of-week Verify &amp; Report Exceptions →
          </Link>
        ) : null}
        {!associate && isMasterAdmin(specialist) ? (
          <Link
            href="/admin/exceptions"
            className="mb-3 block text-center text-sm font-semibold text-amber-200 underline-offset-2 hover:underline"
          >
            Exception Log / Verification Status →
          </Link>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <section className="mb-3">
          <p className="glass-subtitle mb-1.5 text-emerald-400">
            This week&apos;s bays
            {flooringFocus ? " · Flooring" : ""}
          </p>
          {loading ? (
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

        {associate && visibleFloorAuditTabs(specialist).length > 0 ? (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {visibleFloorAuditTabs(specialist).map((tab) => (
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
        {associate ? (
          <ShowroomQuickTouchCard
            specialist={specialist}
            refreshKey={healthKey}
            onTouched={() => setHealthKey((k) => k + 1)}
          />
        ) : null}
        {associate ? (
          <Link
            href="/verify-rotation"
            className="mb-3 block text-center text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
          >
            Log a barrier or verify bays →
          </Link>
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
