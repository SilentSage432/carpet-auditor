/**
 * Inventory Hub chrome — bottom section tabs (Flooring / Appliances / Remnants / Master).
 * Cross-app Navigation Hub header lives in `NavigationHub.tsx`.
 * `HubHeader` kept as a thin alias for any legacy imports.
 */

"use client";

import {
  sectionTitle,
  visibleNavTabs,
} from "@/lib/rbac";
import { formatStoreLabel } from "@/lib/store";
import type { HubSection, StoreSpecialist } from "@/lib/types";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { HeaderNetworkStatus } from "@/components/hub/HeaderNetworkStatus";
import { HubIcon, NavIcon } from "@/components/hub/NavIcons";

type HubHeaderProps = {
  section: HubSection;
  specialist: StoreSpecialist | null;
  onOpenSpecialist: () => void;
  onChangePin?: () => void;
  onLogout?: () => void;
  storeNumber?: string;
};

/** @deprecated Prefer NavigationHub for new surfaces. */
export function HubHeader({
  section,
  specialist,
  onOpenSpecialist,
  onChangePin,
  onLogout,
  storeNumber,
}: HubHeaderProps) {
  const title = sectionTitle(section, specialist);

  return (
    <header className="glass-panel sticky top-0 z-40 pt-safe shadow-lg shadow-black/30">
      <div className="mx-auto flex min-h-12 max-w-md items-center gap-2 px-3 py-1">
        <DeptSyncBadge size="sm" />
        <div className="min-w-0 flex-1">
          <p className="glass-subtitle truncate text-emerald-400">
            DeptSync Hub
          </p>
          <p className="glass-muted truncate text-[10px] font-semibold">
            DeptSync
            {storeNumber ? ` · ${formatStoreLabel(storeNumber)}` : ""}
          </p>
          <h1 className="glass-title truncate text-[15px] leading-tight">
            {title}
          </h1>
          <HeaderNetworkStatus storeNumber={storeNumber} variant="banner" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenSpecialist}
            className="flex h-12 max-w-[8.5rem] items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-2.5 text-left backdrop-blur-sm transition active:scale-95"
            aria-label="Switch active specialist"
          >
            <HubIcon
              id={
                specialist?.role === "MasterAdmin"
                  ? "crown"
                  : specialist?.role === "Supervisor"
                    ? "shield"
                    : "user"
              }
              className="h-4 w-4 shrink-0 text-emerald-300"
            />
            <span className="min-w-0 truncate text-xs font-semibold text-emerald-200">
              {specialist ? specialist.name : "Locked"}
            </span>
          </button>
          {specialist && onChangePin ? (
            <button
              type="button"
              onClick={onChangePin}
              aria-label="Change PIN"
              title="Change PIN"
              className="btn-icon-touch"
            >
              <HubIcon id="settings" className="h-5 w-5" />
            </button>
          ) : null}
          {onLogout ? (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Log out and lock DeptSync"
              title="Log out"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-rose-500/40 bg-rose-950/40 text-rose-300 transition active:scale-95"
            >
              <HubIcon id="lock" className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

type BottomNavBarProps = {
  active: HubSection;
  onSelect: (section: HubSection) => void;
  specialist: StoreSpecialist | null;
};

/** In-page specialty tool switcher for Associates (ops bottom nav owns primary routes). */
export function AssociateSpecialtySwitcher({
  active,
  onSelect,
  specialist,
}: BottomNavBarProps) {
  const tabs = visibleNavTabs(specialist).filter((tab) => tab.id !== "settings");
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
                ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
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

export function BottomNavBar({
  active,
  onSelect,
  specialist,
}: BottomNavBarProps) {
  const tabs = visibleNavTabs(specialist);
  // Master Admin: Flooring · Appliances · Remnants · Master (even 4-up).
  const cols =
    tabs.length <= 3
      ? "grid-cols-3"
      : tabs.length === 4
        ? "grid-cols-4"
        : tabs.length === 5
          ? "grid-cols-5"
          : "grid-cols-4";

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-md border-t border-zinc-800/80 bg-zinc-900/95 pb-safe backdrop-blur-md shadow-[0_-8px_32px_-12px_rgba(0,0,0,0.55)]"
    >
      <div className={`grid ${cols}`}>
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 pt-1 transition ${
                isActive
                  ? "text-emerald-300"
                  : "text-zinc-400 active:text-zinc-200"
              }`}
            >
              {isActive ? (
                <span
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.85)]"
                  aria-hidden
                />
              ) : null}
              <NavIcon id={tab.icon} className="h-5 w-5" />
              <span className="max-w-full truncate text-[10px] font-bold uppercase tracking-wide">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
