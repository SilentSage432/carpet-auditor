"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

export function SettingsTab({
  specialist,
  storeNumber: initialStore,
  onStoreNumberChange,
  onChangePin,
}: WorkflowTabProps) {
  const [member, setMember] = useState(specialist);
  const [catalogCount, setCatalogCount] = useState(0);
  const [remnantCount, setRemnantCount] = useState(0);
  const [storeNumber, setStoreNumber] = useState(initialStore);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [cat, rem] = await Promise.all([fetchCatalog(), fetchRemnants()]);
    setCatalogCount(cat.length);
    setRemnantCount(rem.length);
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
          specialists={[]}
          onSpecialistUpdated={setMember}
          onRosterChange={() => undefined}
          onOpenChangePin={() => onChangePin?.()}
          storeNumber={storeNumber}
          onStoreNumberChange={handleStoreNumberChange}
        />
      )}
    </main>
  );
}
