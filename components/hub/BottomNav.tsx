"use client";

/**
 * Primary workflow bottom tabs — Floor · Map · Roster · Settings.
 * Route ownership: lib/nav-hub.ts. Overflow routes live in the More sheet.
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
  hasOverflow: boolean;
  overflowActive: boolean;
  onOpenMore: () => void;
};

export function BottomNav({
  pathname,
  search,
  primaryLinks,
  hasOverflow,
  overflowActive,
  onOpenMore,
}: BottomNavProps) {
  const tabCount = primaryLinks.length + (hasOverflow ? 1 : 0);
  const cols =
    tabCount <= 3
      ? "grid-cols-3"
      : tabCount === 4
        ? "grid-cols-4"
        : "grid-cols-5";

  return (
    <nav
      aria-label="Primary workflow"
      className="theme-bottom-nav fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-lg pb-safe backdrop-blur-md"
    >
      <div className={`grid ${cols}`}>
        {primaryLinks.map((link) => {
          const active = isNavHubPathActive(pathname, link.href, search);
          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch
              onPointerEnter={() => prefetchWorkflowTab(link.href)}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 pt-1 ${
                active
                  ? "theme-nav-active"
                  : "text-muted active:text-foreground"
              }`}
            >
              {active ? (
                <span
                  className="theme-nav-indicator absolute inset-x-4 top-0 h-0.5 rounded-full"
                  aria-hidden
                />
              ) : null}
              <NavIcon id={link.icon} className="h-5 w-5" />
              <span className="max-w-full truncate text-center text-[10px] font-bold uppercase tracking-wide">
                {link.shortLabel}
              </span>
            </Link>
          );
        })}
        {hasOverflow ? (
          <button
            type="button"
            onClick={onOpenMore}
            aria-label="More"
            className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 pt-1 ${
              overflowActive
                ? "theme-nav-active"
                : "text-muted active:text-foreground"
            }`}
          >
            {overflowActive ? (
              <span
                className="theme-nav-indicator absolute inset-x-4 top-0 h-0.5 rounded-full"
                aria-hidden
              />
            ) : null}
            <NavIcon id="more" className="h-5 w-5" />
            <span className="max-w-full truncate text-center text-[10px] font-bold uppercase tracking-wide">
              More
            </span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}
