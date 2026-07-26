"use client";

import { useEffect, useState } from "react";
import { ChangePinModal } from "@/components/hub/ChangePinModal";
import { DefaultPinNotice } from "@/components/hub/DefaultPinNotice";
import { HubHeader, NavDrawer } from "@/components/hub/HubChrome";
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
  wasPinRemindLater,
} from "@/lib/specialists";
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cat, rem, team] = await Promise.all([
        fetchCatalog(),
        fetchRemnants(),
        fetchSpecialists(),
      ]);
      if (!cancelled) {
        const roster = dedupeRoster(team);
        setCatalog(cat);
        setRemnants(rem);
        setSpecialists(roster);
        const saved = getActiveSpecialist();
        if (saved) {
          const matched =
            roster.find((m) => m.id === saved.id) ??
            roster.find((m) => m.name === saved.name) ??
            saved;
          setSpecialist(matched);
          if (isDefaultPin(matched) && !wasPinRemindLater(matched.id)) {
            setDefaultPinNotice(true);
          }
        } else {
          setSpecialistOpen(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setDefaultPinNotice(false);
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
          className="fixed inset-x-0 top-16 z-[56] mx-auto w-fit rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-lg"
        >
          PIN updated successfully!
        </p>
      )}

      <div className="mx-auto w-full max-w-md flex-1 px-4 py-4 pb-28">
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
          />
        )}
        {section === "settings" && (
          <SettingsSection
            catalogCount={catalog.length}
            remnantCount={remnants.length}
            activeSpecialist={specialist}
            onSpecialistUpdated={handleSpecialistUpdated}
            onOpenChangePin={() => setChangePinOpen(true)}
          />
        )}
      </div>
    </div>
  );
}
