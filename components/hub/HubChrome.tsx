/**
 * Inventory Hub chrome — bottom section tabs (Flooring / Appliances / Remnants / Master).
 * Cross-app Navigation Hub header lives in `NavigationHub.tsx`.
 * `HubHeader` kept as a thin alias for any legacy imports.
 */

"use client";

import { useNetworkBadge } from "@/lib/network";
import {
  sectionTitle,
  visibleNavTabs,
} from "@/lib/rbac";
import { formatStoreLabel } from "@/lib/store";
import type { HubSection, StoreSpecialist } from "@/lib/types";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";

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
  const network = useNetworkBadge(storeNumber);
  const title = sectionTitle(section, specialist);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-md items-center gap-2 px-3 py-1.5">
        <DeptSyncBadge size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
            DeptSync Hub
          </p>
          <p className="truncate text-[10px] font-semibold text-slate-400">
            DeptSync
            {storeNumber ? ` · ${formatStoreLabel(storeNumber)}` : ""}
          </p>
          <h1 className="truncate text-base font-bold text-slate-50">
            {title}
          </h1>
          <p
            className={`mt-0.5 flex items-center gap-1.5 truncate text-[10px] font-semibold ${
              network.tone === "online" ? "text-emerald-400/90" : "text-amber-300/90"
            }`}
            title={network.label}
          >
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                network.tone === "online" ? "bg-emerald-400" : "bg-amber-400"
              }`}
              aria-hidden
            />
            <span className="truncate">
              {network.tone === "online" ? "🟢 Online" : "🟠 Offline Mode"}
              {network.pending > 0 ? ` · ${network.pending} queued` : ""}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenSpecialist}
            className="flex h-12 max-w-[8.5rem] items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-2.5 text-left transition active:scale-95"
            aria-label="Switch active specialist"
          >
            <span aria-hidden>
              {specialist?.role === "MasterAdmin"
                ? "👑"
                : specialist?.role === "Supervisor"
                  ? "🛡️"
                  : "👤"}
            </span>
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
              className="flex h-12 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-100 transition active:scale-95"
            >
              ⚙️
            </button>
          ) : null}
          {onLogout ? (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Log out and lock DeptSync"
              title="Log out"
              className="flex h-12 w-11 items-center justify-center rounded-xl border border-red-500/40 bg-red-950/40 text-sm font-bold text-red-300 transition active:scale-95"
            >
              🔒
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
      className="mb-3 flex gap-1.5 overflow-x-auto pb-1"
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
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-bold transition ${
              isActive
                ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                : "border-slate-700 bg-slate-950/70 text-slate-400"
            }`}
          >
            <span aria-hidden>{tab.icon}</span>
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
      className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-md border-t border-slate-800 bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
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
              className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 pb-1.5 pt-2 transition ${
                isActive
                  ? "text-emerald-300 [text-shadow:0_0_12px_rgba(16,185,129,0.55)]"
                  : "text-slate-400 active:text-slate-200"
              }`}
            >
              {isActive ? (
                <span
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.85)]"
                  aria-hidden
                />
              ) : null}
              <span className="text-base leading-none sm:text-lg" aria-hidden>
                {tab.icon}
              </span>
              <span className="max-w-full truncate text-[9px] font-bold uppercase tracking-wide sm:text-[10px]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
