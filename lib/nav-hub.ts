/**
 * Navigation Hub — owns cross-app route links by role.
 * Inventory section tabs stay in lib/rbac.ts; this module owns Store Ops / Zebra routes.
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

export function navRoleLinks(
  member: StoreSpecialist | null | undefined
): NavHubLink[] {
  if (!member) return [];

  if (isMasterAdmin(member)) {
    return [
      {
        href: "/admin/store-map",
        label: "Store Map & Bulk Generator",
        shortLabel: "Map",
        icon: "map",
        description: "Map aisles and generate bay tags",
      },
      {
        href: "/admin/supervisors",
        label: "Supervisor & Role Management",
        shortLabel: "Team",
        icon: "users",
        description: "Issue and manage department logins",
      },
      {
        href: "/admin/exceptions",
        label: "Exception Log",
        shortLabel: "Alerts",
        icon: "alert",
        description: "Weekly verification & bottlenecks",
      },
      {
        href: "/dashboard",
        label: "Zebra Floor View",
        shortLabel: "Zebra",
        icon: "zebra",
        description: "This week’s assigned bay checklist",
      },
      {
        href: "/manager-notes",
        label: "Manager Notes & S Pen",
        shortLabel: "Notes",
        icon: "notes",
        description: "Floor notes + stylus canvas + AI action items",
        overflow: true,
      },
      {
        href: "/settings",
        label: "Settings & Config",
        shortLabel: "Settings",
        icon: "settings",
        description: "Store context, sync, and credentials",
        overflow: true,
      },
    ];
  }

  if (member.role === "Supervisor") {
    const dept = departmentMeta(effectiveDepartment(member));
    return [
      {
        href: "/dashboard",
        label: "My Department Zebra Checklist",
        shortLabel: "Zebra",
        icon: "zebra",
        description: "This week’s assigned rotation bays",
      },
      {
        href: "/verify-rotation",
        label: "Verify & Report Exceptions",
        shortLabel: "Verify",
        icon: "shield",
        description: "End-of-week confirmation / incomplete bays",
      },
      {
        href: "/department",
        label: "Department Overview",
        shortLabel: dept.shortLabel,
        icon: "building",
        description: `${dept.label} ops overview + Hub link`,
      },
      {
        href: "/manager-notes",
        label: "Manager Notes & S Pen",
        shortLabel: "Notes",
        icon: "notes",
        description: "Floor notes + stylus canvas + AI action items",
        overflow: true,
      },
      {
        href: "/settings",
        label: "Settings",
        shortLabel: "Settings",
        icon: "settings",
        description: "Profile, PIN, and sync",
        overflow: true,
      },
    ];
  }

  // Associates: floor checklist + barriers + specialty auditors + profile only
  return [
    {
      href: "/dashboard",
      label: "My Department Checklist",
      shortLabel: "Zebra",
      icon: "zebra",
      description: "This week’s assigned rotation bays",
    },
    {
      href: "/verify-rotation",
      label: "Barriers / Log",
      shortLabel: "Barriers",
      icon: "barrier",
      description: "Log barriers and review incomplete bays",
    },
    {
      href: "/",
      label: "Specialty Tools",
      shortLabel: "Tools",
      icon: "tools",
      description: "Flooring / appliance department auditors",
    },
    {
      href: "/settings",
      label: "My Profile / PIN",
      shortLabel: "Profile",
      icon: "lock",
      description: "Credentials and device sync",
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

export function isNavHubPathActive(
  pathname: string,
  href: NavHubHref
): boolean {
  if (href === "/") return pathname === "/" || pathname === "";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when an overflow route is active (highlights More tab). */
export function isNavOverflowActive(
  pathname: string,
  links: NavHubLink[]
): boolean {
  return navOverflowLinks(links).some((link) =>
    isNavHubPathActive(pathname, link.href)
  );
}
