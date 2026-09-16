/**
 * UX-005B — Floor Appliances entry (REDUCE-004 amended).
 *
 * Original UX-005B advertised a department-aware Appliances entry on Floor.
 * REDUCE-004 disconnects that everyday specialty launcher. The helper remains
 * and must return false so the reduced rotation product does not re-advertise
 * Appliances without an explicit product decision.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldShowFloorAppliancesEntry } from "@/lib/specialty-tools";
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

describe("UX-005B Floor Appliances entry — REDUCE-004 disconnected", () => {
  it("never shows Floor Appliances entry for any working context", () => {
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "Supervisor",
          assigned_department: "appliances",
        }),
        "appliances"
      )
    ).toBe(false);
    expect(
      shouldShowFloorAppliancesEntry(
        specialist({
          role: "MasterAdmin",
          assigned_department: "all",
        }),
        "appliances"
      )
    ).toBe(false);
  });

  it("Floor no longer mounts the appliances entry", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).not.toContain('data-testid="floor-appliances-entry"');
    expect(floor).not.toContain("shouldShowFloorAppliancesEntry");
    expect(floor).not.toContain("APPLIANCES_OPERATIONAL_HOME_HREF");
  });

  it("More no longer advertises Appliances home", () => {
    const settings = readRepo("components/sections/SettingsSection.tsx");
    expect(settings).not.toContain('data-testid="more-appliances-home"');
    expect(settings).toContain('data-testid="more-executive-floor-pad"');
  });

  it("BottomNav IA remains Floor · Map · Roster · More", () => {
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(shell).not.toContain("floor-appliances-entry");
    const nav = readRepo("lib/nav-hub.ts");
    expect(nav).toContain("Floor");
    expect(nav).toContain("Map");
    expect(nav).toContain("Roster");
    expect(nav).toContain("More");
  });
});
