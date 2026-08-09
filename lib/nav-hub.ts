/**
 * Navigation Hub — owns cross-app route links by role.
 * Inventory section tabs stay in lib/rbac.ts; this module owns Store Ops / Zebra routes.
 */

import {
  effectiveDepartment,
  isMasterAdmin,
} from "@/lib/rbac";
import { departmentMeta, type StoreSpecialist } from "@/lib/types";

export type NavHubHref =
  | "/admin/store-map"
  | "/admin/supervisors"
  | "/admin/exceptions"
  | "/dashboard"
  | "/verify-rotation"
  | "/department"
  | "/settings"
  | "/";

export type NavHubLink = {
  href: NavHubHref;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
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
        shortLabel: "Store Map",
        icon: "🗺️",
        description: "Map aisles and generate bay tags",
      },
      {
        href: "/admin/supervisors",
        label: "Supervisor & Role Management",
        shortLabel: "Supervisors",
        icon: "👥",
        description: "Issue and manage department logins",
      },
      {
        href: "/admin/exceptions",
        label: "Exception Log",
        shortLabel: "Exceptions",
        icon: "⚠️",
        description: "Weekly verification & bottlenecks",
      },
      {
        href: "/dashboard",
        label: "Zebra Floor View",
        shortLabel: "Zebra",
        icon: "📱",
        description: "This week’s assigned bay checklist",
      },
      {
        href: "/settings",
        label: "Settings & Config",
        shortLabel: "Settings",
        icon: "⚙️",
        description: "Store context, sync, and credentials",
      },
    ];
  }

  if (member.role === "Supervisor") {
    const dept = departmentMeta(effectiveDepartment(member));
    return [
      {
        href: "/dashboard",
        label: "My Department Zebra Checklist",
        shortLabel: "Checklist",
        icon: "📱",
        description: "This week’s assigned rotation bays",
      },
      {
        href: "/verify-rotation",
        label: "Verify & Report Exceptions",
        shortLabel: "Verify",
        icon: "✅",
        description: "End-of-week confirmation / incomplete bays",
      },
      {
        href: "/department",
        label: "Department Overview",
        shortLabel: dept.shortLabel,
        icon: dept.icon,
        description: `${dept.label} audit workspace`,
      },
      {
        href: "/settings",
        label: "Settings",
        shortLabel: "Settings",
        icon: "⚙️",
        description: "Profile, PIN, and sync",
      },
    ];
  }

  // Associates: settings + inventory hub only
  return [
    {
      href: "/",
      label: "Inventory Hub",
      shortLabel: "Hub",
      icon: "📊",
      description: "Department audit workspace",
    },
    {
      href: "/settings",
      label: "Settings",
      shortLabel: "Settings",
      icon: "⚙️",
      description: "Profile and sync",
    },
  ];
}

export function isNavHubPathActive(
  pathname: string,
  href: NavHubHref
): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
