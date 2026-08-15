"use client";

/**
 * Navigation Hub chrome — HubHeader department pill + Floor/Map/Stock/Settings bottom bar.
 * Master Admin: Admin Tools slide-over (defaults closed).
 */

import dynamic from "next/dynamic";
import type { DynamicOptionsLoadingProps } from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  openAdminTools,
  subscribeAdminTools,
  type AdminToolsEventDetail,
  type AdminToolsSection,
} from "@/components/hub/admin-tools-events";
import { BottomNav } from "@/components/hub/BottomNav";
import { ChunkErrorBoundary } from "@/components/hub/ChunkErrorBoundary";
import { HeaderNetworkStatus } from "@/components/hub/HeaderNetworkStatus";
import { HubHeader } from "@/components/hub/HubHeader";
import { HubIcon, NavIcon } from "@/components/hub/NavIcons";
import {
  isNavHubPathActive,
  isNavOverflowActive,
  isSpecialtyHubHref,
  navLoginIdentity,
  navOverflowLinks,
  navPrimaryLinks,
  navRoleBadge,
  navRoleLinks,
  specialtyHubHref,
  type NavHubLink,
} from "@/lib/nav-hub";
import { isAssociate, isMasterAdmin } from "@/lib/rbac";
import { requestSundayAuditDrawer } from "@/lib/store-ops/sunday-audit";
import type { StoreSpecialist } from "@/lib/types";

function AdminToolsLoadingShell({
  error,
  retry,
}: DynamicOptionsLoadingProps) {
  if (error) {
    console.error("[AdminTools] chunk failed to load", error);
    return (
      <div className="fixed inset-0 z-[70]" role="alert">
        <div className="absolute inset-0 bg-slate-950/70" />
        <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l-2 border-rose-400/50 bg-slate-950">
          <div className="border-b border-rose-500/30 bg-rose-950/40 px-4 py-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-rose-300">
              Super Admin
            </p>
            <p className="mt-1 text-sm font-bold text-rose-100">Admin Tools</p>
          </div>
          <p className="px-4 pt-4 text-sm text-zinc-300">
            {error.message || "Admin Tools could not load."}
          </p>
          {retry ? (
            <button
              type="button"
              onClick={() => retry()}
              className="mx-4 mt-4 min-h-12 rounded-xl bg-accent px-4 text-sm font-bold text-accent-fg"
            >
              Retry
            </button>
          ) : null}
        </aside>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70]" role="status" aria-live="polite">
      <div className="absolute inset-0 bg-slate-950/70" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l-2 border-amber-400/50 bg-slate-950">
        <div className="border-b border-amber-500/30 bg-amber-950/40 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
            Super Admin
          </p>
          <p className="mt-1 text-sm font-bold text-amber-100">Admin Tools</p>
        </div>
        <p className="px-4 py-6 text-sm text-zinc-400">Opening tools…</p>
      </aside>
    </div>
  );
}

const AdminToolsDrawer = dynamic(
  () => import("@/components/hub/AdminToolsDrawer"),
  { ssr: false, loading: AdminToolsLoadingShell }
);

type NavigationHubProps = {
  title: string;
  subtitle?: string;
  specialist: StoreSpecialist | null;
  storeNumber?: string;
  onLogout?: () => void;
  onChangePin?: () => void;
  onOpenSpecialist?: () => void;
  onStoreNumberChange?: (storeNumber: string) => void;
  /** Show ops bottom tab bar (default true). */
  showBottomNav?: boolean;
};

export function NavigationHub({
  title,
  subtitle,
  specialist,
  storeNumber,
  onLogout,
  onChangePin,
  onOpenSpecialist,
  onStoreNumberChange,
  showBottomNav = true,
}: NavigationHubProps) {
  const pathname = usePathname() || "/";
  const search =
    typeof window !== "undefined" ? window.location.search : "";
  const router = useRouter();
  const links = navRoleLinks(specialist);
  const primaryLinks = navPrimaryLinks(links);
  const overflowLinks = navOverflowLinks(links);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminHosted, setAdminHosted] = useState(false);
  const [adminSection, setAdminSection] =
    useState<AdminToolsSection>("menu");
  const [adminForce, setAdminForce] = useState(false);
  const [adminSunday, setAdminSunday] = useState(false);
  const [adminNotes, setAdminNotes] = useState(false);
  const userMenuId = useId();
  const drawerId = useId();
  const moreSheetId = useId();
  const userRef = useRef<HTMLDivElement>(null);
  const master = isMasterAdmin(specialist);
  const associate = isAssociate(specialist);
  const linksIncludeHub = links.some((link) => isSpecialtyHubHref(link.href));

  const applyAdminOpen = useCallback((detail: AdminToolsEventDetail = {}) => {
    setAdminSection(detail.section ?? "menu");
    setAdminForce(Boolean(detail.openForceRotation));
    setAdminSunday(Boolean(detail.openSundayAudit));
    setAdminNotes(Boolean(detail.openManagerNotes));
    setAdminHosted(true);
    setAdminOpen(true);
  }, []);

  const requestAdminTools = useCallback(
    (detail: AdminToolsEventDetail = {}) => {
      applyAdminOpen(detail);
      openAdminTools(detail);
    },
    [applyAdminOpen]
  );

  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    return subscribeAdminTools(applyAdminOpen);
  }, [applyAdminOpen]);

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
    if (!master) return;
    if (hash === "bulk-generate" || hash === "map-management") {
      requestAdminTools({ section: "bulk" });
    } else if (hash === "weekly-rotation") {
      requestAdminTools({ section: "menu", openForceRotation: true });
    } else if (hash === "manager-notes" || hash === "s-pen-notes") {
      requestAdminTools({ section: "menu", openManagerNotes: true });
    } else if (hash === "admin-tools") {
      requestAdminTools({ section: "menu" });
    }
  }, [master, pathname, requestAdminTools, router]);

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

  useEffect(() => {
    document.body.style.overflow = menuOpen || moreOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen, moreOpen]);

  const roleBadge = navRoleBadge(specialist);
  const loginId = navLoginIdentity(specialist);

  return (
    <>
      <HubHeader
        title={title}
        subtitle={subtitle}
        specialist={specialist}
        storeNumber={storeNumber}
        roleBadge={roleBadge}
        menuOpen={menuOpen}
        drawerId={drawerId}
        onOpenMenu={() => setMenuOpen(true)}
        userOpen={userOpen}
        userMenuId={userMenuId}
        userRef={userRef}
        onToggleUser={() => setUserOpen((o) => !o)}
        onPinnedNavigate={(section) => {
          startTransition(() => {
            router.push(`/?section=${section}`);
          });
        }}
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
                {master ? (
                  <MenuAction
                    label="Admin Tools"
                    onClick={() => {
                      setUserOpen(false);
                      requestAdminTools({ section: "menu" });
                    }}
                  />
                ) : null}
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
                <Link
                  href={associate ? "/settings" : "/"}
                  role="menuitem"
                  className="flex h-12 items-center rounded-xl px-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800/60"
                  onClick={() => setUserOpen(false)}
                >
                  {associate ? "My Profile / PIN" : "Inventory Hub"}
                </Link>
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

      {menuOpen ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 glass-backdrop"
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
          />
          <nav
            id={drawerId}
            aria-label="Navigation Hub"
            className="absolute inset-y-0 left-0 flex w-[min(100%,22rem)] flex-col border-r border-zinc-800/80 bg-zinc-950/95 backdrop-blur-xl shadow-2xl shadow-black/50"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
              <div>
                <p className="glass-subtitle text-accent">
                  Navigation Hub
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-amber-300">
                  {roleBadge}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="btn-icon-touch"
                aria-label="Close menu"
              >
                <HubIcon id="close" className="h-5 w-5" />
              </button>
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto p-3 pb-safe">
              {master ? (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      requestAdminTools({ section: "menu" });
                      setMenuOpen(false);
                    }}
                    className="flex h-14 w-full items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-950/30 px-4 text-left backdrop-blur-sm"
                  >
                    <NavIcon id="grid" className="h-5 w-5 text-amber-200" />
                    <span>
                      <span className="block text-sm font-bold text-amber-100">
                        Admin Tools
                      </span>
                      <span className="block text-xs text-amber-200/70">
                        Bulk generate, rotation, store config
                      </span>
                    </span>
                  </button>
                </li>
              ) : null}
              {links.map((link) => (
                <NavDrawerItem
                  key={link.href}
                  link={link}
                  active={isNavHubPathActive(pathname, link.href, search)}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
              {!linksIncludeHub && specialist ? (
                <li>
                  <Link
                    href={specialtyHubHref(specialist)}
                    onClick={() => setMenuOpen(false)}
                    className="glass-card flex h-14 items-center gap-3 px-4 text-left"
                  >
                    <NavIcon id="home" className="h-5 w-5 text-accent" />
                    <span>
                      <span className="block text-sm font-bold text-zinc-100">
                        Scan &amp; Audit
                      </span>
                      <span className="glass-muted block text-xs">
                        Roll scan, appliances, department audits
                      </span>
                    </span>
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        </div>
      ) : null}

      {moreOpen ? (
        <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 glass-backdrop"
            aria-label="Close more menu"
            onClick={() => setMoreOpen(false)}
          />
          <div
            id={moreSheetId}
            className="glass-card absolute bottom-0 left-0 right-0 mx-auto max-w-lg !rounded-b-none border-t border-zinc-700/80 pb-safe shadow-[0_-16px_48px_-12px_rgba(0,0,0,0.65)]"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                More
              </p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="btn-icon-touch"
                aria-label="Close"
              >
                <HubIcon id="close" className="h-5 w-5" />
              </button>
            </div>
            <ul className="space-y-1.5 p-3">
              {overflowLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex h-14 items-center gap-3 rounded-xl border px-3 ${
                      isNavHubPathActive(pathname, link.href, search)
                        ? "theme-accent-surface border text-accent-fg-soft"
                        : "border-zinc-800 bg-zinc-950/60 text-zinc-100"
                    }`}
                  >
                    <NavIcon id={link.icon} className="h-5 w-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">
                        {link.label}
                      </span>
                      <span className="glass-muted block text-xs">
                        {link.description}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {master ? (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      requestAdminTools({ section: "menu" });
                      setMoreOpen(false);
                    }}
                    className="flex h-14 w-full items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-950/30 px-3 text-left text-amber-100"
                  >
                    <NavIcon id="grid" className="h-5 w-5 shrink-0" />
                    <span>
                      <span className="block text-sm font-bold">Admin Tools</span>
                      <span className="block text-xs text-amber-200/70">
                        Bulk generate, rotation, store config
                      </span>
                    </span>
                  </button>
                </li>
              ) : null}
              {!linksIncludeHub ? (
                <li>
                  <Link
                    href="/"
                    onClick={() => setMoreOpen(false)}
                    className="flex h-14 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 text-zinc-100"
                  >
                    <NavIcon id="home" className="h-5 w-5 shrink-0" />
                    <span>
                      <span className="block text-sm font-bold">
                        Inventory Hub
                      </span>
                      <span className="glass-muted block text-xs">
                        Audits, catalog, remnants
                      </span>
                    </span>
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {showBottomNav && primaryLinks.length > 0 ? (
        <BottomNav
          pathname={pathname}
          search={search}
          primaryLinks={primaryLinks}
          hasOverflow={overflowLinks.length > 0 || master}
          overflowActive={isNavOverflowActive(pathname, links, search)}
          onOpenMore={() => setMoreOpen(true)}
        />
      ) : null}

      {master && specialist && adminHosted ? (
        <ChunkErrorBoundary
          label="Admin Tools"
          onReset={() => {
            setAdminHosted(false);
            window.setTimeout(() => {
              setAdminHosted(true);
              setAdminOpen(true);
            }, 0);
          }}
        >
          <AdminToolsDrawer
            open={adminOpen}
            onClose={() => {
              setAdminOpen(false);
              setAdminForce(false);
              setAdminSunday(false);
              setAdminNotes(false);
              if (typeof window !== "undefined" && window.location.hash) {
                history.replaceState(
                  null,
                  "",
                  `${window.location.pathname}${window.location.search}`
                );
              }
            }}
            specialist={specialist}
            storeNumber={storeNumber ?? ""}
            onStoreNumberChange={onStoreNumberChange}
            initialSection={adminSection}
            openForceRotationOnMount={adminForce}
            openSundayAuditOnMount={adminSunday}
            openManagerNotesOnMount={adminNotes}
          />
        </ChunkErrorBoundary>
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

function NavDrawerItem({
  link,
  active,
  onNavigate,
}: {
  link: NavHubLink;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={link.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`flex h-14 items-center gap-3 rounded-2xl border px-4 text-left backdrop-blur-sm transition ${
          active
            ? "theme-accent-surface border ring-1 ring-accent/30"
            : "border-zinc-800/80 bg-zinc-900/70 text-zinc-100"
        }`}
      >
        <NavIcon id={link.icon} className="h-5 w-5 shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-tight">
            {link.label}
          </span>
          <span className="glass-muted mt-0.5 block text-xs">
            {link.description}
          </span>
        </span>
      </Link>
    </li>
  );
}
