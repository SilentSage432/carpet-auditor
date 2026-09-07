import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("APP-FIELD-001B physical audit exit wiring", () => {
  it("Appliances entry exposes Start Physical Audit when none active", () => {
    const panel = readRepo(
      "components/appliances/AppliancePhysicalAuditPanel.tsx"
    );
    const section = readRepo("components/sections/ApplianceAuditSection.tsx");
    expect(panel).toContain("Start Physical Audit");
    expect(panel).toContain("startAppliancePhysicalAudit");
    expect(panel).toContain("Continue scanning");
    expect(section).toContain("Ad-hoc scan (no audit)");
    expect(section).toContain("onContinueScanning");
  });

  it("Start creates durable audit and opens scanner with audit mode", () => {
    const panel = readRepo(
      "components/appliances/AppliancePhysicalAuditPanel.tsx"
    );
    const section = readRepo("components/sections/ApplianceAuditSection.tsx");
    expect(panel).toContain("startAppliancePhysicalAudit");
    expect(panel).toContain("onStarted?.(session)");
    expect(section).toContain("onStarted=");
    expect(section).toContain('setScannerAuditMode("audit")');
    expect(section).toContain("setScannerOpen(true)");
  });

  it("scanner renders Physical audit active + Review / Finish when session resolved", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("Physical audit active");
    expect(form).toContain("Review / Finish count");
    expect(form).toContain("resolvedAuditSessionId");
    expect(form).toContain("ignoreCachedAuditSession");
  });

  it("ad-hoc path is not labeled as durable physical audit", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("Ad-hoc scan · not a durable physical audit");
    expect(form).toContain("Ad-hoc session");
    expect(form).not.toMatch(/Session Total: \{sessionTotal\}/);

    const section = readRepo("components/sections/ApplianceAuditSection.tsx");
    expect(section).toContain('scannerAuditMode === "adhoc"');
    expect(section).toContain("ignoreCachedAuditSession={scannerAuditMode === \"adhoc\"}");
  });

  it("audit-mode scans still pass audit_session_id; ad-hoc ignores cache", () => {
    const form = readRepo("components/sections/ApplianceScanForm.tsx");
    expect(form).toContain("audit_session_id: sessionId");
    expect(form).toContain("ignoreCachedAuditSession");
    expect(form).toContain("loadCachedActiveAuditSessionId");
  });

  it("Review / Finish still opens panel review token path", () => {
    const section = readRepo("components/sections/ApplianceAuditSection.tsx");
    expect(section).toContain("setReviewFinishToken");
    expect(section).toContain("reviewFinishToken={reviewFinishToken}");
  });
});
