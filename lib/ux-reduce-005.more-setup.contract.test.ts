/**
 * UX-REDUCE-005 — More → Setup & Administration contracts.
 *
 * More contains setup and administration, not everyday operations.
 * PERF-LOAD-002 visit-on-demand must remain intact.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSimplifiedAssociateView } from "@/lib/rbac";
import { canAccessWorkflowTab, navRoleLinks } from "@/lib/nav-hub";
import type { StoreSpecialist } from "@/lib/types";

const root = path.resolve(__dirname, "..");

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

describe("UX-REDUCE-005 More setup & administration", () => {
  const settings = readRepo("components/sections/SettingsSection.tsx");
  const shell = readRepo("components/hub/WorkflowTabShell.tsx");
  const matrix = readRepo("components/admin/DepartmentTargetsMatrix.tsx");

  it("frames More as setup and administration", () => {
    expect(settings).toMatch(/Setup and administration for DeptSync/);
    expect(settings).toMatch(/UX-REDUCE-005/);
    expect(settings).toContain('title="Floor Pad"');
    expect(settings).toContain('title="Department Setup"');
    expect(settings).toContain('title="Rotation Setup"');
    expect(settings).toContain('title="Device & Account"');
    expect(settings).toContain('title="Master Admin"');
  });

  it("keeps Floor Pad protected and reachable without autonomous claims", () => {
    expect(settings).toContain('data-testid="more-executive-floor-pad"');
    expect(settings).toContain("buildExecutiveFloorPadHref");
    expect(settings).toMatch(/Protected supporting tool/);
    expect(settings).toMatch(/DS\s+confirms authoritative/);
    expect(settings).not.toMatch(/autonomous/i);
  });

  it("Department Setup owns aisles & bays; Map mutation stays out of More claims", () => {
    expect(settings).toContain('data-testid="more-department-setup"');
    expect(settings).toContain("Aisles & bays");
    expect(settings).toContain("AisleBayManager");
    expect(settings).toMatch(/Map stays coverage-only/);
    expect(settings).toContain("canMutate");
  });

  it("Seasonal Context lives under Rotation Setup for Master", () => {
    expect(settings).toContain('data-testid="more-rotation-setup"');
    expect(settings).toContain("OperationalContextCard");
    expect(settings).toMatch(/showRotationSetup = masterSession/);
    expect(settings).toMatch(/Coverage cadence inputs/);
  });

  it("weekly targets are not a mounted More control", () => {
    expect(settings).not.toContain("WeeklyBayTargetCard");
    expect(settings).toMatch(/three physical bays per eligible[\s\S]*associate/);
    expect(matrix).toMatch(/three physical bays per eligible associate/);
  });

  it("Sunday Stage/Force recovery is Master Admin, not normal workflow", () => {
    expect(settings).toMatch(/Advanced recovery · Generate this week/);
    expect(settings).toContain("ForceRotationModal");
    expect(settings).toMatch(/more-master-admin[\s\S]*ForceRotationModal|setForceOpen\(true\)/);
    expect(settings).toMatch(/not everyday DS workflow/);
  });

  it("fiscal and taxonomies are unmounted from More", () => {
    expect(settings).not.toMatch(/FiscalCoverageCard/);
    expect(settings).not.toMatch(/Catalog taxonomies/);
    expect(settings).not.toMatch(/TaxonomyManagerModal/);
  });

  it("specialty residue stays disconnected from primary More", () => {
    expect(settings).not.toContain('data-testid="more-appliances-home"');
    expect(settings).not.toContain('data-testid="more-remnant-calculator"');
    expect(settings).not.toContain('data-testid="more-flooring-cycle-audit"');
    expect(settings).not.toContain("requestRemnantCalculator()");
  });

  it("Master Admin defaults collapsed (progressive disclosure)", () => {
    expect(settings).toMatch(/useState\(false\).*masterOpen|masterOpen.*useState\(false\)/);
    expect(settings).toMatch(
      /title="Master Admin"[\s\S]*collapsible[\s\S]*open=\{masterOpen\}/
    );
  });

  it("defers topology/admin graph until section needs it", () => {
    expect(settings).toContain("needTopologyGraph");
    expect(settings).toMatch(/if \(!needTopologyGraph\) return;/);
    expect(settings).not.toMatch(
      /useEffect\(\(\) => \{\s*void reloadDepts\(\);\s*\}, \[reloadDepts\]\);/
    );
    expect(settings).toMatch(/openSection === "bulk" \? \(/);
  });

  it("associates do not gain More access", () => {
    const associate = member({ id: "a1", role: "Associate" });
    expect(isSimplifiedAssociateView(associate)).toBe(true);
    expect(canAccessWorkflowTab(associate, "/settings")).toBe(false);
    expect(navRoleLinks(associate).some((l) => l.href === "/settings")).toBe(
      false
    );
  });

  it("PERF-LOAD-002 visit-on-demand for More remains intact", () => {
    expect(shell).toContain("seedVisitedTabs");
    expect(shell).toContain('visited.has("/settings")');
    expect(shell).not.toMatch(
      /useState<Set<WorkflowTabHref>>\(\s*\(\)\s*=>\s*new Set<WorkflowTabHref>\(allowedTabs\)/
    );
  });

  it("does not change Floor / Map / Roster tab sources", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const map = readRepo("components/hub/tabs/MapTab.tsx");
    const grid = readRepo("components/admin/StoreLocationGrid.tsx");
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(floor).toContain("ThisWeekOwnershipBoard");
    expect(map).toContain("StoreLocationGrid");
    expect(grid).toContain("canMutate={false}");
    expect(roster).toContain("formatPeopleCount");
  });
});
