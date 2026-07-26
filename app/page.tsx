"use client";

import { useEffect, useState } from "react";
import { HubHeader, NavDrawer } from "@/components/hub/HubChrome";
import { SpecialistModal } from "@/components/hub/SpecialistModal";
import { CatalogSection } from "@/components/sections/CatalogSection";
import { CycleAuditSection } from "@/components/sections/CycleAuditSection";
import { RemnantSection } from "@/components/sections/RemnantSection";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import {
  fetchSpecialists,
  getActiveSpecialist,
  setActiveSpecialist,
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cat, rem, team] = await Promise.all([
        fetchCatalog(),
        fetchRemnants(),
        fetchSpecialists(),
      ]);
      if (!cancelled) {
        setCatalog(cat);
        setRemnants(rem);
        setSpecialists(team);
        const saved = getActiveSpecialist();
        if (saved) {
          setSpecialist(saved);
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
    document.body.style.overflow = menuOpen || specialistOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen, specialistOpen]);

  function handleSelectSpecialist(member: StoreSpecialist) {
    setSpecialist(member);
    setActiveSpecialist(member);
    setSpecialists((prev) =>
      prev.some((p) => p.id === member.id)
        ? prev
        : [...prev, member].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <HubHeader
        section={section}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((o) => !o)}
        specialist={specialist}
        onOpenSpecialist={() => setSpecialistOpen(true)}
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

      <div className="mx-auto w-full max-w-md flex-1 px-4 py-4 pb-10">
        {section === "audit" && (
          <CycleAuditSection
            catalog={catalog}
            onCatalogChange={setCatalog}
            auditedBy={specialist?.name ?? ""}
            specialists={specialists}
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
          />
        )}
      </div>
    </div>
  );
}
