/**
 * APP-ROT-001 — Appliance audit consideration contracts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT,
  APPLIANCE_AUDIT_CONSIDERATION_METHOD,
  APPLIANCE_AUDIT_CONSIDERATION_STALE_THRESHOLD_DAYS,
  composeApplianceAuditConsiderations,
} from "@/lib/appliances/audit-consideration";

const root = path.resolve(__dirname, "../..");

function readRepo(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("APP-ROT-001 consideration contracts", () => {
  const composer = readRepo("lib/appliances/audit-consideration.ts");
  const panel = readRepo(
    "components/appliances/AppliancePhysicalAuditPanel.tsx"
  );
  const list = readRepo(
    "components/appliances/ApplianceAuditConsiderationList.tsx"
  );
  const route = readRepo(
    "app/api/appliances/audits/consideration/route.ts"
  );
  const client = readRepo("lib/appliances/audit-client.ts");
  const roadmap = readRepo("docs/product/APPLIANCE_EVOLUTION_ROADMAP.md");

  it("exposes method id and home limit without risk score or cadence", () => {
    expect(APPLIANCE_AUDIT_CONSIDERATION_METHOD).toBe(
      "appliance-audit-consideration-v1"
    );
    expect(APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT).toBe(5);
    expect(APPLIANCE_AUDIT_CONSIDERATION_STALE_THRESHOLD_DAYS).toBeNull();
    expect(composer).not.toMatch(/\briskScore\b|\bpriorityScore\b|"score"\s*:/);
    expect(composer).not.toMatch(/STALE_CLOSED_AUDIT/);
    expect(composer).toContain("appliance-audit-consideration-v1");
  });

  it("UI is advisory Consider checking again on Appliances physical audit home", () => {
    expect(panel).toContain("ApplianceAuditConsiderationList");
    expect(panel).toContain("fetchApplianceAuditConsiderations");
    expect(panel).toContain("openConsiderationHistory");
    expect(list).toContain("Consider checking again");
    expect(list).toContain("advisory only");
    expect(list).toContain('data-testid="appliance-audit-consideration"');
    expect(list).not.toMatch(/\bMust audit\b|\bHigh risk\b|\bRisk score:/i);
    expect(list).not.toContain("bottom-nav");
  });

  it("does not convert consideration into mandatory audit targets", () => {
    expect(panel).not.toContain("auditTargets");
    expect(panel).not.toContain("mandatoryTarget");
    expect(list).toContain("not a required target list");
    expect(client).toContain("fetchApplianceAuditConsiderations");
  });

  it("API composes from CLOSED sessions + snapshots without persistence", () => {
    expect(route).toContain("composeApplianceAuditConsiderations");
    expect(route).toContain('eq("status", "CLOSED")');
    expect(route).toContain("appliance_reconciliation_snapshots");
    expect(route).not.toMatch(/\.insert\(|\.upsert\(/);
  });

  it("keeps last observed distinct from closed audit in UI copy", () => {
    expect(list).toContain("last closed");
    expect(list).toContain("last observed");
    expect(composer).toContain("lastObservedAt");
    expect(composer).toContain("lastClosedAuditAt");
  });

  it("composer still quietly skips catalog-only and zero-variance-only", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [],
      scans: [],
      snapshots: [],
      catalog: [{ item_number: "ONLYCAT", description: "x" }],
    });
    expect(result.eligible_count).toBe(0);
  });

  it("roadmap records consideration (not Floor rotation engine)", () => {
    expect(roadmap).toMatch(/APP-ROT-001/);
    expect(roadmap).toMatch(/consideration|Consider checking again/i);
  });
});
