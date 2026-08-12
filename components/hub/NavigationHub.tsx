"use client";

/**
 * Navigation Hub chrome — high-contrast Zebra header with hamburger drawer,
 * role badge, and user menu. Owns cross-app route navigation presentation.
 * Master Admin: Admin Tools slide-over (defaults closed).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  ADMIN_TOOLS_EVENT,
  AdminToolsDrawer,
  type AdminToolsEventDetail,
  type AdminToolsSection,
} from "@/components/hub/AdminToolsDrawer";
import { AdminDepartmentSwitcher } from "@/components/hub/AdminDepartmentSwitcher";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import {
  adminWorkingDepartmentLabel,
  readAdminWorkingDepartment,
  ADMIN_DEPT_CONTEXT_EVENT,
} from "@/lib/admin-department-context";
import { useNetworkBadge } from "@/lib/network";
import {
  isNavHubPathActive,
  navLoginIdentity,
  navRoleBadge,
  navRoleLinks,
  type NavHubLink,
} from "@/lib/nav-hub";
import { isAssociate, isMasterAdmin } from "@/lib/rbac";
import { formatStoreLabel } from "@/lib/store";
import type { StoreSpecialist } from "@/lib/types";

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
  const router = useRouter();
  const network = useNetworkBadge(storeNumber);
  const links = navRoleLinks(specialist);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminSection, setAdminSection] =
    useState<AdminToolsSection>("menu");
  const [adminForce, setAdminForce] = useState(false);
  const [adminSunday, setAdminSunday] = useState(false);
  const [workingLabel, setWorkingLabel] = useState("Full Store");
  const userMenuId = useId();
  const drawerId = useId();
  const userRef = useRef<HTMLDivElement>(null);
  const master = isMasterAdmin(specialist);
  const associate = isAssociate(specialist);
  const linksIncludeHub = links.some((link) => link.href === "/");

  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
  }, [pathname]);

  useEffect(() => {
    function refreshWorking() {
      setWorkingLabel(adminWorkingDepartmentLabel(readAdminWorkingDepartment()));
    }
    refreshWorking();
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, refreshWorking);
    window.addEventListener("storage", refreshWorking);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, refreshWorking);
      window.removeEventListener("storage", refreshWorking);
    };
  }, []);

  useEffect(() => {
    function onAdminEvent(e: Event) {
      const detail = (e as CustomEvent<AdminToolsEventDetail>).detail ?? {};
      setAdminSection(detail.section ?? "menu");
      setAdminForce(Boolean(detail.openForceRotation));
      setAdminSunday(Boolean(detail.openSundayAudit));
      setAdminOpen(true);
    }
    window.addEventListener(ADMIN_TOOLS_EVENT, onAdminEvent);
    return () => window.removeEventListener(ADMIN_TOOLS_EVENT, onAdminEvent);
  }, []);

  useEffect(() => {
    if (!master || typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === "bulk-generate" || hash === "map-management") {
      setAdminSection("bulk");
      setAdminForce(false);
      setAdminSunday(false);
      setAdminOpen(true);
    } else if (hash === "weekly-rotation") {
      setAdminSection("menu");
      setAdminForce(true);
      setAdminSunday(false);
      setAdminOpen(true);
    } else if (hash === "sunday-audit" || hash === "sunday-rotation") {
      setAdminSection("menu");
      setAdminForce(false);
      setAdminSunday(true);
      setAdminOpen(true);
    } else if (hash === "admin-tools") {
      setAdminSection("menu");
      setAdminForce(false);
      setAdminSunday(false);
      setAdminOpen(true);
    }
  }, [master, pathname]);

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
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const roleBadge = navRoleBadge(specialist);
  const loginId = navLoginIdentity(specialist);

  return (
    <>
      <header className="glass-panel sticky top-0 z-40 border-b border-zinc-800/80 shadow-lg shadow-black/30">
        <div className="mx-auto flex min-h-[3.75rem] max-w-lg items-center gap-2 px-2 py-1.5 sm:px-3">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls={drawerId}
            aria-label="Open navigation menu"
            className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-700/80 bg-zinc-900/80 text-zinc-50 transition active:scale-95 focus-visible:border-emerald-500/50 focus-visible:ring-1 focus-visible:ring-emerald-500/30"
          >
            <span className="block h-0.5 w-6 rounded bg-current" />
            <span className="block h-0.5 w-6 rounded bg-current" />
            <span className="block h-0.5 w-6 rounded bg-current" />
          </button>

          <DeptSyncBadge size="sm" />

          {master && specialist ? (
            <button
              type="button"
              onClick={() => {
                setAdminSection("menu");
                setAdminForce(false);
                setAdminSunday(false);
                setAdminOpen(true);
              }}
              className="flex h-11 shrink-0 items-center rounded-xl border border-amber-400/50 bg-amber-950/40 px-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200 backdrop-blur-sm"
              aria-label="Open Admin Tools"
            >
              Admin
            </button>
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="glass-subtitle truncate text-emerald-400">
              DeptSync Hub
              {storeNumber ? ` · ${formatStoreLabel(storeNumber)}` : ""}
              {master ? ` · ${workingLabel}` : ""}
            </p>
            <h1 className="glass-title truncate text-base leading-tight">
              {title}
            </h1>
            {subtitle ? (
              <p className="glass-muted truncate text-[10px] font-semibold">
                {subtitle}
              </p>
            ) : (
              <p
                className={`mt-0.5 flex items-center gap-1.5 truncate text-[10px] font-semibold ${
                  network.tone === "online"
                    ? "text-emerald-400/90"
                    : "text-amber-300/90"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    network.tone === "online" ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                  aria-hidden
                />
                {network.tone === "online" ? "Online" : "Offline"}
                {network.pending > 0 ? ` · ${network.pending} queued` : ""}
              </p>
            )}
          </div>

          <div className="relative shrink-0" ref={userRef}>
            <button
              type="button"
              onClick={() => setUserOpen((o) => !o)}
              aria-expanded={userOpen}
              aria-controls={userMenuId}
              aria-label="User menu"
              className="flex min-h-14 max-w-[9.5rem] flex-col items-stretch justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-left backdrop-blur-sm transition active:scale-95 focus-visible:border-emerald-500/50 focus-visible:ring-1 focus-visible:ring-emerald-500/30"
            >
              <span className="font-mono text-[9px] font-bold leading-none tracking-wide text-amber-300">
                {roleBadge}
              </span>
              <span className="mt-1 truncate text-xs font-bold text-emerald-100">
                {specialist?.name ?? "Locked"}
              </span>
            </button>

            {userOpen ? (
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
                </div>
                <div className="p-2">
                  {master ? (
                    <MenuAction
                      label="Admin Tools"
                      onClick={() => {
                        setUserOpen(false);
                        setAdminSection("menu");
                        setAdminForce(false);
                        setAdminOpen(true);
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
                    className="flex min-h-12 items-center rounded-xl px-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800/60"
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
            ) : null}
          </div>
        </div>
        {master && specialist ? (
          <div className="mx-auto max-w-lg border-t border-zinc-800/60 px-2 py-2 sm:px-3">
            <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-amber-300/90">
              My Department Context
            </p>
            <AdminDepartmentSwitcher
              specialist={specialist}
              compact
              onPinnedNavigate={(section) => {
                if (pathname === "/" || pathname === "") {
                  router.push(`/?section=${section}`);
                } else if (section === "audit") {
                  router.push("/flooring");
                } else {
                  router.push(`/?section=${section}`);
                }
              }}
            />
          </div>
        ) : null}
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
          />
          <nav
            id={drawerId}
            aria-label="Navigation Hub"
            className="absolute inset-y-0 left-0 flex w-[min(100%,22rem)] flex-col border-r border-zinc-800/80 bg-zinc-950/95 backdrop-blur-xl shadow-2xl shadow-black/50"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-4">
              <div>
                <p className="glass-subtitle text-emerald-400">
                  Navigation Hub
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-amber-300">
                  {roleBadge}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-900/80 text-lg font-bold text-zinc-100 transition focus-visible:border-emerald-500/50 focus-visible:ring-1 focus-visible:ring-emerald-500/30"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto p-3">
              {master ? (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setAdminSection("menu");
                      setAdminForce(false);
                      setAdminOpen(true);
                    }}
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-950/30 px-4 text-left backdrop-blur-sm"
                  >
                    <span className="text-xl" aria-hidden>
                      ⚡
                    </span>
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
                  active={isNavHubPathActive(pathname, link.href)}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
              {!linksIncludeHub ? (
                <li>
                  <Link
                    href="/"
                    onClick={() => setMenuOpen(false)}
                    className="glass-card flex min-h-16 items-center gap-3 px-4 text-left"
                  >
                    <span className="text-xl" aria-hidden>
                      📊
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-zinc-100">
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
          </nav>
        </div>
      ) : null}

      {showBottomNav && links.length > 0 ? (
        <OpsBottomNav pathname={pathname} links={links} />
      ) : null}

      {master && specialist ? (
        <AdminToolsDrawer
          open={adminOpen}
          onClose={() => {
            setAdminOpen(false);
            setAdminForce(false);
            setAdminSunday(false);
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
      className={`flex min-h-12 w-full items-center rounded-xl px-3 text-left text-sm font-semibold ${
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
        className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 text-left backdrop-blur-sm transition ${
          active
            ? "border-emerald-500/50 bg-emerald-950/45 text-emerald-100 ring-1 ring-emerald-500/30"
            : "border-zinc-800/80 bg-zinc-900/70 text-zinc-100"
        }`}
      >
        <span className="text-xl" aria-hidden>
          {link.icon}
        </span>
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

function OpsBottomNav({
  pathname,
  links,
}: {
  pathname: string;
  links: NavHubLink[];
}) {
  const cols =
    links.length <= 3
      ? "grid-cols-3"
      : links.length === 4
        ? "grid-cols-4"
        : "grid-cols-5";

  return (
    <nav
      aria-label="Store Operations"
      className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-lg border-t border-zinc-800/80 bg-zinc-900/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md shadow-[0_-8px_32px_-12px_rgba(0,0,0,0.55)]"
    >
      <div className={`grid ${cols}`}>
        {links.map((link) => {
          const active = isNavHubPathActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1 px-1 pb-1.5 pt-2 ${
                active ? "text-emerald-300" : "text-zinc-400 active:text-zinc-200"
              }`}
            >
              {active ? (
                <span
                  className="absolute inset-x-4 top-0 h-1 rounded-full bg-emerald-400"
                  aria-hidden
                />
              ) : null}
              <span className="text-xl leading-none" aria-hidden>
                {link.icon}
              </span>
              <span className="max-w-full truncate text-center text-[10px] font-bold uppercase tracking-wide">
                {link.shortLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
