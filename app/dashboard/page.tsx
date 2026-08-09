"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { WeeklyRotationList } from "@/components/dashboard/WeeklyRotationList";
import { readAuthSession } from "@/lib/auth-session";
import { effectiveDepartment, isMasterAdmin } from "@/lib/rbac";
import { actorFromSpecialist } from "@/lib/store-ops/auth";
import { fetchThisWeekRotations } from "@/lib/store-ops/client";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import { departmentMeta, type StoreSpecialist } from "@/lib/types";

export default function SupervisorDashboardPage() {
  const [specialist, setSpecialist] = useState<StoreSpecialist | null>(null);
  const [week, setWeek] = useState("");
  const [rotations, setRotations] = useState<WeeklyRotationWithLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = readAuthSession();
    setSpecialist(session?.specialist ?? null);
  }, []);

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
    if (specialist && actorFromSpecialist(specialist)) {
      void reload(specialist);
    } else {
      setLoading(false);
    }
  }, [specialist, reload]);

  if (!specialist) {
    return (
      <GateShell>
        <p className="text-slate-300">
          Sign in on a Zebra / handheld via DeptSync Hub, then return here.
        </p>
        <Link href="/" className="mt-4 inline-block text-emerald-400 underline">
          Go to Hub login
        </Link>
      </GateShell>
    );
  }

  const actor = actorFromSpecialist(specialist);
  if (!actor) {
    return (
      <GateShell>
        <p className="text-slate-300">
          Rotation dashboard is for department supervisors and Master Admin.
        </p>
        <Link href="/" className="mt-4 inline-block text-emerald-400 underline">
          Back to Hub
        </Link>
      </GateShell>
    );
  }

  const dept = departmentMeta(effectiveDepartment(specialist));

  return (
    <div className="mx-auto min-h-dvh max-w-md px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
      <header className="mb-4">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
          DeptSync · Zebra
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-50">
          {dept.shortLabel} Rotation
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {specialist.name}
          {isMasterAdmin(specialist) ? " · Full store" : ""}
        </p>
        <div className="mt-2 flex gap-3 text-sm">
          <Link
            href="/"
            className="text-slate-400 underline-offset-2 hover:text-emerald-300 hover:underline"
          >
            ← Hub
          </Link>
          {isMasterAdmin(specialist) ? (
            <Link
              href="/admin/store-map"
              className="text-slate-400 underline-offset-2 hover:text-emerald-300 hover:underline"
            >
              Store Map
            </Link>
          ) : null}
        </div>
      </header>

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
    </div>
  );
}

function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
        DeptSync
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-50">Rotation Dashboard</h1>
      <div className="mt-4">{children}</div>
    </div>
  );
}
