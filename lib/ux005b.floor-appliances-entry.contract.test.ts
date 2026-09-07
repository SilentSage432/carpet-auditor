/**
 * UX-005B — Department-aware Appliances entry on Floor (presentation / nav only).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIANCES_OPERATIONAL_HOME_HREF,
  shouldShowFloorAppliancesEntry,
} from "@/lib/specialty-tools";
import type { StoreSpecialist } from "@/lib/types";

const root = path.resolve(__dirname, "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function specialist(
  overrides: Partial<StoreSpecialist> &
    Pick<StoreSpecialist, "role" | "assigned_department">
): StoreSpecialist {
  return {
    id: "spec-1",
    store_number: "2587",
    name: "Test User",
    pin_code: null,
    username: "test",
    must_change_credentials: false,
    is_active: true,
    created_at: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("UX-005B Floor Appliances entry visibility", () => {
  it("Appliances Supervisor sees contextual entry", () => {
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "Supervisor",
          assigned_department: "appliances",
        }),
        "appliances"
      )
    ).toBe(true);
  });

  it("Master pinned Appliances sees it", () => {
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "MasterAdmin",
          assigned_department: "all",
        }),
        "appliances"
      )
    ).toBe(true);
  });

  it("Master pinned All does not", () => {
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "MasterAdmin",
          assigned_department: "all",
        }),
        "all"
      )
    ).toBe(false);
  });

  it("Flooring working context does not", () => {
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "Supervisor",
          assigned_department: "flooring",
        }),
        "flooring"
      )
    ).toBe(false);
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "Supervisor",
          assigned_department: "appliances",
          accessible_departments: ["appliances", "flooring"],
        }),
        "flooring"
      )
    ).toBe(false);
  });

  it("unrelated departments do not", () => {
    for (const dept of ["paint", "millwork", "cabinets", "tools"] as const) {
      expect(
        shouldShowFloorAppliancesEntry(
          specialist({
            role: "Supervisor",
            assigned_department: dept,
          }),
          dept
        )
      ).toBe(false);
    }
  });

  it("Associate does not", () => {
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "Associate",
          assigned_department: "appliances",
        }),
        "appliances"
      )
    ).toBe(false);
  });

  it("section-access denial hides it", () => {
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "Supervisor",
          assigned_department: "flooring",
          accessible_departments: ["flooring"],
        }),
        "appliances"
      )
    ).toBe(false);
  });
});

describe("UX-005B Floor Appliances entry wiring", () => {
  const floor = readRepo("components/hub/tabs/FloorTab.tsx");
  const settings = readRepo("components/sections/SettingsSection.tsx");
  const nav = readRepo("lib/nav-hub.ts");
  const tools = readRepo("lib/specialty-tools.ts");
  const bottom = readRepo("components/hub/BottomNav.tsx");

  it("entry uses APPLIANCES_OPERATIONAL_HOME_HREF", () => {
    expect(floor).toContain("shouldShowFloorAppliancesEntry");
    expect(floor).toContain('data-testid="floor-appliances-entry"');
    expect(floor).toContain("APPLIANCES_OPERATIONAL_HOME_HREF");
    expect(floor).toContain("router.push(APPLIANCES_OPERATIONAL_HOME_HREF)");
    expect(APPLIANCES_OPERATIONAL_HOME_HREF).toBe("/appliances");
    expect(floor).toMatch(/text-sky-50">\s*Appliances\s*</);
    expect(floor).toMatch(/Physical audit/);
  });

  it("More → Appliances remains intact", () => {
    expect(settings).toContain('data-testid="more-appliances-home"');
    expect(settings).toContain("router.push(APPLIANCES_OPERATIONAL_HOME_HREF)");
    expect(settings).toContain('title="Department Tools"');
  });

  it("no Flooring specialty entry is introduced on Floor", () => {
    expect(floor).not.toContain("floor-flooring-entry");
    expect(floor).not.toContain("FLOORING_CYCLE_AUDIT_HOME_HREF");
    expect(floor).not.toContain("preferredHubSectionForWorkingDept");
    expect(tools).toContain("Appliances-only pilot");
    expect(tools).not.toMatch(
      /shouldShowFloorAppliancesEntry[\s\S]{0,400}flooring/
    );
  });

  it("no fifth bottom-nav item is introduced", () => {
    expect(nav).toContain('shortLabel: "Floor"');
    expect(nav).toContain('shortLabel: "Map"');
    expect(nav).toContain('shortLabel: "Roster"');
    expect(nav).toContain('shortLabel: "More"');
    const primaryLinks = nav.match(/href: "\/dashboard"/g) ?? [];
    expect(primaryLinks.length).toBeGreaterThanOrEqual(1);
    expect(nav).not.toContain('shortLabel: "Appliances"');
    expect(bottom).not.toContain("Appliances");
    expect(floor).not.toContain("PRIMARY_WORKFLOW_TAB_HREFS");
  });

  it("does not fetch appliance audit state on Floor for the entry", () => {
    expect(floor).not.toContain("fetchApplianceAuditSessions");
    expect(floor).not.toContain("fetchApplianceAuditConsiderations");
    expect(floor).not.toContain("/api/appliances/audits");
  });

  it("does not alter specialty host or dual-shell architecture", () => {
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(shell).toContain("SpecialtyToolsHost");
    expect(shell).not.toContain("floor-appliances-entry");
    expect(tools).toContain("APPLIANCES_OPERATIONAL_HOME_HREF");
  });
});
