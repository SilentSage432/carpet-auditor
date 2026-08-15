/**
 * Inventory Hub chrome — in-page specialty audit switcher.
 * Primary workflow tabs live in BottomNav.tsx. Header lives in HubHeader.tsx.
 */

"use client";

import { visibleFloorAuditTabs } from "@/lib/rbac";
import type { HubSection, StoreSpecialist } from "@/lib/types";
import { NavIcon } from "@/components/hub/NavIcons";

type SpecialtySwitcherProps = {
  active: HubSection;
  onSelect: (section: HubSection) => void;
  specialist: StoreSpecialist | null;
};

/** In-page specialty tool switcher (ops bottom nav owns primary routes). */
export function AssociateSpecialtySwitcher({
  active,
  onSelect,
  specialist,
}: SpecialtySwitcherProps) {
  const tabs = visibleFloorAuditTabs(specialist);
  if (tabs.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Specialty tools"
      className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${
              isActive
                ? "theme-accent-surface border"
                : "border-zinc-700 bg-zinc-950/70 text-zinc-400"
            }`}
          >
            <NavIcon id={tab.icon} className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
