"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RemnantSection } from "@/components/sections/RemnantSection";
import { ZebraChecklist } from "@/components/store-ops/ZebraChecklist";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  isFlooringWorkingContext,
  workingDepartmentId,
} from "@/lib/admin-department-context";
import { fetchCatalog } from "@/lib/catalog";
import { canAccessSection } from "@/lib/rbac";
import { fetchRemnants } from "@/lib/remnants";
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
import { dedupeRoster, fetchSpecialists } from "@/lib/specialists";
import type { CatalogItem, Remnant } from "@/lib/types";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

export function StockTab({ specialist, storeNumber }: WorkflowTabProps) {
  const [week, setWeek] = useState("");
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [flooringDeptId, setFlooringDeptId] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [roster, setRoster] = useState<WorkflowTabProps["specialist"][]>([]);
  const [contextTick, setContextTick] = useState(0);
  const showRemnants = canAccessSection(specialist, "remnants");
  const flooringFocus = isFlooringWorkingContext(specialist);

  const reloadQueue = useCallback(
    async (member: typeof specialist, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingQueue(true);
      try {
        const depts = await fetchDepartments(member).catch(() => []);
        const deptId = workingDepartmentId(member, depts);
        const data = await fetchThisWeekRotations(member, deptId);
        setWeek(data.assigned_week || "");
        setRotations(data.rotations ?? []);
        setFlooringDeptId(findFlooringDepartment(depts)?.id ?? null);
      } catch {
        setWeek("");
        setRotations([]);
      } finally {
        if (!opts?.silent) setLoadingQueue(false);
      }
    },
    []
  );

  const reloadRemnants = useCallback(async () => {
    if (!canAccessSection(specialist, "remnants")) return;
    const [cat, rem, team] = await Promise.all([
      fetchCatalog(),
      fetchRemnants(),
      fetchSpecialists(),
    ]);
    setCatalog(cat);
    setRemnants(rem);
    setRoster(dedupeRoster(team));
  }, [specialist]);

  useEffect(() => {
    void reloadQueue(specialist);
  }, [specialist, reloadQueue, contextTick]);

  useEffect(() => {
    void reloadRemnants();
  }, [reloadRemnants, storeNumber]);

  useEffect(() => {
    function onCtx() {
      setContextTick((n) => n + 1);
    }
    function onSunday() {
      void reloadQueue(specialist, { silent: true });
    }
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, onCtx);
    window.addEventListener(SUNDAY_AUDIT_EVENT, onSunday);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onCtx);
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onSunday);
    };
  }, [reloadQueue, specialist]);

  const displayRotations = useMemo(() => {
    if (!flooringFocus || !flooringDeptId) return rotations;
    return filterFlooringRotations(rotations, flooringDeptId);
  }, [rotations, flooringFocus, flooringDeptId]);

  return (
    <main className="hub-main space-y-4">
      <section>
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
          Downstock queue
        </h2>
        <p className="mb-2 mt-1 text-sm text-zinc-400">
          Overhead pulls flagged from a bay on Floor. Assign an associate from
          today&apos;s roster.
        </p>
        {loadingQueue ? (
          <p className="text-sm text-zinc-400">Loading downstock queue…</p>
        ) : (
          <ZebraChecklist
            specialist={specialist}
            assignedWeek={week}
            rotations={displayRotations}
            onRefresh={() => void reloadQueue(specialist, { silent: true })}
            lockedQueue="downstock"
            compact
          />
        )}
      </section>

      {showRemnants ? (
        <section>
          <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Remnant inventory
          </h2>
          <RemnantSection
            catalog={catalog}
            remnants={remnants}
            onRemnantsChange={setRemnants}
            loggedBy={specialist.name}
            specialists={roster}
            activeSpecialist={specialist}
          />
        </section>
      ) : null}
    </main>
  );
}
