"use client";

/**
 * Navigation Hub chrome — high-contrast Zebra header with hamburger drawer,
 * role badge, and user menu. Owns cross-app route navigation presentation.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import { useNetworkBadge } from "@/lib/network";
import {
  isNavHubPathActive,
  navLoginIdentity,
  navRoleBadge,
  navRoleLinks,
  type NavHubLink,
} from "@/lib/nav-hub";
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
  showBottomNav = true,
}: NavigationHubProps) {
  const pathname = usePathname() || "/";
  const network = useNetworkBadge();
  const links = navRoleLinks(specialist);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userMenuId = useId();
  const drawerId = useId();
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
  }, [pathname]);

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
      <header className="sticky top-0 z-40 border-b-2 border-emerald-500/40 bg-slate-950">
        <div className="mx-auto flex min-h-[3.75rem] max-w-lg items-center gap-2 px-2 py-1.5 sm:px-3">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls={drawerId}
            aria-label="Open navigation menu"
            className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-slate-100/90 bg-slate-900 text-slate-50 transition active:scale-95"
          >
            <span className="block h-0.5 w-6 rounded bg-current" />
            <span className="block h-0.5 w-6 rounded bg-current" />
            <span className="block h-0.5 w-6 rounded bg-current" />
          </button>

          <DeptSyncBadge size="sm" />

          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">
              DeptSync Hub
              {storeNumber ? ` · ${formatStoreLabel(storeNumber)}` : ""}
            </p>
            <h1 className="truncate text-base font-bold leading-tight text-slate-50">
              {title}
            </h1>
            {subtitle ? (
              <p className="truncate text-[10px] font-semibold text-slate-400">
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
              className="flex min-h-14 max-w-[9.5rem] flex-col items-stretch justify-center rounded-xl border-2 border-emerald-400/50 bg-emerald-950/50 px-2.5 py-1 text-left transition active:scale-95"
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
                className="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-64 overflow-hidden rounded-2xl border-2 border-slate-600 bg-slate-950 shadow-xl"
              >
                <div className="border-b border-slate-800 bg-slate-900 px-4 py-3">
                  <p className="font-mono text-[10px] font-bold tracking-wide text-amber-300">
                    {roleBadge}
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-50">
                    {specialist?.name ?? "Locked"}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-xs text-slate-400">
                    {loginId}
                  </p>
                </div>
                <div className="p-2">
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
                    href="/"
                    role="menuitem"
                    className="flex min-h-12 items-center rounded-xl px-3 text-sm font-semibold text-slate-200 hover:bg-slate-900"
                    onClick={() => setUserOpen(false)}
                  >
                    Inventory Hub
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
            className="absolute inset-y-0 left-0 flex w-[min(100%,22rem)] flex-col border-r-2 border-emerald-500/40 bg-slate-950"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                  Navigation Hub
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-amber-300">
                  {roleBadge}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-slate-600 text-lg font-bold text-slate-100"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto p-3">
              {links.map((link) => (
                <NavDrawerItem
                  key={link.href}
                  link={link}
                  active={isNavHubPathActive(pathname, link.href)}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
              <li>
                <Link
                  href="/"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-16 items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 text-left"
                >
                  <span className="text-xl" aria-hidden>
                    📊
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-slate-100">
                      Inventory Hub
                    </span>
                    <span className="block text-xs text-slate-400">
                      Audits, catalog, remnants
                    </span>
                  </span>
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      ) : null}

      {showBottomNav && links.length > 0 ? (
        <OpsBottomNav pathname={pathname} links={links} />
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
          ? "text-red-300 hover:bg-red-950/50"
          : "text-slate-200 hover:bg-slate-900"
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
        className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 text-left transition ${
          active
            ? "border-emerald-400 bg-emerald-950/50 text-emerald-100"
            : "border-slate-700 bg-slate-900/80 text-slate-100"
        }`}
      >
        <span className="text-xl" aria-hidden>
          {link.icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-tight">
            {link.label}
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">
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
      className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-lg border-t-2 border-emerald-500/30 bg-slate-950 pb-[env(safe-area-inset-bottom)]"
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
                active ? "text-emerald-300" : "text-slate-400 active:text-slate-200"
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
