/**
 * UX-NAV-001 — Specialty operational home via More → Department Tools.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIANCES_OPERATIONAL_HOME_HREF,
  FLOORING_CYCLE_AUDIT_HOME_HREF,
} from "@/lib/specialty-tools";

const root = path.resolve(__dirname, "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("UX-NAV-001 More Department Tools", () => {
  const settings = readRepo("components/sections/SettingsSection.tsx");
  const host = readRepo("components/hub/SpecialtyToolsHost.tsx");
  const section = readRepo("components/sections/ApplianceAuditSection.tsx");
  const tools = readRepo("lib/specialty-tools.ts");

  it("More exposes Department Tools as the first operational card", () => {
    expect(settings).toContain('title="Department Tools"');
    expect(settings).toContain('data-testid="more-department-tools"');
    expect(settings).not.toContain('title="Floor Utilities"');
    expect(settings).not.toContain('data-testid="more-scan-count-appliances"');
  });

  it("Appliances primary action navigates to audit-aware home, not bare scanner", () => {
    expect(settings).toContain('data-testid="more-appliances-home"');
    expect(settings).toContain("APPLIANCES_OPERATIONAL_HOME_HREF");
    expect(settings).toContain("router.push(APPLIANCES_OPERATIONAL_HOME_HREF)");
    expect(settings).not.toContain("requestApplianceScanner()");
    expect(APPLIANCES_OPERATIONAL_HOME_HREF).toBe("/appliances");
  });

  it("Appliances home mounts ApplianceAuditSection with panel Start/Continue and secondary ad-hoc", () => {
    expect(section).toContain("AppliancePhysicalAuditPanel");
    expect(section).toContain("onContinueScanning");
    expect(section).toContain("Ad-hoc scan (no audit)");
    expect(section).toContain('data-testid="more-appliance-tools"');
    const panel = readRepo("components/appliances/AppliancePhysicalAuditPanel.tsx");
    expect(panel).toContain("Start Physical Audit");
    expect(panel).toContain("Continue scanning");
  });

  it("deep links preserve appliances and flooring specialty homes", () => {
    const appliancesPage = readRepo("app/appliances/page.tsx");
    expect(appliancesPage).toContain('redirect("/?section=appliances")');
    expect(tools).toContain("FLOORING_CYCLE_AUDIT_HOME_HREF");
    expect(FLOORING_CYCLE_AUDIT_HOME_HREF).toBe("/?section=audit");
  });

  it("Flooring tools remain reachable from Department Tools", () => {
    expect(settings).toContain('data-testid="more-flooring-tools"');
    expect(settings).toContain('data-testid="more-remnant-calculator"');
    expect(settings).toContain("requestRemnantCalculator()");
    expect(settings).toContain('data-testid="more-remnant-inventory"');
    expect(settings).toContain('data-testid="more-flooring-cycle-audit"');
    expect(settings).toContain("FLOORING_CYCLE_AUDIT_HOME_HREF");
  });

  it("admin and device tools remain in More below Department Tools", () => {
    expect(settings).toContain('title="Store Management"');
    expect(settings).toContain('data-testid="more-store-management"');
    expect(settings).toContain('title="Device & Diagnostics"');
    expect(settings).toContain('data-testid="more-device-diagnostics"');
    const deptIdx = settings.indexOf('title="Department Tools"');
    const storeIdx = settings.indexOf('title="Store Management"');
    const deviceIdx = settings.indexOf('title="Device & Diagnostics"');
    expect(deptIdx).toBeGreaterThan(-1);
    expect(storeIdx).toBeGreaterThan(deptIdx);
    expect(deviceIdx).toBeGreaterThan(storeIdx);
  });

  it("SpecialtyToolsHost remains for contextual launches without audit props", () => {
    expect(host).toContain("SpecialtyToolsHost");
    expect(host).toContain("APPLIANCE_SCANNER_OPEN_EVENT");
    expect(host).toContain("REMNANT_CALCULATOR_OPEN_EVENT");
    expect(host).toContain("ApplianceScannerModal");
    expect(host).toContain("UX-NAV-001");
    expect(host).not.toContain("auditSessionId=");
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(shell).toContain("SpecialtyToolsHost");
  });

  it("registry documents primary home vs contextual scanner", () => {
    expect(tools).toContain("APPLIANCES_OPERATIONAL_HOME_HREF");
    expect(tools).toContain("Not the primary More → Appliances entry");
    expect(tools).toContain('href: APPLIANCES_OPERATIONAL_HOME_HREF');
  });
});
