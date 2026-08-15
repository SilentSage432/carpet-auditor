"use client";

import { useEffect, useState } from "react";
import { AdminRosterManager } from "@/components/hub/AdminRosterManager";
import { AssociateRosterPanel } from "@/components/admin/AssociateRosterPanel";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { hasElevatedAccess, isMasterAdmin } from "@/lib/rbac";
import { dedupeRoster, fetchSpecialists } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

export default function RolesAdminPage() {
  return (
    <SessionGate
      allow={hasElevatedAccess}
      denyMessage="Department access is managed by Super Admin or a department supervisor."
      denyHref="/dashboard"
      denyLinkLabel="Open Floor"
    >
      {({ specialist, storeNumber, logout }) => (
        <RolesBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function RolesBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [loading, setLoading] = useState(true);
  const master = isMasterAdmin(specialist);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const team = await fetchSpecialists();
      if (!cancelled) {
        setRoster(dedupeRoster(team));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeNumber]);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Roles & Department Access"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />
      <main className="hub-main">
        <p className="mb-4 text-sm text-slate-400">
          Grant Floor / Map / Stock access across departments. Primary home
          department stays assigned; extra chips are cross-department scope.
        </p>
        {loading ? (
          <p className="text-sm text-slate-400">Loading roster…</p>
        ) : master ? (
          <AdminRosterManager
            activeSpecialist={specialist}
            storeNumber={storeNumber}
            roster={roster}
            onRosterChange={(next) => setRoster(dedupeRoster(next))}
          />
        ) : (
          <AssociateRosterPanel
            specialist={specialist}
            roster={roster}
            onRosterChange={(next) => setRoster(dedupeRoster(next))}
          />
        )}
      </main>
    </div>
  );
}
