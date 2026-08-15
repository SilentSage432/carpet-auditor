"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TaxonomyDrillDown } from "@/components/catalog/TaxonomyDrillDown";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { SupervisorAuditSummaryModal } from "@/components/store-ops/SupervisorAuditSummaryModal";
import {
  getTaxonomyForHubDepartment,
  type DepartmentTaxonomy,
} from "@/lib/catalog/taxonomies";
import {
  effectiveDepartment,
  isMasterAdmin,
} from "@/lib/rbac";
import { departmentMeta, type StoreSpecialist } from "@/lib/types";

/**
 * Department Overview — pace / ops entry only.
 * Auditing lives on Inventory Hub tabs (Wave C: no embedded auditor).
 */
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
  const meta = departmentMeta(dept === "all" ? "flooring" : dept);
  const [taxonomy, setTaxonomy] = useState<DepartmentTaxonomy | null>(null);
  const [rollupOpen, setRollupOpen] = useState(false);

  useEffect(() => {
    function reload() {
      const scope = dept === "all" ? "flooring" : dept;
      setTaxonomy(
        getTaxonomyForHubDepartment(scope, { includeOverrides: true })
      );
    }
    reload();
    window.addEventListener("deptsync:taxonomies-changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("deptsync:taxonomies-changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, [dept]);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title={`${meta.shortLabel} Overview`}
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />
      <main className="hub-main space-y-3">
        <div className="mb-1 rounded-xl border border-emerald-500/25 bg-slate-900/70 px-3 py-2.5">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
            Department Overview
          </p>
          <p className="mt-1 text-lg font-bold text-slate-50">
            {meta.icon} {meta.label}
          </p>
          <p className="mt-1 text-sm text-slate-400">{meta.description}</p>
        </div>

        {taxonomy ? <TaxonomyDrillDown taxonomy={taxonomy} /> : null}

        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => setRollupOpen(true)}
            className="flex min-h-14 items-center justify-center rounded-xl border-2 border-cyan-500/40 bg-cyan-950/35 px-4 text-sm font-bold text-cyan-100"
          >
            Weekly audit rollup
          </button>
          <Link
            href="/dashboard"
            className="flex min-h-14 items-center justify-center rounded-xl border-2 border-emerald-500/40 bg-emerald-950/40 px-4 text-sm font-bold text-emerald-200"
          >
            Open this week&apos;s Zebra checklist →
          </Link>
          {!isMasterAdmin(specialist) ? (
            <Link
              href="/"
              className="flex min-h-14 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-100"
            >
              Open Inventory Hub (scan / audit) →
            </Link>
          ) : (
            <Link
              href="/"
              className="flex min-h-14 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-100"
            >
              Open Inventory Hub →
            </Link>
          )}
          {!isMasterAdmin(specialist) ? (
            <Link
              href="/verify-rotation"
              className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-semibold text-slate-300"
            >
              End-of-week Verify &amp; Exceptions →
            </Link>
          ) : null}
        </div>
      </main>
      <SupervisorAuditSummaryModal
        open={rollupOpen}
        specialist={specialist}
        onClose={() => setRollupOpen(false)}
      />
    </div>
  );
}
