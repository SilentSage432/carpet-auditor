"use client";

import { useCallback, useEffect, useState } from "react";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { DefaultPinNotice } from "@/components/hub/DefaultPinNotice";
import { FirstLoginCredentialsModal } from "@/components/hub/FirstLoginCredentialsModal";
import { BottomNavBar, HubHeader } from "@/components/hub/HubChrome";
import { SpecialistModal } from "@/components/hub/SpecialistModal";
import { CatalogSection } from "@/components/sections/CatalogSection";
import { CycleAuditSection } from "@/components/sections/CycleAuditSection";
import { ApplianceAuditSection } from "@/components/sections/ApplianceAuditSection";
import { RemnantSection } from "@/components/sections/RemnantSection";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import {
  canAccessSection,
  catalogDomainForMember,
  defaultSectionForMember,
  effectiveDepartment,
  isGenericDepartment,
} from "@/lib/rbac";
import {
  dedupeRoster,
  fetchSpecialists,
  getActiveSpecialist,
  isDefaultPin,
  needsCredentialSetup,
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
import { DepartmentAuditSection } from "@/components/sections/DepartmentAuditSection";

export default function DeptSyncHubPage() {
  const [section, setSection] = useState<HubSection>("audit");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const [specialist, setSpecialist] = useState<StoreSpecialist | null>(null);
  const [specialistOpen, setSpecialistOpen] = useState(false);
  const [specialists, setSpecialists] = useState<StoreSpecialist[]>([]);
  const [defaultPinNotice, setDefaultPinNotice] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [credentialSetupOpen, setCredentialSetupOpen] = useState(false);
  const [pinToast, setPinToast] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [storeNumber, setStoreNumberState] = useState(() =>
    typeof window === "undefined" ? "1234" : getStoreNumber()
  );

  function applyActiveFromRoster(roster: StoreSpecialist[]) {
    const matched = syncActiveSpecialistFromRoster(roster);
    if (matched) {
      setSpecialist(matched);
      setSection((prev) =>
        canAccessSection(matched, prev) ? prev : defaultSectionForMember(matched)
      );
      if (needsCredentialSetup(matched)) {
        setCredentialSetupOpen(true);
        setDefaultPinNotice(false);
      } else if (isDefaultPin(matched) && !wasPinRemindLater(matched.id)) {
        setDefaultPinNotice(true);
        setCredentialSetupOpen(false);
      } else {
        setDefaultPinNotice(false);
        setCredentialSetupOpen(false);
      }
      return;
    }
    const saved = getActiveSpecialist();
    if (saved) {
      setSpecialist(saved);
      setSection((prev) =>
        canAccessSection(saved, prev) ? prev : defaultSectionForMember(saved)
      );
      if (needsCredentialSetup(saved)) {
        setCredentialSetupOpen(true);
        setDefaultPinNotice(false);
      } else if (isDefaultPin(saved) && !wasPinRemindLater(saved.id)) {
        setDefaultPinNotice(true);
        setCredentialSetupOpen(false);
      } else {
        setDefaultPinNotice(false);
        setCredentialSetupOpen(false);
      }
      return;
    }
    setSpecialist(null);
    setSpecialistOpen(true);
    setDefaultPinNotice(false);
    setCredentialSetupOpen(false);
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
      setCredentialSetupOpen(false);
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
      specialistOpen || changePinOpen || credentialSetupOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [specialistOpen, changePinOpen, credentialSetupOpen]);

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
    setSection(defaultSectionForMember(member));

    if (needsCredentialSetup(member)) {
      setCredentialSetupOpen(true);
      setDefaultPinNotice(false);
      return;
    }

    const showNotice =
      (meta?.usedDefaultPin || isDefaultPin(member)) &&
      !wasPinRemindLater(member.id);
    setDefaultPinNotice(Boolean(showNotice));
    setCredentialSetupOpen(false);
  }

  function handleSpecialistUpdated(member: StoreSpecialist) {
    setSpecialist(member);
    setActiveSpecialist(member);
    upsertSpecialist(member);
    setDefaultPinNotice(false);
    setCredentialSetupOpen(false);
    setChangePinOpen(false);
    setPinToast(true);
    window.setTimeout(() => setPinToast(false), 2500);
  }

  function handleSectionSelect(next: HubSection) {
    if (!canAccessSection(specialist, next)) return;
    setSection(next);
  }

  const catalogDomain = catalogDomainForMember(specialist);
  const dept = effectiveDepartment(specialist);

  return (
    <div className="flex min-h-dvh flex-col">
      <HubHeader
        section={section}
        specialist={specialist}
        onOpenSpecialist={() => setSpecialistOpen(true)}
        onChangePin={specialist ? () => setChangePinOpen(true) : undefined}
        storeNumber={storeNumber}
      />
      <SpecialistModal
        open={specialistOpen && !credentialSetupOpen}
        active={specialist}
        onClose={() => setSpecialistOpen(false)}
        onSelect={handleSelectSpecialist}
      />
      <ChangePinModal
        key={changePinOpen ? `change-pin-${specialist?.id}` : "change-pin-closed"}
        open={changePinOpen && !credentialSetupOpen}
        member={specialist}
        onClose={() => setChangePinOpen(false)}
        onUpdated={handleSpecialistUpdated}
      />
      <FirstLoginCredentialsModal
        key={
          credentialSetupOpen
            ? `first-login-${specialist?.id}`
            : "first-login-closed"
        }
        open={credentialSetupOpen}
        member={specialist}
        onUpdated={handleSpecialistUpdated}
      />
      <DefaultPinNotice
        open={
          defaultPinNotice &&
          !changePinOpen &&
          !specialistOpen &&
          !credentialSetupOpen
        }
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
          ✅ Credentials updated successfully!
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
          section === "audit" ||
          section === "appliances" ||
          section === "department"
            ? "pb-44"
            : "pb-32"
        }`}
      >
        {section === "audit" && canAccessSection(specialist, "audit") && (
          <CycleAuditSection
            catalog={catalog}
            onCatalogChange={setCatalog}
            auditedBy={specialist?.name ?? ""}
            specialists={specialists}
            activeSpecialist={specialist}
          />
        )}
        {section === "catalog" && canAccessSection(specialist, "catalog") && (
          <CatalogSection
            catalog={catalog}
            onCatalogChange={setCatalog}
            domainFilter={catalogDomain}
          />
        )}
        {section === "remnants" && canAccessSection(specialist, "remnants") && (
          <RemnantSection
            catalog={catalog}
            remnants={remnants}
            onRemnantsChange={setRemnants}
            loggedBy={specialist?.name ?? ""}
            specialists={specialists}
            activeSpecialist={specialist}
          />
        )}
        {section === "appliances" &&
          canAccessSection(specialist, "appliances") && (
            <ApplianceAuditSection
              catalog={catalog}
              onCatalogChange={setCatalog}
              auditedBy={specialist?.name ?? ""}
            />
          )}
        {section === "department" &&
          canAccessSection(specialist, "department") &&
          isGenericDepartment(dept) && (
            <DepartmentAuditSection
              department={dept}
              catalog={catalog}
              onCatalogChange={setCatalog}
              auditedBy={specialist?.name ?? ""}
            />
          )}
        {section === "settings" && canAccessSection(specialist, "settings") && (
          <SettingsSection
            catalogCount={catalog.length}
            remnantCount={remnants.length}
            activeSpecialist={specialist}
            specialists={specialists}
            onSpecialistUpdated={handleSpecialistUpdated}
            onRosterChange={(roster) => setSpecialists(dedupeRoster(roster))}
            onOpenChangePin={() => setChangePinOpen(true)}
            storeNumber={storeNumber}
            onStoreNumberChange={setStoreNumberState}
          />
        )}
      </div>

      <BottomNavBar
        active={section}
        onSelect={handleSectionSelect}
        specialist={specialist}
      />
    </div>
  );
}
