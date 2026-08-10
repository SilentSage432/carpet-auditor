/**
 * Department-scoped RBAC — owns which hub sections and catalog domains
 * a profile may access. Presentation consumes; specialists ownership stays
 * in lib/specialists.ts.
 */

import {
  DEPARTMENT_META,
  isDepartmentScope,
  type DepartmentScope,
  type HubSection,
  type OperationalDepartment,
  type StoreSpecialist,
  HUB_SECTIONS,
} from "./types";

export type NavTab = {
  id: HubSection;
  label: string;
  icon: string;
};

const ALL_TABS: NavTab[] = [
  { id: "audit", label: "Flooring", icon: "📊" },
  { id: "appliances", label: "Appliances", icon: "🔌" },
  { id: "department", label: "Dept Audit", icon: "🏬" },
  { id: "catalog", label: "Catalog", icon: "🏷️" },
  { id: "remnants", label: "Remnants", icon: "📦" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

/** True for departments that use the generic unit-count department workspace. */
export function isGenericDepartment(
  dept: DepartmentScope | null | undefined
): dept is OperationalDepartment {
  return (
    !!dept &&
    dept !== "all" &&
    dept !== "flooring" &&
    dept !== "appliances"
  );
}

/** Resolve effective department for navigation / catalog scoping. */
export function effectiveDepartment(
  member: StoreSpecialist | null | undefined
): DepartmentScope {
  if (!member) return "flooring";
  if (member.role === "MasterAdmin") return "all";
  const dept = member.assigned_department;
  if (dept && isDepartmentScope(dept)) return dept;
  // Named appliance supervisors without an explicit column still scope correctly
  if (
    member.role === "Supervisor" &&
    /appliance/i.test(member.name + " " + (member.username ?? ""))
  ) {
    return "appliances";
  }
  if (member.role === "Supervisor") return "flooring";
  return "flooring";
}

export function isMasterAdmin(
  member: StoreSpecialist | null | undefined
): boolean {
  return member?.role === "MasterAdmin";
}

export function isAssociate(
  member: StoreSpecialist | null | undefined
): boolean {
  return member?.role === "Associate";
}

/** Elevated roles that manage PINs / markdown / filters. */
export function hasElevatedAccess(
  member: StoreSpecialist | null | undefined
): boolean {
  return member?.role === "MasterAdmin" || member?.role === "Supervisor";
}

/** Admin Tools drawer + `/admin/*` chrome — Master Admin only. */
export function canAccessAdminTools(
  member: StoreSpecialist | null | undefined
): boolean {
  return isMasterAdmin(member);
}

export function canAccessSection(
  member: StoreSpecialist | null | undefined,
  section: HubSection
): boolean {
  return visibleSections(member).includes(section);
}

/** Sections visible for the active profile (Master Admin → full store). */
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

  if (dept === "flooring") {
    return ["audit", "catalog", "remnants", "settings"];
  }

  if (dept === "all") {
    return ["audit", "appliances", "catalog", "remnants", "settings"];
  }

  // Plumbing, electrical, lawn_garden, paint, millwork, building_materials, hardware
  return ["department", "catalog", "settings"];
}

/** Bottom-nav tabs filtered + labeled for the active role/department. */
export function visibleNavTabs(
  member: StoreSpecialist | null | undefined
): NavTab[] {
  const allowed = new Set(visibleSections(member));
  const dept = effectiveDepartment(member);
  const meta = DEPARTMENT_META[dept];

  return ALL_TABS.filter((tab) => allowed.has(tab.id)).map((tab) => {
    if (tab.id === "department" && isGenericDepartment(dept)) {
      return {
        ...tab,
        label: meta.shortLabel,
        icon: meta.icon,
      };
    }
    if (tab.id === "catalog" && dept === "appliances") {
      return { ...tab, label: "Appliance Catalog" };
    }
    if (tab.id === "catalog" && isGenericDepartment(dept)) {
      return { ...tab, label: `${meta.shortLabel} Catalog` };
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
  const dept = effectiveDepartment(member);
  if (dept === "appliances" && sections.includes("appliances")) {
    return "appliances";
  }
  if (isGenericDepartment(dept) && sections.includes("department")) {
    return "department";
  }
  if (sections.includes("audit")) return "audit";
  return sections[0] ?? "settings";
}

export function sectionTitle(
  section: HubSection,
  member: StoreSpecialist | null | undefined
): string {
  const dept = effectiveDepartment(member);
  const meta = DEPARTMENT_META[dept];

  if (section === "department" && isGenericDepartment(dept)) {
    return `${meta.label} Audit`;
  }
  if (section === "catalog" && dept === "appliances") {
    return "Appliance Catalog";
  }
  if (section === "catalog" && isGenericDepartment(dept)) {
    return `${meta.label} Catalog`;
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
export type CatalogDomainFilter = "all" | OperationalDepartment;

export function catalogDomainForMember(
  member: StoreSpecialist | null | undefined
): CatalogDomainFilter {
  if (isMasterAdmin(member)) return "all";
  const dept = effectiveDepartment(member);
  if (dept === "all") return "all";
  if (dept === "appliances") return "appliances";
  if (dept === "flooring") return "flooring";
  // Generic depts browse/build against the full catalog until dept categories exist
  return "all";
}

export function canManageStoreNumber(
  member: StoreSpecialist | null | undefined
): boolean {
  return isMasterAdmin(member);
}

export function canManageTeamRoster(
  member: StoreSpecialist | null | undefined
): boolean {
  return isMasterAdmin(member);
}

export function canPrePopulateAnyDepartment(
  member: StoreSpecialist | null | undefined
): boolean {
  return isMasterAdmin(member);
}

/** Suggest login username from display name + department. */
export function suggestUsername(
  name: string,
  department: DepartmentScope
): string {
  const first = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)[0];
  const base = first || "user";
  if (department === "all") return `${base}_admin`;
  return `${base}_${department}`;
}
