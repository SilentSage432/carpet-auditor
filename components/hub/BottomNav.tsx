"use client";

/**
 * Primary workflow bottom tabs — Floor · Map · Roster · More.
 * Floating pill chrome with hardware-accelerated sliding active indicator.
 * Route ownership: lib/nav-hub.ts.
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
  const count = Math.max(primaryLinks.length, 1);
  const cols =
    count <= 2
      ? "grid-cols-2"
      : count === 3
        ? "grid-cols-3"
        : "grid-cols-4";

  const activeIndex = Math.max(
    0,
    primaryLinks.findIndex((link) =>
      isNavHubPathActive(pathname, link.href, search)
    )
  );

  return (
    <nav
      aria-label="Primary workflow"
      className="hub-bottom-nav pointer-events-none pb-safe"
    >
      <div
        className={`hub-bottom-pill pointer-events-auto relative grid ${cols} items-center gap-0.5 rounded-full border border-zinc-700/70 bg-zinc-950/88 p-1 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.65)] backdrop-blur-xl`}
      >
        <span
          aria-hidden
          className="hub-nav-active-pill pointer-events-none absolute inset-y-1 left-1 z-0 rounded-full bg-accent/15 shadow-[0_0_16px_-2px_var(--glow-accent)]"
          style={{
            width: `calc((100% - 0.5rem - ${(count - 1) * 0.125}rem) / ${count})`,
            transform: `translate3d(calc(${activeIndex} * (100% + 0.125rem)), 0, 0)`,
          }}
        />
        {primaryLinks.map((link) => {
          const active = isNavHubPathActive(pathname, link.href, search);
          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch
              onPointerEnter={() => prefetchWorkflowTab(link.href)}
              onFocus={() => prefetchWorkflowTab(link.href)}
              aria-current={active ? "page" : undefined}
              aria-label={link.label}
              className={`relative z-10 flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-full px-2 transition-colors duration-200 ease-out active:scale-[0.96] ${
                active
                  ? "theme-nav-active"
                  : "text-muted active:text-foreground"
              }`}
            >
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
