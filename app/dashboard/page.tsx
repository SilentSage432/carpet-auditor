"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { StoreHealthCard } from "@/components/StoreHealthCard";
import { ShowroomQuickTouchCard } from "@/components/dashboard/ShowroomQuickTouchCard";
import { ZebraChecklist } from "@/components/store-ops/ZebraChecklist";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { ShiftBriefingCard } from "@/components/store-ops/ShiftBriefingCard";
import { StoreHealthChart } from "@/components/store-ops/StoreHealthChart";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  isFlooringWorkingContext,
  workingDepartment,
} from "@/lib/admin-department-context";
import { isMasterAdmin } from "@/lib/rbac";
import { actorFromSpecialist } from "@/lib/store-ops/auth";
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
import { departmentMeta, type StoreSpecialist } from "@/lib/types";

export default function SupervisorDashboardPage() {
  return (
    <SessionGate
      allow={(m) => Boolean(actorFromSpecialist(m))}
      denyMessage="Rotation dashboard is for department associates, supervisors, and Master Admin."
    >
      {({ specialist, storeNumber, logout }) => (
        <DashboardBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function DashboardBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [week, setWeek] = useState("");
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [flooringDeptId, setFlooringDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthKey, setHealthKey] = useState(0);
  const [contextTick, setContextTick] = useState(0);
  const working = workingDepartment(specialist);
  const dept = departmentMeta(working === "all" ? "flooring" : working);
  const flooringFocus =
    isFlooringWorkingContext(specialist) ||
    (!isMasterAdmin(specialist) &&
      (specialist.assigned_department === "flooring" ||
        specialist.assigned_department == null));

  const reload = useCallback(
    async (member: StoreSpecialist, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const [data, depts] = await Promise.all([
          fetchThisWeekRotations(member),
          fetchDepartments(member).catch(() => []),
        ]);
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
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title={`${dept.shortLabel} Rotation`}
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <SundayAuditStagingCard
          specialist={specialist}
          refreshKey={healthKey}
          forceShow={flooringFocus || isMasterAdmin(specialist)}
        />
        <ShiftBriefingCard specialist={specialist} refreshKey={healthKey} />
        <StoreHealthChart specialist={specialist} refreshKey={healthKey} />
        <StoreHealthCard specialist={specialist} refreshKey={healthKey} />

        <ShowroomQuickTouchCard
          specialist={specialist}
          refreshKey={healthKey}
          onTouched={() => setHealthKey((k) => k + 1)}
        />
        {!isMasterAdmin(specialist) ? (
          <Link
            href="/verify-rotation"
            className="mb-3 block text-center text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
          >
            End-of-week Verify &amp; Report Exceptions →
          </Link>
        ) : (
          <Link
            href="/admin/exceptions"
            className="mb-3 block text-center text-sm font-semibold text-amber-200 underline-offset-2 hover:underline"
          >
            Exception Log / Verification Status →
          </Link>
        )}

        {error ? (
          <p className="mb-4 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <section className="mb-3">
          <p className="glass-subtitle mb-2 text-emerald-400">
            Pending Cycle Audits
            {flooringFocus ? " · D23 Flooring" : ""}
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
      </main>
    </div>
  );
}
