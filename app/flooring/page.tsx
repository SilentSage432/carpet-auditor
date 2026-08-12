"use client";

/**
 * /flooring — Flooring Cycle Audit deep link for dual-role Master Admin / Flooring DS.
 * Redirects into Inventory Hub audit section (no duplicate auditor).
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SundayAuditStagingCard } from "@/components/admin/SundayAuditStagingCard";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { setAdminWorkingDepartment } from "@/lib/admin-department-context";
import { canAccessSection, isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

export default function FlooringDeepLinkPage() {
  return (
    <SessionGate
      allow={(m) => canAccessSection(m, "audit") || isMasterAdmin(m)}
      denyMessage="Flooring Cycle Audit is for Flooring supervisors and Master Admin."
    >
      {({ specialist, storeNumber, logout }) => (
        <FlooringBridge
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function FlooringBridge({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    if (isMasterAdmin(specialist)) {
      setAdminWorkingDepartment("flooring");
    }
    const t = window.setTimeout(() => {
      router.replace("/?section=audit");
    }, 900);
    return () => window.clearTimeout(t);
  }, [router, specialist]);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Flooring Cycle Audit"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />
      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <SundayAuditStagingCard specialist={specialist} forceShow />
        <p className="glass-card mt-2 px-4 py-3 text-sm text-zinc-300">
          Opening Flooring Cycle Audit workspace…
          <LinkHint />
        </p>
      </main>
    </div>
  );
}

function LinkHint() {
  return (
    <a
      href="/?section=audit"
      className="mt-2 block font-semibold text-emerald-300 underline-offset-2 hover:underline"
    >
      Continue to Cycle Audit →
    </a>
  );
}
