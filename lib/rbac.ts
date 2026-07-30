/**
 * Department-scoped RBAC — owns which hub sections and catalog domains
 * a profile may access. Presentation consumes; specialists ownership stays
 * in lib/specialists.ts.
 */

import {
  HUB_SECTIONS,
  type DepartmentScope,
  type HubSection,
  type StoreSpecialist,
} from "./types";

export type NavTab = {
  id: HubSection;
  label: string;
  icon: string;
};

const ALL_TABS: NavTab[] = [
  { id: "audit", label: "Flooring", icon: "📊" },
  { id: "appliances", label: "Appliances", icon: "🔌" },
  { id: "catalog", label: "Catalog", icon: "🏷️" },
  { id: "remnants", label: "Remnants", icon: "📦" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

/** Resolve effective department for navigation / catalog scoping. */
export function effectiveDepartment(
  member: StoreSpecialist | null | undefined
): DepartmentScope {
  if (!member) return "flooring";
  if (member.role === "MasterAdmin") return "all";
  const dept = member.assigned_department;
  if (dept === "appliances" || dept === "flooring" || dept === "all") {
    return dept;
  }
  // Named appliance supervisors without an explicit column still scope correctly
  if (
    member.role === "Supervisor" &&
    /appliance/i.test(member.name + " " + (member.username ?? ""))
  ) {
    return "appliances";
  }
  if (member.role === "Supervisor") return "flooring";
  return dept ?? "flooring";
}

export function isMasterAdmin(
  member: StoreSpecialist | null | undefined
): boolean {
  return member?.role === "MasterAdmin";
}

/** Elevated roles that manage PINs / markdown / filters. */
export function hasElevatedAccess(
  member: StoreSpecialist | null | undefined
): boolean {
  return member?.role === "MasterAdmin" || member?.role === "Supervisor";
}

export function canAccessSection(
  member: StoreSpecialist | null | undefined,
  section: HubSection
): boolean {
  return visibleSections(member).includes(section);
}

/** Sections visible for the active profile (Master Admin → all five). */
export function visibleSections(
  member: StoreSpecialist | null | undefined
): HubSection[] {
  if (isMasterAdmin(member)) {
    return ["audit", "appliances", "catalog", "remnants", "settings"];
  }

  const dept = effectiveDepartment(member);

  if (dept === "appliances") {
    return ["appliances", "catalog", "settings"];
  }

  if (dept === "all") {
    return ["audit", "appliances", "catalog", "remnants", "settings"];
  }

  // Flooring supervisor / flooring associates
  return ["audit", "catalog", "remnants", "settings"];
}

/** Bottom-nav tabs filtered + labeled for the active role/department. */
export function visibleNavTabs(
  member: StoreSpecialist | null | undefined
): NavTab[] {
  const allowed = new Set(visibleSections(member));
  const dept = effectiveDepartment(member);

  return ALL_TABS.filter((tab) => allowed.has(tab.id)).map((tab) => {
    if (tab.id === "catalog" && dept === "appliances") {
      return { ...tab, label: "Appliance Catalog" };
    }
    if (tab.id === "catalog" && isMasterAdmin(member)) {
      return { ...tab, label: "Catalog" };
    }
    if (tab.id === "settings" && isMasterAdmin(member)) {
      return { ...tab, label: "Master" };
    }
    if (tab.id === "settings" && !isMasterAdmin(member)) {
      return { ...tab, label: "Profile" };
    }
    return tab;
  });
}

export function defaultSectionForMember(
  member: StoreSpecialist | null | undefined
): HubSection {
  const sections = visibleSections(member);
  if (sections.includes("appliances") && effectiveDepartment(member) === "appliances") {
    return "appliances";
  }
  if (sections.includes("audit")) return "audit";
  return sections[0] ?? "settings";
}

export function sectionTitle(
  section: HubSection,
  member: StoreSpecialist | null | undefined
): string {
  const dept = effectiveDepartment(member);
  if (section === "catalog" && dept === "appliances") {
    return "Appliance Catalog";
  }
  if (section === "catalog" && isMasterAdmin(member)) {
    return "Universal Catalog";
  }
  if (section === "settings" && isMasterAdmin(member)) {
    return "Master Settings";
  }
  if (section === "settings") {
    return "Profile & Settings";
  }
  if (section === "audit") {
    return "Flooring Audit";
  }
  if (section === "appliances") {
    return "Appliances Audit";
  }
  return HUB_SECTIONS.find((s) => s.id === section)?.title ?? "DeptSync Hub";
}

/** Catalog presentation domain for department supervisors. */
export type CatalogDomainFilter = "all" | "flooring" | "appliances";

export function catalogDomainForMember(
  member: StoreSpecialist | null | undefined
): CatalogDomainFilter {
  if (isMasterAdmin(member)) return "all";
  const dept = effectiveDepartment(member);
  if (dept === "appliances") return "appliances";
  if (dept === "all") return "all";
  return "flooring";
}

export function canManageStoreNumber(
  member: StoreSpecialist | null | undefined
): boolean {
  return isMasterAdmin(member);
}

export function canPrePopulateAnyDepartment(
  member: StoreSpecialist | null | undefined
): boolean {
  return isMasterAdmin(member);
}
