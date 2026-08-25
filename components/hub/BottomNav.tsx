"use client";

/**
 * Primary workflow bottom tabs — Floor · Map · Roster · More.
 * Floating pill chrome; route ownership: lib/nav-hub.ts.
 */

import Link from "next/link";
import { NavIcon } from "@/components/hub/NavIcons";
import {
  isNavHubPathActive,
  prefetchWorkflowTab,
  type NavHubLink,
} from "@/lib/nav-hub";

type BottomNavProps = {
  pathname: string;
  search?: string | null;
  primaryLinks: NavHubLink[];
};

export function BottomNav({
  pathname,
  search,
  primaryLinks,
}: BottomNavProps) {
  const cols =
    primaryLinks.length <= 2
      ? "grid-cols-2"
      : primaryLinks.length === 3
        ? "grid-cols-3"
        : "grid-cols-4";

  return (
    <nav
      aria-label="Primary workflow"
      className="hub-bottom-nav pointer-events-none pb-safe"
    >
      <div
        className={`hub-bottom-pill pointer-events-auto grid ${cols} items-center gap-0.5 rounded-full border border-zinc-700/70 bg-zinc-950/88 p-1 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.65)] backdrop-blur-xl`}
      >
        {primaryLinks.map((link) => {
          const active = isNavHubPathActive(pathname, link.href, search);
          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch
              onPointerEnter={() => prefetchWorkflowTab(link.href)}
              aria-current={active ? "page" : undefined}
              aria-label={link.label}
              className={`relative flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-full px-2 transition active:scale-[0.96] ${
                active
                  ? "theme-nav-active bg-accent/10 shadow-[0_0_16px_-2px_var(--glow-accent)]"
                  : "text-muted active:text-foreground"
              }`}
            >
              {active ? (
                <span
                  className="theme-nav-indicator absolute inset-x-3 bottom-1 h-0.5 rounded-full"
                  aria-hidden
                />
              ) : null}
              <NavIcon id={link.icon} className="h-5 w-5" />
              <span className="max-w-full truncate text-center text-[9px] font-bold uppercase tracking-wide">
                {link.shortLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
