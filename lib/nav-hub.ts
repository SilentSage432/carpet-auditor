/**
 * Navigation Hub — owns the Floor / Map / Roster / Settings workflow.
 * Inventory section tabs stay in lib/rbac.ts; this module owns Store Ops routes.
 * Authenticated home is /dashboard. Hub `/` with ?section= is specialty scan only.
 */

import { workingDepartment } from "@/lib/admin-department-context";
import {
  defaultSectionForMember,
  isMasterAdmin,
  isSimplifiedAssociateView,
} from "@/lib/rbac";
import {
  departmentMeta,
  rosterFloorBadgeLabel,
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
  | "/dashboard"
  | "/roster"
  | "/settings"
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

export const PRIMARY_WORKFLOW_TAB_HREFS = [
  "/dashboard",
  "/admin/store-map",
  "/roster",
  "/settings",
] as const;

export const WORKFLOW_TAB_HREFS = PRIMARY_WORKFLOW_TAB_HREFS;

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
  if (pathname === "/roster" || pathname.startsWith("/roster/")) {
    return "/roster";
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
  } else if (href === "/roster") {
    void import("@/components/hub/tabs/RosterTab");
  } else if (href === "/settings") {
    void import("@/components/hub/tabs/SettingsTab");
  }
}

export function workflowTabTitle(
  href: WorkflowTabHref,
  specialist?: StoreSpecialist | null,
  working?: ReturnType<typeof workingDepartment>
): string {
  if (href === "/admin/store-map") return "Store Map";
  if (href === "/roster") return "Team Roster";
  if (href === "/settings") return "Settings & Config";
  const scope =
    working ?? (specialist ? workingDepartment(specialist) : "all");
  if (scope === "all") return "Floor Rotation";
  return `${departmentMeta(scope).shortLabel} Rotation`;
}

export type NavHubLink = {
  href: NavHubHref;
  label: string;
  shortLabel: string;
  icon: NavIconId;
  description: string;
};

/** Compact role chip — department lives in the header pill, so this is role only. */
export function navRoleBadge(member: StoreSpecialist | null | undefined): string {
  if (!member) return "Locked";
  if (isMasterAdmin(member)) return "Master Admin";
  if (member.role === "Supervisor") return "DS Supervisor";
  return rosterFloorBadgeLabel(member);
}

/** Login identity shown in the user menu (username is the hub login key). */
export function navLoginIdentity(
  member: StoreSpecialist | null | undefined
): string {
  if (!member) return "Not signed in";
  return member.username?.trim() || member.name;
}

const PRIMARY_LINKS: NavHubLink[] = [
  {
    href: "/dashboard",
    label: "Floor",
    shortLabel: "Floor",
    icon: "zebra",
    description: "This week's bay checklist",
  },
  {
    href: "/admin/store-map",
    label: "Store Map",
    shortLabel: "Map",
    icon: "map",
    description: "Visual heatmap and bay layout",
  },
  {
    href: "/roster",
    label: "Team Roster",
    shortLabel: "Roster",
    icon: "users",
    description: "Team, PINs, and department access",
  },
  {
    href: "/settings",
    label: "Settings",
    shortLabel: "Settings",
    icon: "settings",
    description: "Themes, store config, and floor tools",
  },
];

/** Primary bottom-bar links — Floor · Map · Roster · Settings, filtered by role. */
export function navRoleLinks(
  member: StoreSpecialist | null | undefined
): NavHubLink[] {
  if (!member) return [];
  if (isSimplifiedAssociateView(member)) {
    return PRIMARY_LINKS.filter(
      (link) => link.href === "/dashboard" || link.href === "/admin/store-map"
    ).map((link) =>
      link.href === "/dashboard"
        ? {
            ...link,
            label: "My Shift",
            shortLabel: "My Shift",
            description: "Your assigned bays and shift goals",
          }
        : link
    );
  }
  return PRIMARY_LINKS;
}

export function canAccessWorkflowTab(
  member: StoreSpecialist | null | undefined,
  href: string
): boolean {
  return navRoleLinks(member).some((link) => link.href === href);
}

export function navPrimaryLinks(links: NavHubLink[]): NavHubLink[] {
  return links;
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

  if (href === "/roster") {
    return pathname === "/roster" || pathname.startsWith("/roster/");
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

/** Settings hash targets for tools that used to live in Admin Tools. */
export const SETTINGS_TOOL_HASHES = [
  "bulk-generate",
  "map-management",
  "topology",
  "bay-setup",
  "weekly-rotation",
  "manager-notes",
  "s-pen-notes",
  "floor-pad",
  "admin-tools",
  "sunday-schedule",
  "taxonomies",
  "remnants",
  "remnants-calculator",
] as const;

export function isSettingsToolHash(hash: string): boolean {
  return (SETTINGS_TOOL_HASHES as readonly string[]).includes(hash);
}
