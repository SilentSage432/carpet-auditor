/**
 * DEPTSYNC-RD-1 — Floor Command application shell contracts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAccessWorkflowTab,
  homeHrefForSpecialist,
  isNavHubPathActive,
  navRoleLinks,
  PRIMARY_WORKFLOW_TAB_HREFS,
  showHeaderDepartmentSwitcher,
  workflowTabFromPathname,
  workflowTabTitle,
} from "@/lib/nav-hub";
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

describe("RD-1 Floor Command navigation", () => {
  it("primary tabs are Overview · Map · This Week · Walkthroughs · More", () => {
    expect([...PRIMARY_WORKFLOW_TAB_HREFS]).toEqual([
      "/overview",
      "/admin/store-map",
      "/dashboard",
      "/walkthroughs",
      "/settings",
    ]);
    const links = navRoleLinks(member({ id: "s1", role: "Supervisor" }));
    expect(links.map((l) => l.shortLabel)).toEqual([
      "Overview",
      "Map",
      "Week",
      "Walk",
      "More",
    ]);
  });

  it("operator lands on Overview; associate lands on This Week", () => {
    expect(homeHrefForSpecialist(member({ id: "s1", role: "Supervisor" }))).toBe(
      "/overview"
    );
    expect(homeHrefForSpecialist(member({ id: "a1", role: "Associate" }))).toBe(
      "/dashboard"
    );
  });

  it("associates do not receive Overview / Walkthroughs / More", () => {
    const associate = member({ id: "a1", role: "Associate" });
    expect(canAccessWorkflowTab(associate, "/overview")).toBe(false);
    expect(canAccessWorkflowTab(associate, "/walkthroughs")).toBe(false);
    expect(canAccessWorkflowTab(associate, "/settings")).toBe(false);
    expect(canAccessWorkflowTab(associate, "/roster")).toBe(false);
    expect(canAccessWorkflowTab(associate, "/dashboard")).toBe(true);
    expect(canAccessWorkflowTab(associate, "/admin/store-map")).toBe(true);
  });

  it("Team (/roster) highlights More in the primary bar", () => {
    expect(isNavHubPathActive("/roster", "/settings")).toBe(true);
    expect(isNavHubPathActive("/roster", "/overview")).toBe(false);
  });

  it("pathname mapping covers new routes", () => {
    expect(workflowTabFromPathname("/overview")).toBe("/overview");
    expect(workflowTabFromPathname("/walkthroughs")).toBe("/walkthroughs");
    expect(workflowTabFromPathname("/dashboard")).toBe("/dashboard");
    expect(workflowTabFromPathname("/roster")).toBe("/roster");
    expect(workflowTabTitle("/dashboard")).toBe("This Week");
    expect(
      workflowTabTitle(
        "/dashboard",
        member({ id: "a1", role: "Associate" })
      )
    ).toBe("My Shift");
  });

  it("hides department switcher on Map / Overview / Walkthroughs", () => {
    expect(showHeaderDepartmentSwitcher("/admin/store-map")).toBe(false);
    expect(showHeaderDepartmentSwitcher("/overview")).toBe(false);
    expect(showHeaderDepartmentSwitcher("/walkthroughs")).toBe(false);
    expect(showHeaderDepartmentSwitcher("/dashboard")).toBe(true);
    expect(showHeaderDepartmentSwitcher("/settings")).toBe(true);
  });
});

describe("RD-1 shell wiring", () => {
  const shell = readRepo("components/hub/WorkflowTabShell.tsx");
  const map = readRepo("components/hub/tabs/MapTab.tsx");
  const more = readRepo("components/sections/SettingsSection.tsx");

  it("mounts Overview and Walkthroughs keep-alive panels", () => {
    expect(shell).toContain("OverviewTab");
    expect(shell).toContain("WalkthroughsTab");
    expect(shell).toContain('visited.has("/overview")');
    expect(shell).toContain('visited.has("/walkthroughs")');
    expect(shell).toContain("homeHrefForSpecialist");
  });

  it("keeps Team as secondary rosterVisited mount", () => {
    expect(shell).toContain("rosterVisited");
    expect(shell).toContain("RosterTab");
    expect(more).toContain('data-testid="more-team"');
    expect(more).toContain('data-testid="more-open-team"');
  });

  it("Map shows full aisle geography without department pin filtering", () => {
    expect(map).toContain("visibleDepartments = departments");
    expect(map).toContain("visibleLocations = locations");
    expect(map).toMatch(/aisle → bay geography/i);
  });

  it("workflow routes exist for Overview and Walkthroughs", () => {
    expect(readRepo("app/(workflow)/overview/page.tsx")).toContain(
      "OverviewPage"
    );
    expect(readRepo("app/(workflow)/walkthroughs/page.tsx")).toContain(
      "WalkthroughsPage"
    );
  });
});
