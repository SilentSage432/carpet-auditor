/**
 * Navigation Hub — owns cross-app route links by role.
 * Inventory section tabs stay in lib/rbac.ts; this module owns Store Ops / Zebra routes.
 * Primary bottom bar is the Floor / Map / Stock / Settings workflow.
 */

import {
  effectiveDepartment,
  isAssociate,
  isMasterAdmin,
} from "@/lib/rbac";
import { departmentMeta, type StoreSpecialist } from "@/lib/types";
import type { NavIconId } from "@/components/hub/NavIcons";

export type NavHubHref =
  | "/admin/store-map"
  | "/admin/supervisors"
  | "/admin/exceptions"
  | "/dashboard"
  | "/verify-rotation"
  | "/department"
  | "/manager-notes"
  | "/settings"
  | "/stock"
  | "/";

export type NavHubLink = {
  href: NavHubHref;
  label: string;
  shortLabel: string;
  icon: NavIconId;
  description: string;
  /** When true, route is available via More sheet / drawer, not the primary bottom bar. */
  overflow?: boolean;
};

/** Compact role chip for Zebra header / user menu, e.g. [SUPER ADMIN] or [FLR DEPT]. */
export function navRoleBadge(member: StoreSpecialist | null | undefined): string {
  if (!member) return "[LOCKED]";
  if (isMasterAdmin(member)) return "[SUPER ADMIN]";
  if (member.role === "Supervisor") {
    const dept = effectiveDepartment(member);
    const code = DEPT_BADGE_CODE[dept] ?? "DEPT";
    return `[${code} DEPT]`;
  }
  if (isAssociate(member)) {
    const dept = effectiveDepartment(member);
    const code = DEPT_BADGE_CODE[dept] ?? "DEPT";
    return `[${code} ASC]`;
  }
  return "[ASSOCIATE]";
}

const DEPT_BADGE_CODE: Record<string, string> = {
  flooring: "FLR",
  appliances: "APL",
  plumbing: "PLB",
  electrical: "ELC",
  lawn_garden: "L&G",
  inside_garden: "IGN",
  outside_garden: "OGN",
  paint: "PNT",
  millwork: "MLW",
  building_materials: "BLD",
  hardware: "HDW",
  tools: "TLS",
  all: "ALL",
};

/** Login identity shown in the user menu (username is the hub login key). */
export function navLoginIdentity(
  member: StoreSpecialist | null | undefined
): string {
  if (!member) return "Not signed in";
  return member.username?.trim() || member.name;
}

const FLOOR_LINK: NavHubLink = {
  href: "/dashboard",
  label: "Floor",
  shortLabel: "Floor",
  icon: "zebra",
  description: "Active bay cycle checklist and specialty audits",
};

const MAP_LINK: NavHubLink = {
  href: "/admin/store-map",
  label: "Store Map",
  shortLabel: "Map",
  icon: "map",
  description: "Visual heatmap and bay layout",
};

const STOCK_LINK: NavHubLink = {
  href: "/stock",
  label: "Downstock & Stock",
  shortLabel: "Stock",
  icon: "stock",
  description: "Downstock queue and remnant inventory",
};

const SETTINGS_LINK: NavHubLink = {
  href: "/settings",
  label: "Settings",
  shortLabel: "Settings",
  icon: "settings",
  description: "Themes, credentials, and Admin Tools",
};

export function navRoleLinks(
  member: StoreSpecialist | null | undefined
): NavHubLink[] {
  if (!member) return [];

  if (isMasterAdmin(member)) {
    return [
      FLOOR_LINK,
      MAP_LINK,
      STOCK_LINK,
      SETTINGS_LINK,
      {
        href: "/admin/supervisors",
        label: "Supervisor & Role Management",
        shortLabel: "Team",
        icon: "users",
        description: "Issue and manage department logins",
        overflow: true,
      },
      {
        href: "/admin/exceptions",
        label: "Exception Log",
        shortLabel: "Alerts",
        icon: "alert",
        description: "Weekly verification & bottlenecks",
        overflow: true,
      },
      {
        href: "/manager-notes",
        label: "Executive Floor Pad",
        shortLabel: "Notes",
        icon: "notes",
        description: "Rich-text floor notes + Gemini Copilot",
        overflow: true,
      },
    ];
  }

  if (member.role === "Supervisor") {
    const dept = departmentMeta(effectiveDepartment(member));
    return [
      FLOOR_LINK,
      MAP_LINK,
      STOCK_LINK,
      SETTINGS_LINK,
      {
        href: "/verify-rotation",
        label: "Verify & Report Exceptions",
        shortLabel: "Verify",
        icon: "shield",
        description: "End-of-week confirmation / incomplete bays",
        overflow: true,
      },
      {
        href: "/department",
        label: "Department Overview",
        shortLabel: dept.shortLabel,
        icon: "building",
        description: `${dept.label} ops overview + Hub link`,
        overflow: true,
      },
      {
        href: "/manager-notes",
        label: "Executive Floor Pad",
        shortLabel: "Notes",
        icon: "notes",
        description: "Rich-text floor notes + Gemini Copilot",
        overflow: true,
      },
    ];
  }

  return [
    FLOOR_LINK,
    MAP_LINK,
    STOCK_LINK,
    SETTINGS_LINK,
    {
      href: "/verify-rotation",
      label: "Barriers / Log",
      shortLabel: "Barriers",
      icon: "barrier",
      description: "Log barriers and review incomplete bays",
      overflow: true,
    },
    {
      href: "/",
      label: "Specialty Tools",
      shortLabel: "Tools",
      icon: "tools",
      description: "Flooring / appliance department auditors",
      overflow: true,
    },
  ];
}

/** Primary bottom-bar links (excludes overflow / More sheet routes). */
export function navPrimaryLinks(links: NavHubLink[]): NavHubLink[] {
  return links.filter((link) => !link.overflow);
}

/** Overflow routes shown under More. */
export function navOverflowLinks(links: NavHubLink[]): NavHubLink[] {
  return links.filter((link) => link.overflow);
}

function hubSectionParam(search: string | null | undefined): string | null {
  if (!search) return null;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(raw).get("section");
  return value?.trim() || null;
}

export function isNavHubPathActive(
  pathname: string,
  href: NavHubHref,
  search?: string | null
): boolean {
  const section = hubSectionParam(search);

  if (href === "/dashboard") {
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
      return true;
    }
    if (pathname === "/" || pathname === "") {
      return section !== "remnants" && section !== "settings";
    }
    return false;
  }

  if (href === "/stock") {
    if (pathname === "/stock" || pathname.startsWith("/stock/")) return true;
    if ((pathname === "/" || pathname === "") && section === "remnants") {
      return true;
    }
    return false;
  }

  if (href === "/settings") {
    if (pathname === "/settings" || pathname.startsWith("/settings/")) {
      return true;
    }
    if ((pathname === "/" || pathname === "") && section === "settings") {
      return true;
    }
    return false;
  }

  if (href === "/") return pathname === "/" || pathname === "";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when an overflow route is active (highlights More tab). */
export function isNavOverflowActive(
  pathname: string,
  links: NavHubLink[],
  search?: string | null
): boolean {
  return navOverflowLinks(links).some((link) =>
    isNavHubPathActive(pathname, link.href, search)
  );
}
