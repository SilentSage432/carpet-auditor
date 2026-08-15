"use client";

import { useCallback, useEffect, useState } from "react";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { SettingsSection } from "@/components/sections/SettingsSection";
import {
  updateAuthSessionSpecialist,
} from "@/lib/auth-session";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import {
  dedupeRoster,
  fetchSpecialists,
} from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

export default function SettingsPage() {
  return (
    <SessionGate>
      {({ specialist, storeNumber, logout }) => (
        <SettingsBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function SettingsBody({
  specialist,
  storeNumber: initialStore,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [member, setMember] = useState(specialist);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [catalogCount, setCatalogCount] = useState(0);
  const [remnantCount, setRemnantCount] = useState(0);
  const [storeNumber, setStoreNumber] = useState(initialStore);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [cat, rem, team] = await Promise.all([
      fetchCatalog(),
      fetchRemnants(),
      fetchSpecialists(),
    ]);
    setCatalogCount(cat.length);
    setRemnantCount(rem.length);
    setRoster(dedupeRoster(team));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, storeNumber]);

  function handleUpdated(next: StoreSpecialist) {
    updateAuthSessionSpecialist(next);
    setMember(next);
    setRoster((prev) => dedupeRoster([next, ...prev]));
    setChangePinOpen(false);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Settings & Config"
        specialist={member}
        storeNumber={storeNumber}
        onLogout={logout}
        onChangePin={() => setChangePinOpen(true)}
      />
      <ChangePinModal
        key={changePinOpen ? `pin-${member.id}` : "pin-closed"}
        open={changePinOpen}
        member={member}
        onClose={() => setChangePinOpen(false)}
        onUpdated={handleUpdated}
      />
      <main className="hub-main">
        {loading ? (
          <p className="text-sm text-slate-400">Loading settings…</p>
        ) : (
          <SettingsSection
            catalogCount={catalogCount}
            remnantCount={remnantCount}
            activeSpecialist={member}
            specialists={roster}
            onSpecialistUpdated={handleUpdated}
            onRosterChange={(next) => setRoster(dedupeRoster(next))}
            onOpenChangePin={() => setChangePinOpen(true)}
            storeNumber={storeNumber}
            onStoreNumberChange={setStoreNumber}
          />
        )}
      </main>
    </div>
  );
}
