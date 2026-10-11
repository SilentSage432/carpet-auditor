/**
 * Navigation Hub — Floor Command primary workflow.
 * RD-1 chrome: Overview · Map · This Week · Walkthroughs · More.
 * Inventory specialty tabs stay in lib/rbac.ts; this module owns Store Ops routes.
 * Authenticated operator home is /overview. Associates land on /dashboard (This Week).
 * Hub `/` with ?section= is specialty scan only (dormant REDUCE-004).
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
  | "/overview"
  | "/admin/store-map"
  | "/dashboard"
  | "/walkthroughs"
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
 * to the operator home. Remnants/settings query params still redirect to their routes.
 */
export function shouldStayOnSpecialtyHub(
  section: HubSection | string | null | undefined
): boolean {
  return isSpecialtyHubSection(section);
}

/** Primary keep-alive tabs (Roster remains a secondary More → Team route). */
export const PRIMARY_WORKFLOW_TAB_HREFS = [
  "/overview",
  "/admin/store-map",
  "/dashboard",
  "/walkthroughs",
  "/settings",
] as const;

export const WORKFLOW_TAB_HREFS = PRIMARY_WORKFLOW_TAB_HREFS;

export type WorkflowTabHref = (typeof WORKFLOW_TAB_HREFS)[number];

/** Secondary workflow routes that still mount inside the shell. */
export type SecondaryWorkflowHref = "/roster";

export type ShellWorkflowHref = WorkflowTabHref | SecondaryWorkflowHref;

/** Post-login / unauthorized-tab recovery home. */
export function homeHrefForSpecialist(
  member: StoreSpecialist | null | undefined
): WorkflowTabHref {
  if (!member) return "/overview";
  if (isSimplifiedAssociateView(member)) return "/dashboard";
  return "/overview";
}

export function workflowTabFromPathname(
  pathname: string
): ShellWorkflowHref | null {
  if (pathname === "/overview" || pathname.startsWith("/overview/")) {
    return "/overview";
  }
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return "/dashboard";
  }
  if (
    pathname === "/admin/store-map" ||
    pathname.startsWith("/admin/store-map/")
  ) {
    return "/admin/store-map";
  }
  if (
    pathname === "/walkthroughs" ||
    pathname.startsWith("/walkthroughs/")
  ) {
    return "/walkthroughs";
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
  if (href === "/overview") {
    void import("@/components/hub/tabs/OverviewTab");
  } else if (href === "/dashboard") {
    void import("@/components/hub/tabs/FloorTab");
  } else if (href === "/admin/store-map") {
    void import("@/components/hub/tabs/MapTab");
  } else if (href === "/walkthroughs") {
    void import("@/components/hub/tabs/WalkthroughsTab");
  } else if (href === "/roster") {
    void import("@/components/hub/tabs/RosterTab");
  } else if (href === "/settings") {
    void import("@/components/hub/tabs/SettingsTab");
  }
}

export function workflowTabTitle(
  href: ShellWorkflowHref,
  specialist?: StoreSpecialist | null,
  working?: ReturnType<typeof workingDepartment>
): string {
  if (href === "/overview") return "Overview";
  if (href === "/admin/store-map") return "Map";
  if (href === "/walkthroughs") return "Walkthroughs";
  if (href === "/roster") return "Team";
  if (href === "/settings") return "More";
  if (href === "/dashboard") {
    if (specialist && isSimplifiedAssociateView(specialist)) {
      return "My Shift";
    }
    return "This Week";
  }
  const scope =
    working ?? (specialist ? workingDepartment(specialist) : "all");
  if (scope === "all") return "This Week";
  return `${departmentMeta(scope).shortLabel} · This Week`;
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
    href: "/overview",
    label: "Overview",
    shortLabel: "Overview",
    icon: "home",
    description: "Week status and what needs attention",
  },
  {
    href: "/admin/store-map",
    label: "Map",
    shortLabel: "Map",
    icon: "map",
    description: "Aisles and physical bays",
  },
  {
    href: "/dashboard",
    label: "This Week",
    shortLabel: "Week",
    icon: "calendar",
    description: "Weekly plan, ownership, and verification",
  },
  {
    href: "/walkthroughs",
    label: "Walkthroughs",
    shortLabel: "Walk",
    icon: "notes",
    description: "Collaborative floor conversations and follow-ups",
  },
  {
    href: "/settings",
    label: "More",
    shortLabel: "More",
    icon: "more",
    description: "Team, topology, configuration, and device",
  },
];

/** Primary bottom-bar links — Overview · Map · This Week · Walkthroughs · More. */
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
  if (href === "/roster") {
    if (!member) return false;
    return !isSimplifiedAssociateView(member);
  }
  return navRoleLinks(member).some((link) => link.href === href);
}

export function navPrimaryLinks(links: NavHubLink[]): NavHubLink[] {
  return links;
}

/** Hide working-department pin on geography / shell surfaces that are aisle-first. */
export function showHeaderDepartmentSwitcher(pathname: string): boolean {
  if (pathname === "/admin/store-map" || pathname.startsWith("/admin/store-map/")) {
    return false;
  }
  if (pathname === "/overview" || pathname.startsWith("/overview/")) {
    return false;
  }
  if (pathname === "/walkthroughs" || pathname.startsWith("/walkthroughs/")) {
    return false;
  }
  return true;
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

  if (path === "/overview") {
    return pathname === "/overview" || pathname.startsWith("/overview/");
  }

  if (path === "/dashboard") {
    return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  }

  if (path === "/walkthroughs") {
    return (
      pathname === "/walkthroughs" || pathname.startsWith("/walkthroughs/")
    );
  }

  if (href === "/roster") {
    return pathname === "/roster" || pathname.startsWith("/roster/");
  }

  if (href === "/settings") {
    if (pathname === "/settings" || pathname.startsWith("/settings/")) {
      return true;
    }
    // Team lives under More during RD-1 transition.
    if (pathname === "/roster" || pathname.startsWith("/roster/")) {
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
  "team",
] as const;

export function isSettingsToolHash(hash: string): boolean {
  return (SETTINGS_TOOL_HASHES as readonly string[]).includes(hash);
}
