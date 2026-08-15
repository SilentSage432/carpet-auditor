"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { updateAuthSessionSpecialist } from "@/lib/auth-session";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import { dedupeRoster, fetchSpecialists } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

export function SettingsTab({
  specialist,
  storeNumber: initialStore,
  onStoreNumberChange,
  onChangePin,
}: WorkflowTabProps) {
  const [member, setMember] = useState(specialist);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [catalogCount, setCatalogCount] = useState(0);
  const [remnantCount, setRemnantCount] = useState(0);
  const [storeNumber, setStoreNumber] = useState(initialStore);
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

  useEffect(() => {
    setStoreNumber(initialStore);
  }, [initialStore]);

  useEffect(() => {
    setMember(specialist);
  }, [specialist]);

  function handleUpdated(next: StoreSpecialist) {
    updateAuthSessionSpecialist(next);
    setMember(next);
  }

  function handleStoreNumberChange(next: string) {
    setStoreNumber(next);
    onStoreNumberChange?.(next);
  }

  return (
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
          onOpenChangePin={() => onChangePin?.()}
          storeNumber={storeNumber}
          onStoreNumberChange={handleStoreNumberChange}
        />
      )}
    </main>
  );
}
