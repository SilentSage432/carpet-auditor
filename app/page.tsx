"use client";

import { useCallback, useEffect, useState } from "react";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { DefaultPinNotice } from "@/components/hub/DefaultPinNotice";
import { BottomNavBar, HubHeader, NavDrawer } from "@/components/hub/HubChrome";
import { SpecialistModal } from "@/components/hub/SpecialistModal";
import { CatalogSection } from "@/components/sections/CatalogSection";
import { CycleAuditSection } from "@/components/sections/CycleAuditSection";
import { RemnantSection } from "@/components/sections/RemnantSection";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import {
  dedupeRoster,
  fetchSpecialists,
  getActiveSpecialist,
  isDefaultPin,
  setActiveSpecialist,
  setPinRemindLater,
  syncActiveSpecialistFromRoster,
  wasPinRemindLater,
} from "@/lib/specialists";
import { getStoreNumber, STORE_CHANGED_EVENT } from "@/lib/store";
import { flushSyncQueue } from "@/lib/sync-queue";
import type {
  CatalogItem,
  HubSection,
  Remnant,
  StoreSpecialist,
} from "@/lib/types";

export default function CarpetHubPage() {
  const [section, setSection] = useState<HubSection>("audit");
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [specialist, setSpecialist] = useState<StoreSpecialist | null>(null);
  const [specialistOpen, setSpecialistOpen] = useState(false);
  const [specialists, setSpecialists] = useState<StoreSpecialist[]>([]);
  const [defaultPinNotice, setDefaultPinNotice] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [pinToast, setPinToast] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [storeNumber, setStoreNumberState] = useState(() =>
    typeof window === "undefined" ? "1234" : getStoreNumber()
  );

  function applyActiveFromRoster(roster: StoreSpecialist[]) {
    const matched = syncActiveSpecialistFromRoster(roster);
    if (matched) {
      setSpecialist(matched);
      // Dismiss default-PIN banner once the live pin is no longer 1234
      if (isDefaultPin(matched) && !wasPinRemindLater(matched.id)) {
        setDefaultPinNotice(true);
      } else {
        setDefaultPinNotice(false);
      }
      return;
    }
    const saved = getActiveSpecialist();
    if (saved) {
      setSpecialist(saved);
      if (isDefaultPin(saved) && !wasPinRemindLater(saved.id)) {
        setDefaultPinNotice(true);
      } else {
        setDefaultPinNotice(false);
      }
      return;
    }
    setSpecialist(null);
    setSpecialistOpen(true);
    setDefaultPinNotice(false);
  }

  const loadStoreData = useCallback(async () => {
    const [cat, rem, team] = await Promise.all([
      fetchCatalog(),
      fetchRemnants(),
      fetchSpecialists(),
    ]);
    const roster = dedupeRoster(team);
    setCatalog(cat);
    setRemnants(rem);
    setSpecialists(roster);
    applyActiveFromRoster(roster);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cat, rem, team] = await Promise.all([
        fetchCatalog(),
        fetchRemnants(),
        fetchSpecialists(),
      ]);
      if (cancelled) return;
      const roster = dedupeRoster(team);
      setCatalog(cat);
      setRemnants(rem);
      setSpecialists(roster);
      applyActiveFromRoster(roster);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onStoreChanged(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      setStoreNumberState(detail || getStoreNumber());
      setActiveSpecialist(null);
      setSpecialist(null);
      setDefaultPinNotice(false);
      void loadStoreData();
    }
    window.addEventListener(STORE_CHANGED_EVENT, onStoreChanged);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, onStoreChanged);
  }, [loadStoreData]);

  useEffect(() => {
    async function onOnline() {
      const synced = await flushSyncQueue();
      if (synced > 0) {
        setSyncToast(
          `🟢 Connected! Synced ${synced} offline action${synced === 1 ? "" : "s"} to store database.`
        );
        window.setTimeout(() => setSyncToast(null), 4000);
        await loadStoreData();
      }
    }
    window.addEventListener("online", onOnline);
    if (navigator.onLine) {
      void onOnline();
    }
    return () => window.removeEventListener("online", onOnline);
  }, [loadStoreData]);

  useEffect(() => {
    document.body.style.overflow =
      menuOpen || specialistOpen || changePinOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen, specialistOpen, changePinOpen]);

  function upsertSpecialist(member: StoreSpecialist) {
    setSpecialists((prev) => dedupeRoster([member, ...prev]));
  }

  function handleSelectSpecialist(
    member: StoreSpecialist,
    meta?: { usedDefaultPin: boolean }
  ) {
    setSpecialist(member);
    setActiveSpecialist(member);
    upsertSpecialist(member);
    const showNotice =
      (meta?.usedDefaultPin || isDefaultPin(member)) &&
      !wasPinRemindLater(member.id);
    setDefaultPinNotice(Boolean(showNotice));
  }

  function handleSpecialistUpdated(member: StoreSpecialist) {
    setSpecialist(member);
    setActiveSpecialist(member);
    upsertSpecialist(member);
    // Always dismiss default-PIN banner after a successful PIN save
    setDefaultPinNotice(false);
    setChangePinOpen(false);
    setPinToast(true);
    window.setTimeout(() => setPinToast(false), 2500);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <HubHeader
        section={section}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((o) => !o)}
        specialist={specialist}
        onOpenSpecialist={() => setSpecialistOpen(true)}
        onChangePin={specialist ? () => setChangePinOpen(true) : undefined}
        storeNumber={storeNumber}
      />
      <NavDrawer
        open={menuOpen}
        active={section}
        onClose={() => setMenuOpen(false)}
        onSelect={setSection}
      />
      <SpecialistModal
        open={specialistOpen}
        active={specialist}
        onClose={() => setSpecialistOpen(false)}
        onSelect={handleSelectSpecialist}
      />
      <ChangePinModal
        key={changePinOpen ? `change-pin-${specialist?.id}` : "change-pin-closed"}
        open={changePinOpen}
        member={specialist}
        onClose={() => setChangePinOpen(false)}
        onUpdated={handleSpecialistUpdated}
      />
      <DefaultPinNotice
        open={defaultPinNotice && !changePinOpen && !specialistOpen}
        onSetNewPin={() => {
          setDefaultPinNotice(false);
          setChangePinOpen(true);
        }}
        onRemindLater={() => {
          if (specialist) setPinRemindLater(specialist.id);
          setDefaultPinNotice(false);
        }}
      />

      {pinToast && (
        <p
          role="status"
          className="fixed inset-x-0 top-20 z-[56] mx-auto w-fit max-w-sm rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-2 text-center text-sm font-semibold text-emerald-200 shadow-lg"
        >
          ✅ Supervisor PIN updated successfully!
        </p>
      )}

      {syncToast && (
        <p
          role="status"
          className="fixed inset-x-0 top-20 z-[56] mx-auto max-w-sm rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-2 text-center text-sm font-semibold text-emerald-200 shadow-lg"
        >
          {syncToast}
        </p>
      )}

      <div
        className={`mx-auto w-full max-w-md flex-1 overflow-x-hidden px-4 py-4 ${
          section === "audit" ? "pb-44" : "pb-32"
        }`}
      >
        {section === "audit" && (
          <CycleAuditSection
            catalog={catalog}
            onCatalogChange={setCatalog}
            auditedBy={specialist?.name ?? ""}
            specialists={specialists}
            activeSpecialist={specialist}
          />
        )}
        {section === "catalog" && (
          <CatalogSection catalog={catalog} onCatalogChange={setCatalog} />
        )}
        {section === "remnants" && (
          <RemnantSection
            catalog={catalog}
            remnants={remnants}
            onRemnantsChange={setRemnants}
            loggedBy={specialist?.name ?? ""}
            specialists={specialists}
            activeSpecialist={specialist}
          />
        )}
        {section === "settings" && (
          <SettingsSection
            catalogCount={catalog.length}
            remnantCount={remnants.length}
            activeSpecialist={specialist}
            onSpecialistUpdated={handleSpecialistUpdated}
            onOpenChangePin={() => setChangePinOpen(true)}
            storeNumber={storeNumber}
            onStoreNumberChange={setStoreNumberState}
          />
        )}
      </div>

      <BottomNavBar active={section} onSelect={setSection} />
    </div>
  );
}
