/**
 * Roster department grouping — composition owner.
 * Groups fetched members by normalized home department
 * (`appliances` / `D35` / `D35 · Appliances` → same accordion).
 * Presentation renders accordions; this module does not persist.
 */

import {
  STORE_DEPARTMENTS,
  departmentRosterHeading,
  rosterFloorBadgeLabel,
  specialistHomeDepartment,
  type DepartmentScope,
  type StoreSpecialist,
} from "@/lib/types";

export type RosterDepartmentGroup = {
  home: DepartmentScope;
  heading: string;
  members: StoreSpecialist[];
  onDuty: number;
};

function roleRank(member: StoreSpecialist): number {
  if (member.role === "MasterAdmin") return 0;
  if (member.role === "Supervisor") return 1;
  const title = rosterFloorBadgeLabel(member);
  if (title === "Specialist") return 2;
  if (title === "CSA") return 3;
  if (title === "Cashier") return 4;
  if (title === "Receiving") return 5;
  return 6;
}

/**
 * One collapsible group for every home department that has at least one member.
 * Known Lowe's scopes sort first; any extra scope still renders.
 */
export function composeRosterDepartmentGroups(
  members: StoreSpecialist[],
  isOnDuty: (member: StoreSpecialist) => boolean
): RosterDepartmentGroup[] {
  const buckets = new Map<DepartmentScope, StoreSpecialist[]>();
  for (const member of members) {
    const home = specialistHomeDepartment(member);
    const list = buckets.get(home) ?? [];
    list.push(member);
    buckets.set(home, list);
  }

  const known = STORE_DEPARTMENTS as readonly DepartmentScope[];
  const extras = [...buckets.keys()].filter((home) => !known.includes(home));
  const order = [...known, ...extras];

  return order
    .filter((home) => buckets.has(home))
    .map((home) => {
      const groupMembers = [...(buckets.get(home) ?? [])].sort((a, b) => {
        const d = roleRank(a) - roleRank(b);
        if (d !== 0) return d;
        return a.name.localeCompare(b.name);
      });
      return {
        home,
        heading: departmentRosterHeading(home),
        members: groupMembers,
        onDuty: groupMembers.filter(isOnDuty).length,
      };
    });
}
