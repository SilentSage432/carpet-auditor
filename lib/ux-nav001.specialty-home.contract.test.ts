/**
 * UX-NAV-001 — Specialty operational homes (REDUCE-004 amended).
 *
 * Everyday specialty launchers are disconnected. Floor Pad remains reachable
 * from More. SpecialtyToolsHost may remain mounted for dormant contextual
 * events until later runtime retirement.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIANCES_OPERATIONAL_HOME_HREF,
  FLOORING_CYCLE_AUDIT_HOME_HREF,
  visibleSpecialtyTools,
} from "@/lib/specialty-tools";

const root = path.resolve(__dirname, "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("UX-NAV-001 More / specialty homes — REDUCE-004 disconnected", () => {
  const settings = readRepo("components/sections/SettingsSection.tsx");
  const host = readRepo("components/hub/SpecialtyToolsHost.tsx");
  const tools = readRepo("lib/specialty-tools.ts");

  it("More keeps Floor Pad reachable and no longer lists specialty homes", () => {
    expect(settings).toContain('data-testid="more-department-tools"');
    expect(settings).toContain('data-testid="more-executive-floor-pad"');
    expect(settings).not.toContain('data-testid="more-appliances-home"');
    expect(settings).not.toContain('data-testid="more-flooring-tools"');
    expect(settings).not.toContain('data-testid="more-remnant-calculator"');
    expect(settings).not.toContain('data-testid="more-remnant-inventory"');
    expect(settings).not.toContain('data-testid="more-flooring-cycle-audit"');
    expect(settings).not.toContain("requestRemnantCalculator()");
  });

  it("Appliances / catalog routes redirect to Floor, not specialty hub", () => {
    const appliancesPage = readRepo("app/appliances/page.tsx");
    expect(appliancesPage).toContain('redirect("/dashboard")');
    expect(appliancesPage).not.toContain('redirect("/?section=appliances")');
    const catalogPage = readRepo("app/catalog/page.tsx");
    expect(catalogPage).toContain('redirect("/dashboard")');
    expect(APPLIANCES_OPERATIONAL_HOME_HREF).toBe("/appliances");
    expect(FLOORING_CYCLE_AUDIT_HOME_HREF).toBe("/?section=audit");
  });

  it("admin and device tools remain in More", () => {
    expect(settings).toContain('title="Department Setup"');
    expect(settings).toContain('data-testid="more-department-setup"');
    expect(settings).toContain('title="Device & Account"');
    expect(settings).toContain('data-testid="more-device-account"');
    expect(settings).toContain('title="Master Admin"');
    expect(settings).toContain('data-testid="more-master-admin"');
    expect(settings).toContain("OperationalContextCard");
  });

  it("SpecialtyToolsHost remains for dormant contextual launches", () => {
    expect(host).toContain("SpecialtyToolsHost");
    expect(host).toContain("APPLIANCE_SCANNER_OPEN_EVENT");
    expect(host).toContain("REMNANT_CALCULATOR_OPEN_EVENT");
    expect(host).toContain("ApplianceScannerModal");
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(shell).toContain("SpecialtyToolsHost");
  });

  it("visibleSpecialtyTools advertises nothing everyday", () => {
    expect(visibleSpecialtyTools(null)).toEqual([]);
    expect(tools).toContain("REDUCE-004");
    expect(tools).toContain("return [];");
  });
});
