"use client";

import { useEffect, useState } from "react";
import { HubHeader, NavDrawer } from "@/components/hub/HubChrome";
import { CatalogSection } from "@/components/sections/CatalogSection";
import { CycleAuditSection } from "@/components/sections/CycleAuditSection";
import { RemnantSection } from "@/components/sections/RemnantSection";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import type { CatalogItem, HubSection, Remnant } from "@/lib/types";

export default function CarpetHubPage() {
  const [section, setSection] = useState<HubSection>("audit");
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cat, rem] = await Promise.all([fetchCatalog(), fetchRemnants()]);
      if (!cancelled) {
        setCatalog(cat);
        setRemnants(rem);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <div className="flex min-h-dvh flex-col">
      <HubHeader
        section={section}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((o) => !o)}
      />
      <NavDrawer
        open={menuOpen}
        active={section}
        onClose={() => setMenuOpen(false)}
        onSelect={setSection}
      />

      <div className="mx-auto w-full max-w-md flex-1 px-4 py-4 pb-10">
        {section === "audit" && (
          <CycleAuditSection catalog={catalog} onCatalogChange={setCatalog} />
        )}
        {section === "catalog" && (
          <CatalogSection catalog={catalog} onCatalogChange={setCatalog} />
        )}
        {section === "remnants" && (
          <RemnantSection
            catalog={catalog}
            remnants={remnants}
            onRemnantsChange={setRemnants}
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
