/**
 * UX-REDUCE-004 — Roster People + schedule presentation contracts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatOwnedBayCaption,
  formatPeopleCount,
  isScheduleUnknown,
} from "./roster-people-presentation";
import { composeCurrentAvailability } from "./current-availability";
import { isSimplifiedAssociateView } from "@/lib/rbac";
import { navRoleLinks } from "@/lib/nav-hub";
import type { StoreSpecialist } from "@/lib/types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function member(
  overrides: Partial<StoreSpecialist> & Pick<StoreSpecialist, "id" | "role">
): StoreSpecialist {
  return {
    store_number: "1755",
    name: "Test",
    is_active: true,
    status: "active",
    assigned_department: "flooring",
    accessible_departments: ["flooring"],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as StoreSpecialist;
}

describe("UX-REDUCE-004 Roster People contracts", () => {
  const roster = readRepo("components/hub/tabs/RosterTab.tsx");
  const card = readRepo("components/hub/SpecialistCard.tsx");
  const sheet = readRepo("components/hub/SpecialistEditSheet.tsx");
  const chips = readRepo("components/hub/DepartmentAccessChips.tsx");
  const nav = readRepo("lib/nav-hub.ts");

  it("People is the primary Roster concept", () => {
    expect(roster).toMatch(/\bPeople\b/);
    expect(roster).toMatch(/formatPeopleCount/);
    expect(roster).not.toMatch(/Team roster/);
    expect(nav).toMatch(/label: \"People\"/);
    expect(nav).toMatch(/return \"People\"/);
  });

  it("keeps schedule before member settings and device access", () => {
    const scheduleIdx = sheet.indexOf("Schedule");
    const settingsIdx = sheet.indexOf("Member settings");
    const deviceIdx = sheet.indexOf("Device access");
    expect(scheduleIdx).toBeGreaterThan(-1);
    expect(settingsIdx).toBeGreaterThan(scheduleIdx);
    expect(deviceIdx).toBeGreaterThan(settingsIdx);
  });

  it("uses explicit call-out language, not a presence switch", () => {
    expect(card).toMatch(/Mark called out/);
    expect(card).toMatch(/Clear call-out/);
    expect(card).not.toMatch(/role=\"switch\"/);
    expect(card).toMatch(/roster-reassign-recovery/);
  });

  it("treats accessible_departments as DeptSync authority scope", () => {
    expect(chips).toMatch(/DeptSync access/);
    expect(chips).toMatch(/not mean\s+secondary workforce capability/);
    expect(sheet).toMatch(/DeptSync access/);
    expect(sheet).not.toMatch(/Cross-department access/);
  });

  it("removes mounted Specialist management vocabulary", () => {
    expect(sheet).not.toMatch(/Specialist management/);
    expect(sheet).not.toMatch(/Remove Specialist/);
    expect(sheet).toMatch(/Team member/);
    expect(sheet).toMatch(/Remove team member/);
    // Lowe's floor title "Specialist" may remain on FloorTitleBadge.
    expect(card).toMatch(/label === \"Specialist\"/);
  });

  it("preserves Add Team Member and removal lifecycle gates", () => {
    expect(roster).toMatch(/Add Team Member/);
    expect(roster).toMatch(/canManageTeamRoster/);
    expect(roster).toMatch(/deleteSpecialist/);
    expect(roster).toMatch(/rotation workforce/);
  });

  it("associates remain excluded from Roster nav", () => {
    const associate = member({ id: "a1", role: "Associate" });
    expect(isSimplifiedAssociateView(associate)).toBe(true);
    const links = navRoleLinks(associate);
    expect(links.some((l) => l.href === "/roster")).toBe(false);
    expect(links.map((l) => l.href)).toEqual([
      "/dashboard",
      "/admin/store-map",
    ]);
  });

  it("Master and DS still see Roster", () => {
    const master = member({ id: "m1", role: "MasterAdmin" });
    const ds = member({ id: "d1", role: "Supervisor" });
    expect(navRoleLinks(master).some((l) => l.href === "/roster")).toBe(true);
    expect(navRoleLinks(ds).some((l) => l.href === "/roster")).toBe(true);
  });

  it("schedule-unknown presentation helpers stay pure", () => {
    const unknown = composeCurrentAvailability({
      row: null,
      now: new Date("2026-09-16T14:00:00.000Z"),
      timeZone: "America/Denver",
    });
    expect(isScheduleUnknown(unknown)).toBe(true);
    expect(unknown.label).toBe("Schedule unknown");
    expect(formatPeopleCount(1)).toBe("1 person");
    expect(formatOwnedBayCaption(3)).toBe("3 bays still owned this week");
    expect(formatOwnedBayCaption(0)).toBeNull();
  });

  it("does not invent WORKFORCE-SCOPE-001 secondary labor policy", () => {
    expect(roster).not.toMatch(/secondary operational capability/i);
    expect(roster).not.toMatch(/labor percentage/i);
    expect(sheet).toMatch(/workforce-scope decision/);
  });
});

describe("UX-REDUCE-004 does not reopen Floor or Map", () => {
  it("Floor This Week ownership board remains mounted", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toContain("ThisWeekOwnershipBoard");
    expect(floor).toContain("composeThisWeekOwnership");
  });

  it("Map remains physical-bay-first", () => {
    const map = readRepo("components/hub/tabs/MapTab.tsx");
    const grid = readRepo("components/admin/StoreLocationGrid.tsx");
    expect(map).toMatch(/Department coverage/);
    expect(grid).toMatch(/physicalBayCount/);
    expect(grid).not.toMatch(/tagCount/);
  });
});
