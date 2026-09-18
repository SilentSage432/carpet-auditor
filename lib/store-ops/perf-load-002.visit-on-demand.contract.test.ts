/**
 * PERF-LOAD-002 — visit-on-demand + keep-alive-after-visit contracts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAccessWorkflowTab,
  PRIMARY_WORKFLOW_TAB_HREFS,
  type WorkflowTabHref,
} from "@/lib/nav-hub";
import type { StoreSpecialist } from "@/lib/types";
import {
  reconcileVisitedTabs,
  seedVisitedTabs,
  visitedSetsEqual,
} from "@/lib/workflow-tab-visit";

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

const ALL = [...PRIMARY_WORKFLOW_TAB_HREFS] as WorkflowTabHref[];

describe("PERF-LOAD-002 visit-on-demand helpers", () => {
  it("cold Floor seeds only /dashboard", () => {
    const seeded = seedVisitedTabs("/dashboard", ALL);
    expect([...seeded]).toEqual(["/dashboard"]);
    expect(seeded.has("/admin/store-map")).toBe(false);
    expect(seeded.has("/roster")).toBe(false);
    expect(seeded.has("/settings")).toBe(false);
  });

  it("direct Map launch seeds only Map", () => {
    const seeded = seedVisitedTabs("/admin/store-map", ALL);
    expect([...seeded]).toEqual(["/admin/store-map"]);
    expect(seeded.has("/dashboard")).toBe(false);
    expect(seeded.has("/roster")).toBe(false);
  });

  it("direct Roster launch seeds only Roster", () => {
    const seeded = seedVisitedTabs("/roster", ALL);
    expect([...seeded]).toEqual(["/roster"]);
    expect(seeded.has("/dashboard")).toBe(false);
    expect(seeded.has("/settings")).toBe(false);
  });

  it("first navigation adds the new tab without remounting prior visits", () => {
    let visited = seedVisitedTabs("/dashboard", ALL);
    visited = reconcileVisitedTabs(visited, "/roster", ALL);
    expect(visited.has("/dashboard")).toBe(true);
    expect(visited.has("/roster")).toBe(true);
    expect(visited.has("/admin/store-map")).toBe(false);
    expect(visited.has("/settings")).toBe(false);

    // Revisit Roster — set stays stable (keep-alive, not remount seed).
    const again = reconcileVisitedTabs(visited, "/roster", ALL);
    expect(visitedSetsEqual(visited, again)).toBe(true);
    visited = reconcileVisitedTabs(again, "/dashboard", ALL);
    expect(visited.has("/roster")).toBe(true);
  });

  it("associate allowed tabs never include Roster/Settings", () => {
    const associate = member({ id: "a1", role: "Associate" });
    const allowed = PRIMARY_WORKFLOW_TAB_HREFS.filter((href) =>
      canAccessWorkflowTab(associate, href)
    );
    expect(allowed).toEqual(["/dashboard", "/admin/store-map"]);
    const seeded = seedVisitedTabs("/dashboard", allowed);
    expect([...seeded]).toEqual(["/dashboard"]);
    const withMap = reconcileVisitedTabs(seeded, "/admin/store-map", allowed);
    expect(withMap.has("/roster")).toBe(false);
    expect(withMap.has("/settings")).toBe(false);
  });

  it("role/scope prune drops forbidden previously-visited tabs", () => {
    const supervisorAllowed = ALL.filter((href) =>
      canAccessWorkflowTab(member({ id: "s1", role: "Supervisor" }), href)
    );
    let visited = seedVisitedTabs("/dashboard", supervisorAllowed);
    visited = reconcileVisitedTabs(visited, "/roster", supervisorAllowed);
    visited = reconcileVisitedTabs(visited, "/settings", supervisorAllowed);
    expect(visited.has("/roster")).toBe(true);
    expect(visited.has("/settings")).toBe(true);

    const associateAllowed = PRIMARY_WORKFLOW_TAB_HREFS.filter((href) =>
      canAccessWorkflowTab(member({ id: "a1", role: "Associate" }), href)
    );
    visited = reconcileVisitedTabs(visited, "/dashboard", associateAllowed);
    expect(visited.has("/roster")).toBe(false);
    expect(visited.has("/settings")).toBe(false);
    expect(visited.has("/dashboard")).toBe(true);
  });

  it("forbidden active is not seeded", () => {
    const associateAllowed: WorkflowTabHref[] = [
      "/dashboard",
      "/admin/store-map",
    ];
    expect(seedVisitedTabs("/roster", associateAllowed).size).toBe(0);
  });
});

describe("PERF-LOAD-002 WorkflowTabShell wiring", () => {
  const shell = readRepo("components/hub/WorkflowTabShell.tsx");

  it("seeds visited from seedVisitedTabs, not all allowedTabs", () => {
    expect(shell).toContain("seedVisitedTabs(active, allowedTabs)");
    expect(shell).not.toMatch(
      /useState<Set<WorkflowTabHref>>\(\s*\(\)\s*=>\s*new Set<WorkflowTabHref>\(allowedTabs\)/
    );
    expect(shell).toContain("reconcileVisitedTabs");
    // Must not auto-add every allowed tab on mount.
    expect(shell).not.toMatch(/for \(const href of allowedTabs\)/);
  });

  it("gates Floor / Map / Roster / Settings on visited", () => {
    expect(shell).toContain('visited.has("/dashboard")');
    expect(shell).toContain('visited.has("/admin/store-map")');
    expect(shell).toContain('visited.has("/roster")');
    expect(shell).toContain('visited.has("/settings")');
    expect(shell).toMatch(
      /\{visited\.has\("\/dashboard"\) \? \(\s*<KeepAlivePanel active=\{active === "\/dashboard"\}>\s*<FloorTab/
    );
  });

  it("keeps role checks on Roster/Settings mount", () => {
    expect(shell).toMatch(
      /visited\.has\("\/roster"\) && canAccessWorkflowTab\(view, "\/roster"\)/
    );
    expect(shell).toMatch(
      /visited\.has\("\/settings"\) && canAccessWorkflowTab\(view, "\/settings"\)/
    );
  });

  it("documents visit-on-demand + keep-alive-after-visit", () => {
    expect(shell).toMatch(/visit-on-demand/i);
    expect(shell).toMatch(/keep-alive after visit/i);
  });
});
