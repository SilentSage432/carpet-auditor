/**
 * PERF-LOAD-002 — visit-on-demand + keep-alive-after-visit contracts.
 * Updated for RD-1 primary tabs (Overview · Map · This Week · Walkthroughs · More).
 * Team (/roster) is a secondary More route, not a primary visit key.
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
  it("cold Overview seeds only /overview", () => {
    const seeded = seedVisitedTabs("/overview", ALL);
    expect([...seeded]).toEqual(["/overview"]);
    expect(seeded.has("/admin/store-map")).toBe(false);
    expect(seeded.has("/dashboard")).toBe(false);
    expect(seeded.has("/settings")).toBe(false);
  });

  it("cold This Week seeds only /dashboard", () => {
    const seeded = seedVisitedTabs("/dashboard", ALL);
    expect([...seeded]).toEqual(["/dashboard"]);
    expect(seeded.has("/admin/store-map")).toBe(false);
    expect(seeded.has("/overview")).toBe(false);
    expect(seeded.has("/settings")).toBe(false);
  });

  it("direct Map launch seeds only Map", () => {
    const seeded = seedVisitedTabs("/admin/store-map", ALL);
    expect([...seeded]).toEqual(["/admin/store-map"]);
    expect(seeded.has("/dashboard")).toBe(false);
    expect(seeded.has("/overview")).toBe(false);
  });

  it("Team secondary path is not a primary visit key", () => {
    const seeded = seedVisitedTabs("/roster" as WorkflowTabHref, ALL);
    expect(seeded.size).toBe(0);
  });

  it("first navigation adds the new tab without remounting prior visits", () => {
    let visited = seedVisitedTabs("/overview", ALL);
    visited = reconcileVisitedTabs(visited, "/settings", ALL);
    expect(visited.has("/overview")).toBe(true);
    expect(visited.has("/settings")).toBe(true);
    expect(visited.has("/admin/store-map")).toBe(false);
    expect(visited.has("/dashboard")).toBe(false);

    const again = reconcileVisitedTabs(visited, "/settings", ALL);
    expect(visitedSetsEqual(visited, again)).toBe(true);
    visited = reconcileVisitedTabs(again, "/overview", ALL);
    expect(visited.has("/settings")).toBe(true);
  });

  it("associate allowed tabs never include Overview/Walkthroughs/More", () => {
    const associate = member({ id: "a1", role: "Associate" });
    const allowed = PRIMARY_WORKFLOW_TAB_HREFS.filter((href) =>
      canAccessWorkflowTab(associate, href)
    );
    expect(allowed).toEqual(["/admin/store-map", "/dashboard"]);
    const seeded = seedVisitedTabs("/dashboard", allowed);
    expect([...seeded]).toEqual(["/dashboard"]);
    const withMap = reconcileVisitedTabs(seeded, "/admin/store-map", allowed);
    expect(withMap.has("/settings")).toBe(false);
    expect(withMap.has("/overview")).toBe(false);
  });

  it("role/scope prune drops forbidden previously-visited tabs", () => {
    const supervisorAllowed = ALL.filter((href) =>
      canAccessWorkflowTab(member({ id: "s1", role: "Supervisor" }), href)
    );
    let visited = seedVisitedTabs("/overview", supervisorAllowed);
    visited = reconcileVisitedTabs(visited, "/settings", supervisorAllowed);
    visited = reconcileVisitedTabs(visited, "/walkthroughs", supervisorAllowed);
    expect(visited.has("/settings")).toBe(true);
    expect(visited.has("/walkthroughs")).toBe(true);

    const associateAllowed = PRIMARY_WORKFLOW_TAB_HREFS.filter((href) =>
      canAccessWorkflowTab(member({ id: "a1", role: "Associate" }), href)
    );
    visited = reconcileVisitedTabs(visited, "/dashboard", associateAllowed);
    expect(visited.has("/settings")).toBe(false);
    expect(visited.has("/walkthroughs")).toBe(false);
    expect(visited.has("/dashboard")).toBe(true);
  });

  it("forbidden active is not seeded", () => {
    const associateAllowed: WorkflowTabHref[] = [
      "/dashboard",
      "/admin/store-map",
    ];
    expect(seedVisitedTabs("/settings", associateAllowed).size).toBe(0);
  });
});

describe("PERF-LOAD-002 WorkflowTabShell wiring", () => {
  const shell = readRepo("components/hub/WorkflowTabShell.tsx");

  it("seeds visited from seedVisitedTabs, not all allowedTabs", () => {
    expect(shell).toContain("seedVisitedTabs(visitKey, allowedTabs)");
    expect(shell).not.toMatch(
      /useState<Set<WorkflowTabHref>>\(\s*\(\)\s*=>\s*new Set<WorkflowTabHref>\(allowedTabs\)/
    );
    expect(shell).toContain("reconcileVisitedTabs");
    expect(shell).not.toMatch(/for \(const href of allowedTabs\)/);
  });

  it("gates primary tabs on visited; Team on rosterVisited", () => {
    expect(shell).toContain('visited.has("/overview")');
    expect(shell).toContain('visited.has("/dashboard")');
    expect(shell).toContain('visited.has("/admin/store-map")');
    expect(shell).toContain('visited.has("/walkthroughs")');
    expect(shell).toContain('visited.has("/settings")');
    expect(shell).toContain("rosterVisited");
    expect(shell).toMatch(
      /\{visited\.has\("\/dashboard"\) \? \(\s*<KeepAlivePanel active=\{active === "\/dashboard"\}>\s*<FloorTab/
    );
  });

  it("keeps role checks on Team/More mount", () => {
    expect(shell).toMatch(
      /rosterVisited && canAccessWorkflowTab\(view, "\/roster"\)/
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
