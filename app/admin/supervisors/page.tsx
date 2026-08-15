"use client";

import { useEffect, useState } from "react";
import { AdminRosterManager } from "@/components/hub/AdminRosterManager";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { isMasterAdmin } from "@/lib/rbac";
import { dedupeRoster, fetchSpecialists } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

export default function SupervisorsAdminPage() {
  return (
    <SessionGate
      allow={isMasterAdmin}
      denyMessage="Supervisor management is restricted to Super Admin / Master Admin."
      denyHref="/dashboard"
      denyLinkLabel="Open Floor"
    >
      {({ specialist, storeNumber, logout }) => (
        <SupervisorsBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function SupervisorsBody({
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
        title="Supervisor Logins"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />
      <main className="hub-main">
        <p className="mb-4 text-sm text-slate-400">
          Issue department supervisor credentials, reset temporary passwords, and
          deactivate access.
        </p>
        {loading ? (
          <p className="text-sm text-slate-400">Loading roster…</p>
        ) : (
          <AdminRosterManager
            activeSpecialist={specialist}
            storeNumber={storeNumber}
            roster={roster}
            onRosterChange={(next) => setRoster(dedupeRoster(next))}
          />
        )}
      </main>
    </div>
  );
}
