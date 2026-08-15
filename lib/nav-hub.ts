/**
 * Navigation Hub — owns cross-app route links by role.
 * Inventory section tabs stay in lib/rbac.ts; this module owns Store Ops routes.
 * Primary bottom bar is the Floor / Map / Stock / Settings workflow.
 * Authenticated home is /dashboard (weekly checklist). Hub `/` with ?section=
 * is specialty scan tools only — never the Floor tab.
 */

import { workingDepartment } from "@/lib/admin-department-context";
import {
  defaultSectionForMember,
  effectiveDepartment,
  isAssociate,
  isMasterAdmin,
} from "@/lib/rbac";
import {
  departmentMeta,
  type HubSection,
  type StoreSpecialist,
} from "@/lib/types";
import type { NavIconId } from "@/components/hub/NavIcons";

export type SpecialtyHubHref =
  | "/?section=audit"
  | "/?section=appliances"
  | "/?section=department";

export type NavHubHref =
  | "/admin/store-map"
  | "/admin/supervisors"
  | "/admin/roles"
  | "/admin/exceptions"
  | "/dashboard"
  | "/verify-rotation"
  | "/department"
  | "/manager-notes"
  | "/settings"
  | "/stock"
  | "/"
  | SpecialtyHubHref;

export const SPECIALTY_HUB_SECTIONS = [
  "audit",
  "appliances",
  "department",
] as const;

export type SpecialtyHubSection = (typeof SPECIALTY_HUB_SECTIONS)[number];

export function isSpecialtyHubSection(
  section: string | null | undefined
): section is SpecialtyHubSection {
  return (
    section === "audit" ||
    section === "appliances" ||
    section === "department"
  );
}

export function isSpecialtyHubHref(href: string): boolean {
  return href === "/" || href.startsWith("/?section=");
}

/** Cycle / appliance / department scan workspace for this roster member. */
export function specialtyHubHref(
  member: StoreSpecialist | null | undefined
): SpecialtyHubHref {
  const section = defaultSectionForMember(member);
  if (section === "appliances") return "/?section=appliances";
  if (section === "department") return "/?section=department";
  return "/?section=audit";
}

/**
 * True when `/` should keep the specialty scan pane instead of replacing
 * to /dashboard. Remnants/settings query params still redirect to their routes.
 */
export function shouldStayOnSpecialtyHub(
  section: HubSection | string | null | undefined
): boolean {
  return isSpecialtyHubSection(section);
}

export const WORKFLOW_TAB_HREFS = [
  "/dashboard",
  "/admin/store-map",
  "/stock",
  "/settings",
] as const;

export type WorkflowTabHref = (typeof WORKFLOW_TAB_HREFS)[number];

export function workflowTabFromPathname(
  pathname: string
): WorkflowTabHref | null {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return "/dashboard";
  }
  if (
    pathname === "/admin/store-map" ||
    pathname.startsWith("/admin/store-map/")
  ) {
    return "/admin/store-map";
  }
  if (pathname === "/stock" || pathname.startsWith("/stock/")) {
    return "/stock";
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return "/settings";
  }
  return null;
}

export function prefetchWorkflowTab(href: string): void {
  if (href === "/dashboard") {
    void import("@/components/hub/tabs/FloorTab");
  } else if (href === "/admin/store-map") {
    void import("@/components/hub/tabs/MapTab");
  } else if (href === "/stock") {
    void import("@/components/hub/tabs/StockTab");
  } else if (href === "/settings") {
    void import("@/components/hub/tabs/SettingsTab");
  }
}

export function workflowTabTitle(
  href: WorkflowTabHref,
  specialist?: StoreSpecialist | null
): string {
  if (href === "/admin/store-map") return "Store Map";
  if (href === "/stock") return "Downstock & Stock";
  if (href === "/settings") return "Settings & Config";
  const working = specialist ? workingDepartment(specialist) : "flooring";
  const dept = departmentMeta(working === "all" ? "flooring" : working);
  return `${dept.shortLabel} Rotation`;
}

export type NavHubLink = {
  href: NavHubHref;
  label: string;
  shortLabel: string;
  icon: NavIconId;
  description: string;
  /** When true, route is available via More sheet / drawer, not the primary bottom bar. */
  overflow?: boolean;
};

/** Compact role chip — department lives in the header pill, so this is role only. */
export function navRoleBadge(member: StoreSpecialist | null | undefined): string {
  if (!member) return "Locked";
  if (isMasterAdmin(member)) return "Master Admin";
  if (member.role === "Supervisor") return "Supervisor";
  if (isAssociate(member)) return "Associate";
  return "Associate";
}

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
  description: "This week's bay checklist",
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
        description: "Issue logins and grant cross-department access",
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
        href: "/admin/roles",
        label: "Roles & Department Access",
        shortLabel: "Roles",
        icon: "users",
        description: "Grant associates cross-department Floor / Map / Stock access",
        overflow: true,
      },
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
      href: specialtyHubHref(member),
      label: "Scan & Audit",
      shortLabel: "Scan",
      icon: "tools",
      description: "Roll scan, appliances, and department audits",
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

  const [hrefPath, hrefQuery] = href.split("?");
  const hrefSection = hrefQuery
    ? new URLSearchParams(hrefQuery).get("section")
    : null;
  const path = hrefPath || "/";

  if (path === "/dashboard") {
    return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
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

  if (path === "/" || path === "") {
    if (pathname !== "/" && pathname !== "") return false;
    if (hrefSection && isSpecialtyHubSection(hrefSection)) {
      return isSpecialtyHubSection(section);
    }
    return !section || isSpecialtyHubSection(section);
  }

  return pathname === path || pathname.startsWith(`${path}/`);
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
