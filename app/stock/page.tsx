"use client";

/**
 * Downstock & Stock — unified overhead-pull queue + remnant inventory.
 * Queue ownership: lib/store-ops/downstock.ts via ZebraChecklist.
 * Remnants ownership: lib/remnants.ts via RemnantSection.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { RemnantSection } from "@/components/sections/RemnantSection";
import { ZebraChecklist } from "@/components/store-ops/ZebraChecklist";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  isFlooringWorkingContext,
} from "@/lib/admin-department-context";
import { fetchCatalog } from "@/lib/catalog";
import { canAccessSection, isMasterAdmin } from "@/lib/rbac";
import { fetchRemnants } from "@/lib/remnants";
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
import { dedupeRoster, fetchSpecialists } from "@/lib/specialists";
import type { CatalogItem, Remnant, StoreSpecialist } from "@/lib/types";

export default function StockPage() {
  return (
    <SessionGate
      allow={(m) => Boolean(actorFromSpecialist(m))}
      denyMessage="Downstock & Stock is for department associates, supervisors, and Master Admin."
    >
      {({ specialist, storeNumber, logout }) => (
        <StockBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function StockBody({
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
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [contextTick, setContextTick] = useState(0);
  const showRemnants = canAccessSection(specialist, "remnants");
  const flooringFocus =
    isFlooringWorkingContext(specialist) ||
    (!isMasterAdmin(specialist) &&
      (specialist.assigned_department === "flooring" ||
        specialist.assigned_department == null));

  const reloadQueue = useCallback(
    async (member: StoreSpecialist, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingQueue(true);
      try {
        const [data, depts] = await Promise.all([
          fetchThisWeekRotations(member),
          fetchDepartments(member).catch(() => []),
        ]);
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
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Downstock & Stock"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="hub-main space-y-4">
        <section>
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Downstock queue
          </h2>
          <p className="mb-2 mt-1 text-sm text-zinc-400">
            Overhead pulls flagged from the Floor checklist. Assign a CSA from
            the shift roster.
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
    </div>
  );
}
