"use client";

/**
 * Navigation Hub chrome — title, department pill, account/PIN, Floor/Map/Roster/Settings bar.
 */

import { startTransition, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DevSandboxBanner } from "@/components/hub/DevSandboxBanner";
import { DevSandboxDrawer } from "@/components/hub/DevSandboxDrawer";
import { HeaderNetworkStatus } from "@/components/hub/HeaderNetworkStatus";
import { HubHeader } from "@/components/hub/HubHeader";
import { BottomNav } from "@/components/hub/BottomNav";
import {
  isSettingsToolHash,
  navLoginIdentity,
  navPrimaryLinks,
  navRoleBadge,
  navRoleLinks,
} from "@/lib/nav-hub";
import { requestSundayAuditDrawer } from "@/lib/store-ops/sunday-audit";
import { requestUserPreferencesDrawer } from "@/lib/ui/preferences-context";
import { useDevSandbox } from "@/lib/use-dev-sandbox";
import { writeDevSandbox } from "@/lib/dev-sandbox";
import type { StoreSpecialist } from "@/lib/types";

type NavigationHubProps = {
  title: string;
  subtitle?: string;
  specialist: StoreSpecialist | null;
  storeNumber?: string;
  onLogout?: () => void;
  onChangePin?: () => void;
  onOpenSpecialist?: () => void;
  /** Show ops bottom tab bar (default true). */
  showBottomNav?: boolean;
  /** Real signed-in profile — sandbox 3-tap stays available while previewing. */
  sandboxActor?: StoreSpecialist | null;
};

export function NavigationHub({
  title,
  subtitle,
  specialist,
  storeNumber,
  onLogout,
  onChangePin,
  onOpenSpecialist,
  showBottomNav = true,
  sandboxActor,
}: NavigationHubProps) {
  const pathname = usePathname() || "/";
  const search =
    typeof window !== "undefined" ? window.location.search : "";
  const router = useRouter();
  const links = navRoleLinks(specialist);
  const primaryLinks = navPrimaryLinks(links);
  const [userOpen, setUserOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const userMenuId = useId();
  const userRef = useRef<HTMLDivElement>(null);
  const { canOpen, sandbox } = useDevSandbox(sandboxActor ?? specialist);

  useEffect(() => {
    setUserOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === "sunday-audit" || hash === "sunday-rotation") {
      requestSundayAuditDrawer();
      if (pathname !== "/dashboard") {
        router.replace("/dashboard");
      }
      return;
    }
    if (isSettingsToolHash(hash) && pathname !== "/settings") {
      router.replace(`/settings#${hash}`);
    }
  }, [pathname, router]);

  useEffect(() => {
    if (!userOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!userRef.current?.contains(e.target as Node)) {
        setUserOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [userOpen]);

  const roleBadge = navRoleBadge(specialist);
  const loginId = navLoginIdentity(specialist);

  return (
    <>
      <div className="sticky top-0 z-40 pt-safe">
        {canOpen && sandbox.previewRole ? (
          <DevSandboxBanner sandbox={sandbox} />
        ) : null}
        <HubHeader
        title={title}
        subtitle={subtitle}
        specialist={specialist}
        storeNumber={storeNumber}
        roleBadge={roleBadge}
        userOpen={userOpen}
        userMenuId={userMenuId}
        userRef={userRef}
        onToggleUser={() => setUserOpen((o) => !o)}
        onPinnedNavigate={(section) => {
          startTransition(() => {
            router.push(`/?section=${section}`);
          });
        }}
        onLogoTripleTap={
          canOpen
            ? () => {
                if (!sandbox.previewRole) {
                  writeDevSandbox({
                    previewRole: "MASTER_ADMIN",
                    previewDepartment: "all",
                  });
                }
                setSandboxOpen(true);
              }
            : undefined
        }
        userMenu={
          userOpen ? (
            <div
              id={userMenuId}
              role="menu"
              className="glass-card absolute right-0 top-[calc(100%+0.35rem)] z-50 w-64 overflow-hidden"
            >
              <div className="border-b border-zinc-800/80 bg-zinc-950/50 px-4 py-3">
                <p className="font-mono text-[10px] font-bold tracking-wide text-amber-300">
                  {roleBadge}
                </p>
                <p className="glass-title mt-1 text-sm">
                  {specialist?.name ?? "Locked"}
                </p>
                <p className="glass-muted mt-0.5 break-all font-mono text-xs">
                  {loginId}
                </p>
                <HeaderNetworkStatus
                  storeNumber={storeNumber}
                  variant="detail"
                />
              </div>
              <div className="p-2">
                <MenuAction
                  label="Appearance & Preferences"
                  onClick={() => {
                    setUserOpen(false);
                    requestUserPreferencesDrawer();
                  }}
                />
                {onOpenSpecialist ? (
                  <MenuAction
                    label="Switch profile"
                    onClick={() => {
                      setUserOpen(false);
                      onOpenSpecialist();
                    }}
                  />
                ) : null}
                {onChangePin && specialist ? (
                  <MenuAction
                    label="Change PIN / password"
                    onClick={() => {
                      setUserOpen(false);
                      onChangePin();
                    }}
                  />
                ) : null}
                {onLogout ? (
                  <MenuAction
                    label="Log out"
                    danger
                    onClick={() => {
                      setUserOpen(false);
                      onLogout();
                    }}
                  />
                ) : null}
              </div>
            </div>
          ) : null
        }
      />
      </div>

      {showBottomNav && primaryLinks.length > 0 ? (
        <BottomNav
          pathname={pathname}
          search={search}
          primaryLinks={primaryLinks}
        />
      ) : null}

      {canOpen ? (
        <DevSandboxDrawer
          open={sandboxOpen}
          sandbox={sandbox}
          onClose={() => setSandboxOpen(false)}
        />
      ) : null}
    </>
  );
}

function MenuAction({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-12 w-full items-center rounded-xl px-3 text-left text-sm font-semibold ${
        danger
          ? "text-rose-300 hover:bg-rose-950/50"
          : "text-zinc-200 hover:bg-zinc-800/60"
      }`}
    >
      {label}
    </button>
  );
}
