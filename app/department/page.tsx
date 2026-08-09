"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { ApplianceAuditSection } from "@/components/sections/ApplianceAuditSection";
import { CycleAuditSection } from "@/components/sections/CycleAuditSection";
import { DepartmentAuditSection } from "@/components/sections/DepartmentAuditSection";
import { fetchCatalog } from "@/lib/catalog";
import {
  effectiveDepartment,
  isGenericDepartment,
  isMasterAdmin,
} from "@/lib/rbac";
import { dedupeRoster, fetchSpecialists } from "@/lib/specialists";
import {
  departmentMeta,
  type CatalogItem,
  type StoreSpecialist,
} from "@/lib/types";

export default function DepartmentOverviewPage() {
  return (
    <SessionGate
      allow={(m) => m.role === "Supervisor" || isMasterAdmin(m)}
      denyMessage="Department Overview is for supervisors and Master Admin."
    >
      {({ specialist, storeNumber, logout }) => (
        <DepartmentBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function DepartmentBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const dept = effectiveDepartment(specialist);
  const meta = departmentMeta(dept);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [cat, team] = await Promise.all([
      fetchCatalog(),
      fetchSpecialists(),
    ]);
    setCatalog(cat);
    setRoster(dedupeRoster(team));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, storeNumber]);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title={`${meta.shortLabel} Overview`}
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />
      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <div className="mb-4 rounded-2xl border border-emerald-500/25 bg-slate-900/70 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
            Department Overview
          </p>
          <p className="mt-1 text-lg font-bold text-slate-50">
            {meta.icon} {meta.label}
          </p>
          <p className="mt-1 text-sm text-slate-400">{meta.description}</p>
          <Link
            href="/dashboard"
            className="mt-3 inline-flex min-h-12 items-center text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
          >
            Open this week&apos;s Zebra checklist →
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading department workspace…</p>
        ) : isMasterAdmin(specialist) ? (
          <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-6 text-sm text-slate-400">
            Master Admin: open{" "}
            <Link href="/" className="text-emerald-300 underline">
              Inventory Hub
            </Link>{" "}
            for full-store audits, or use Zebra Floor View for rotations.
          </p>
        ) : dept === "appliances" ? (
          <ApplianceAuditSection
            catalog={catalog}
            onCatalogChange={setCatalog}
            auditedBy={specialist.name}
            activeSpecialist={specialist}
          />
        ) : dept === "flooring" ? (
          <CycleAuditSection
            catalog={catalog}
            onCatalogChange={setCatalog}
            auditedBy={specialist.name}
            specialists={roster}
            activeSpecialist={specialist}
          />
        ) : isGenericDepartment(dept) ? (
          <DepartmentAuditSection
            department={dept}
            catalog={catalog}
            onCatalogChange={setCatalog}
            auditedBy={specialist.name}
            activeSpecialist={specialist}
          />
        ) : (
          <p className="text-sm text-slate-400">No department workspace mapped.</p>
        )}
      </main>
    </div>
  );
}
