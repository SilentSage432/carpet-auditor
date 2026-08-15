"use client";

import { useEffect, useState } from "react";
import { SettingsSection } from "@/components/sections/SettingsSection";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";

export function SettingsTab({
  specialist,
  storeNumber: initialStore,
  onStoreNumberChange,
  onChangePin,
}: WorkflowTabProps) {
  const [member, setMember] = useState(specialist);
  const [storeNumber, setStoreNumber] = useState(initialStore);

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
      <SettingsSection
        activeSpecialist={member}
        onOpenChangePin={() => onChangePin?.()}
        storeNumber={storeNumber}
        onStoreNumberChange={handleStoreNumberChange}
      />
    </main>
  );
}
