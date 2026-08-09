"use client";

import { useCallback, useEffect, useState } from "react";
import { WeeklyRotationList } from "@/components/dashboard/WeeklyRotationList";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { SuperAdminQuickActions } from "@/components/hub/SuperAdminQuickActions";
import { actorFromSpecialist } from "@/lib/store-ops/auth";
import { fetchThisWeekRotations } from "@/lib/store-ops/client";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import { effectiveDepartment } from "@/lib/rbac";
import { departmentMeta, type StoreSpecialist } from "@/lib/types";

export default function SupervisorDashboardPage() {
  return (
    <SessionGate
      allow={(m) => Boolean(actorFromSpecialist(m))}
      denyMessage="Rotation dashboard is for department supervisors and Master Admin."
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dept = departmentMeta(effectiveDepartment(specialist));

  const reload = useCallback(async (member: StoreSpecialist) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchThisWeekRotations(member);
      setWeek(data.assigned_week);
      setRotations(data.rotations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rotations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(specialist);
  }, [specialist, reload]);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title={`${dept.shortLabel} Rotation`}
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <SuperAdminQuickActions specialist={specialist} />

        {error ? (
          <p className="mb-4 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400">Loading this week&apos;s bays…</p>
        ) : (
          <WeeklyRotationList
            specialist={specialist}
            assignedWeek={week}
            rotations={rotations}
            onRefresh={() => void reload(specialist)}
          />
        )}
      </main>
    </div>
  );
}
