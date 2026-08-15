"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { ExceptionFeed } from "@/components/admin/ExceptionFeed";
import { StoreHealthCard } from "@/components/StoreHealthCard";
import { ShowroomQuickTouchCard } from "@/components/dashboard/ShowroomQuickTouchCard";
import { ZebraChecklist } from "@/components/store-ops/ZebraChecklist";
import { ShiftBriefingCard } from "@/components/store-ops/ShiftBriefingCard";
import { PredictiveCopilotBanner } from "@/components/store-ops/PredictiveCopilotBanner";
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
  verifyAllCompletedBays,
} from "@/lib/store-ops/client";
import {
  filterFlooringRotations,
  findFlooringDepartment,
  SUNDAY_AUDIT_EVENT,
} from "@/lib/store-ops/sunday-audit";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import Link from "next/link";

const SupervisorAuditSummaryModal = dynamic(
  () =>
    import("@/components/store-ops/SupervisorAuditSummaryModal").then(
      (mod) => mod.SupervisorAuditSummaryModal
    ),
  { ssr: false }
);

export function FloorTab({ specialist }: WorkflowTabProps) {
  const [week, setWeek] = useState("");
  const [deptId, setDeptId] = useState<string | null>(null);
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [flooringDeptId, setFlooringDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthKey, setHealthKey] = useState(0);
  const [contextTick, setContextTick] = useState(0);
  const [rollupOpen, setRollupOpen] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const flooringFocus = isFlooringWorkingContext(specialist);
  const associate = isAssociate(specialist);
  const supervisor = isSupervisor(specialist);
  const master = isMasterAdmin(specialist);
  const scanTabs = visibleFloorAuditTabs(specialist);
  const completedCount = rotations.filter((r) => r.is_completed).length;

  const reload = useCallback(
    async (member: typeof specialist, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const depts = await fetchDepartments(member).catch(() => []);
        const nextDeptId = workingDepartmentId(member, depts);
        const data = await fetchThisWeekRotations(member, nextDeptId);
        setWeek(data.assigned_week || "");
        setDeptId(nextDeptId ?? null);
        setRotations(data.rotations ?? []);
        setFlooringDeptId(findFlooringDepartment(depts)?.id ?? null);
        setHealthKey((k) => k + 1);
      } catch {
        setWeek("");
        setDeptId(null);
        setRotations([]);
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
        {!associate ? (
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

        {!associate ? (
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
          <PredictiveCopilotBanner
            specialist={specialist}
            week={week}
            rotations={displayRotations}
            departmentId={deptId}
            refreshKey={healthKey}
            onApplied={silentRefresh}
          />
        )}

        {supervisor ? (
          <button
            type="button"
            onClick={() => setRollupOpen(true)}
            className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 text-sm font-bold text-emerald-100"
          >
            Weekly audit rollup
          </button>
        ) : null}

        <ShowroomQuickTouchCard
          specialist={specialist}
          refreshKey={healthKey}
          onTouched={() => setHealthKey((k) => k + 1)}
        />

        {verifyMsg ? (
          <p className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            {verifyMsg}
          </p>
        ) : null}

        {!associate && completedCount > 0 ? (
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

        <ExceptionFeed specialist={specialist} refreshKey={healthKey} />
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
