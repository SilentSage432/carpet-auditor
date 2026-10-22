/**
 * DEPTSYNC-SECTION-OWNERSHIP-005 — focused supervisor navigation contracts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canAccessSupervisorManageView,
  legacyHashToManageView,
  openActionMustFocusView,
  parseSupervisorManageView,
  supervisorManageHref,
  supervisorManageHubHref,
  supervisorManageTitle,
} from "./supervisor-management-nav";
import type { StoreSpecialist } from "@/lib/types";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function specialist(
  role: StoreSpecialist["role"],
  overrides: Partial<StoreSpecialist> = {}
): StoreSpecialist {
  return {
    id: "s1",
    store_number: "2587",
    name: "Test",
    role,
    is_active: true,
    status: "active",
    ...overrides,
  } as StoreSpecialist;
}

describe("SECTION-OWNERSHIP-005 manage URL helpers", () => {
  it("parses manage views and rejects unknown", () => {
    expect(parseSupervisorManageView("team")).toBe("team");
    expect(parseSupervisorManageView("ownership")).toBe("ownership");
    expect(parseSupervisorManageView("coverage")).toBe("coverage");
    expect(parseSupervisorManageView("rotation")).toBe("rotation");
    expect(parseSupervisorManageView("scroll")).toBeNull();
    expect(parseSupervisorManageView(null)).toBeNull();
  });

  it("builds focused hrefs and hub href", () => {
    expect(supervisorManageHref("team")).toBe("/settings?manage=team");
    expect(supervisorManageHref("coverage", { section: "sec-1" })).toBe(
      "/settings?manage=coverage&section=sec-1"
    );
    expect(supervisorManageHubHref()).toBe("/settings");
    expect(supervisorManageTitle("ownership")).toBe("Section Ownership");
  });

  it("maps legacy hashes to focused views", () => {
    expect(legacyHashToManageView("team")).toBe("team");
    expect(legacyHashToManageView("#operational-sections")).toBe("ownership");
    expect(legacyHashToManageView("coverage")).toBe("coverage");
    expect(legacyHashToManageView("bulk-generate")).toBeNull();
  });

  it("gates ownership/coverage to section managers; team/rotation to supervisors", () => {
    const master = specialist("MasterAdmin");
    const supervisor = specialist("Supervisor");
    const associate = specialist("Associate");
    expect(canAccessSupervisorManageView("team", master)).toBe(true);
    expect(canAccessSupervisorManageView("ownership", supervisor)).toBe(true);
    expect(canAccessSupervisorManageView("coverage", supervisor)).toBe(true);
    expect(canAccessSupervisorManageView("rotation", supervisor)).toBe(true);
    expect(canAccessSupervisorManageView("rotation", master)).toBe(true);
    expect(canAccessSupervisorManageView("rotation", associate)).toBe(false);
    expect(canAccessSupervisorManageView("ownership", associate)).toBe(false);
    expect(canAccessSupervisorManageView("team", associate)).toBe(false);
    expect(canAccessSupervisorManageView("team", null)).toBe(false);
  });

  it("declares Open must focus a view", () => {
    expect(openActionMustFocusView()).toBe(true);
  });
});

describe("SECTION-OWNERSHIP-005 source contracts", () => {
  it("workflow Open handlers navigate via manage href — no scrollIntoView", () => {
    const card = readRepo(
      "components/admin/SupervisorOwnershipWorkflowCard.tsx"
    );
    expect(card).toMatch(/supervisorManageHref|onOpenManage/);
    expect(card).toMatch(/openManage\("team"\)/);
    expect(card).toMatch(/openManage\("ownership"\)/);
    expect(card).toMatch(/openManage\("coverage"\)/);
    expect(card).toMatch(/openManage\("rotation"\)/);
    expect(card).not.toMatch(/scrollIntoView/);
    expect(card).not.toMatch(/getElementById\("team"\)/);
    expect(card).not.toMatch(/getElementById\("operational-sections"\)/);
  });

  it("SettingsSection hosts focused views with Back and manage param", () => {
    const settings = readRepo("components/sections/SettingsSection.tsx");
    expect(settings).toMatch(/SupervisorFocusedManagementView/);
    expect(settings).toMatch(/supervisor-manage-back|onBack=\{leaveManageView\}/);
    expect(settings).toMatch(/SUPERVISOR_MANAGE_PARAM|parseSupervisorManageView/);
    expect(settings).toMatch(/manageView === "team"/);
    expect(settings).toMatch(/manageView === "ownership"/);
    expect(settings).toMatch(/manageView === "coverage"/);
    expect(settings).toMatch(/manageView === "rotation"/);
    expect(settings).toMatch(/SupervisorRotationStatusPanel/);
    expect(settings).toMatch(/RosterLifecyclePanel/);
    expect(settings).toMatch(/OperationalSectionsPanel/);
    expect(settings).toMatch(/Unsaved edits may be lost/);
    // Hub Open wiring must not scroll
    expect(settings).not.toMatch(
      /onOpenTeam=\{\(\) => \{\s*document\.getElementById\("team"\)/
    );
  });

  it("focused shell and rotation panel exist with test ids", () => {
    const shell = readRepo(
      "components/admin/SupervisorFocusedManagementView.tsx"
    );
    const rotation = readRepo(
      "components/admin/SupervisorRotationStatusPanel.tsx"
    );
    expect(shell).toMatch(/data-testid=\{`supervisor-manage-\$\{view\}`\}/);
    expect(shell).toMatch(/supervisor-manage-back/);
    expect(shell).toMatch(/Back to More/);
    expect(rotation).toMatch(/supervisor-rotation-focused/);
    expect(rotation).toMatch(/rotation-open-this-week/);
    expect(rotation).toMatch(/composeRotationVisibilityStatus/);
  });

  it("OperationalSectionsPanel supports ownership/coverage emphasis", () => {
    const panel = readRepo("components/admin/OperationalSectionsPanel.tsx");
    expect(panel).toMatch(/emphasis\?: "ownership" \| "coverage"/);
    expect(panel).toMatch(/sections-emphasis-ownership/);
    expect(panel).toMatch(/sections-emphasis-coverage/);
    expect(panel).toMatch(/onEditingChange/);
  });

  it("preserves preview write-guard scope", () => {
    const safety = readRepo("lib/preview-safety.ts");
    expect(safety).toMatch(/VERCEL_ENV.*preview/);
    expect(safety).toMatch(/production.*unaffected/i);
  });

  it("does not change AUTO-008 latch or cron in this tranche", () => {
    const latch = readRepo("lib/store-ops/authoritative-week-cycle.ts");
    const vercel = readRepo("vercel.json");
    expect(latch).toMatch(
      /WEEKLY_ROTATION_AUTO_PUBLISH:\s*boolean\s*=\s*true/
    );
    expect(vercel).toMatch(/"0 12 \* \* 0"/);
  });
});
