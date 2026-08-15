"use client";

/**
 * /flooring — Flooring Cycle Audit deep link.
 * Never leaves the user on a dead hop: pin D23 context and open the Floor
 * dashboard with the Sunday staging drawer in-place.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { setAdminWorkingDepartment } from "@/lib/admin-department-context";
import { canAccessSection, isMasterAdmin } from "@/lib/rbac";
import { requestSundayAuditDrawer } from "@/lib/store-ops/sunday-audit";
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
    requestSundayAuditDrawer();
    router.replace("/dashboard");
  }, [router, specialist]);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Flooring Cycle Audit"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />
      <main className="hub-main">
        <p className="glass-card mt-2 px-4 py-3 text-sm text-zinc-300">
          Opening Sunday Cycle Audit Engine…
        </p>
      </main>
    </div>
  );
}
