"use client";

/**
 * Sticky Navigation Hub header — brand, department pill, account chip.
 * Bottom workflow tabs live in BottomNav.tsx. Route ownership: lib/nav-hub.ts.
 */

import type { ReactNode, RefObject } from "react";
import { useRef } from "react";
import { AdminDepartmentSwitcher } from "@/components/hub/AdminDepartmentSwitcher";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { HeaderNetworkStatus } from "@/components/hub/HeaderNetworkStatus";
import { formatStoreLabel } from "@/lib/store";
import type { StoreSpecialist } from "@/lib/types";

const LOGO_TAP_WINDOW_MS = 800;

type HubHeaderProps = {
  title: string;
  subtitle?: string;
  specialist: StoreSpecialist | null;
  storeNumber?: string;
  roleBadge: string;
  userOpen: boolean;
  userMenuId: string;
  userRef: RefObject<HTMLDivElement | null>;
  onToggleUser: () => void;
  userMenu: ReactNode;
  onPinnedNavigate?: (section: "audit" | "appliances" | "department") => void;
  onLogoTripleTap?: () => void;
};

export function HubHeader({
  title,
  subtitle,
  specialist,
  storeNumber,
  roleBadge,
  userOpen,
  userMenuId,
  userRef,
  onToggleUser,
  userMenu,
  onPinnedNavigate,
  onLogoTripleTap,
}: HubHeaderProps) {
  const tapTimes = useRef<number[]>([]);

  function handleLogoTap() {
    if (!onLogoTripleTap) return;
    const now = Date.now();
    const next = [...tapTimes.current, now].filter(
      (t) => now - t <= LOGO_TAP_WINDOW_MS
    );
    tapTimes.current = next;
    if (next.length >= 3) {
      tapTimes.current = [];
      onLogoTripleTap();
    }
  }

  return (
    <header className="glass-panel border-b border-zinc-800/80 shadow-lg shadow-black/30">
      <div className="mx-auto flex min-h-12 max-w-lg items-center gap-1.5 px-2 py-1 sm:px-3">
        {onLogoTripleTap ? (
          <button
            type="button"
            onClick={handleLogoTap}
            className="shrink-0 rounded-lg focus-visible:ring-1 focus-visible:ring-accent/40"
            aria-label="DeptSync"
          >
            <DeptSyncBadge size="sm" />
          </button>
        ) : (
          <DeptSyncBadge size="sm" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] font-bold uppercase tracking-tight text-accent">
            DeptSync
            {storeNumber ? ` · ${formatStoreLabel(storeNumber)}` : ""}
          </p>
          <h1 className="glass-title truncate text-[15px] leading-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="glass-muted truncate text-[10px] font-semibold">
              {subtitle}
            </p>
          ) : null}
        </div>

        <AdminDepartmentSwitcher
          specialist={specialist}
          compact
          onPinnedNavigate={onPinnedNavigate}
        />

        <div className="relative shrink-0" ref={userRef}>
          <button
            type="button"
            onClick={onToggleUser}
            aria-expanded={userOpen}
            aria-controls={userMenuId}
            aria-label="Account and PIN"
            className="theme-accent-surface flex h-12 max-w-[10.5rem] items-center gap-1.5 rounded-xl border px-2 text-left backdrop-blur-sm transition active:scale-[0.98] focus-visible:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30"
          >
            <HeaderNetworkStatus storeNumber={storeNumber} variant="compact">
              <span className="block truncate font-mono text-[9px] font-bold leading-none tracking-wide text-amber-300">
                {roleBadge.replace(/^\[|\]$/g, "")}
              </span>
            </HeaderNetworkStatus>
          </button>
          {userMenu}
        </div>
      </div>
    </header>
  );
}
