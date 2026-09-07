/**
 * APP-AUD-002A — Lifecycle clarity & recent history (Option A).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIANCE_RECENT_CLOSED_AUDIT_LIMIT,
  composeApplianceReconciliationProgress,
  formatAppliancePhysicalAuditStatus,
  formatApplianceReconciliationPhase,
  type ApplianceReconciliationSnapshot,
} from "@/lib/appliances/physical-audit";

const root = path.resolve(__dirname, "../..");

function readRepo(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function snap(
  partial: Partial<ApplianceReconciliationSnapshot> &
    Pick<ApplianceReconciliationSnapshot, "item_number">
): ApplianceReconciliationSnapshot {
  return {
    id: `snap-${partial.item_number}`,
    audit_session_id: "audit-1",
    store_number: "1234",
    physical_count: 1,
    declared_lowes_oh: null,
    variance: null,
    outcome: null,
    notes: "",
    reconciled_by: "",
    reconciled_at: "",
    ...partial,
  };
}

describe("APP-AUD-002A reconciliation progress derivation", () => {
  it("treats missing Lowe's OH as unreconciled (not zero)", () => {
    const progress = composeApplianceReconciliationProgress(
      [{ item_number: "111" }, { item_number: "222" }],
      [snap({ item_number: "111", declared_lowes_oh: 2, variance: -1 })]
    );
    expect(progress.audited_item_count).toBe(2);
    expect(progress.with_declared_oh).toBe(1);
    expect(progress.without_declared_oh).toBe(1);
    expect(progress.all_oh_entered).toBe(false);
    expect(progress.phase).toBe("reconciliation_in_progress");
  });

  it("derives non-zero variance and outcome counts truthfully", () => {
    const progress = composeApplianceReconciliationProgress(
      [{ item_number: "A" }, { item_number: "B" }, { item_number: "C" }],
      [
        snap({
          item_number: "A",
          declared_lowes_oh: 1,
          variance: 0,
          outcome: "RESOLVED",
        }),
        snap({
          item_number: "B",
          declared_lowes_oh: 2,
          variance: -1,
          outcome: "NEEDS_FOLLOW_UP",
        }),
        snap({ item_number: "C" }),
      ]
    );
    expect(progress.non_zero_variance).toBe(1);
    expect(progress.resolved_count).toBe(1);
    expect(progress.needs_follow_up_count).toBe(1);
    expect(progress.phase).toBe("reconciliation_in_progress");
  });

  it("marks reconciliation entered only when every item has OH", () => {
    const progress = composeApplianceReconciliationProgress(
      [{ item_number: "A" }, { item_number: "B" }],
      [
        snap({ item_number: "A", declared_lowes_oh: 1, variance: 0 }),
        snap({ item_number: "B", declared_lowes_oh: 0, variance: 1 }),
      ]
    );
    expect(progress.all_oh_entered).toBe(true);
    expect(progress.phase).toBe("reconciliation_entered");
    expect(formatApplianceReconciliationPhase(progress.phase)).toBe(
      "Reconciliation entered"
    );
  });

  it("CLOSED language does not claim reconciliation complete", () => {
    expect(formatAppliancePhysicalAuditStatus("ACTIVE")).toBe(
      "Physical audit active"
    );
    expect(formatAppliancePhysicalAuditStatus("CLOSED")).toBe(
      "Physical count closed"
    );
    expect(formatAppliancePhysicalAuditStatus("CLOSED")).not.toMatch(
      /complete/i
    );
  });

  it("awaits reconciliation when no OH rows exist", () => {
    const progress = composeApplianceReconciliationProgress(
      [{ item_number: "A" }],
      []
    );
    expect(progress.phase).toBe("awaiting_reconciliation");
    expect(progress.with_declared_oh).toBe(0);
  });
});

describe("APP-AUD-002A UI contracts", () => {
  const panel = readRepo("components/appliances/AppliancePhysicalAuditPanel.tsx");
  const form = readRepo("components/sections/ApplianceScanForm.tsx");
  const section = readRepo("components/sections/ApplianceAuditSection.tsx");
  const settings = readRepo("components/sections/SettingsSection.tsx");
  const route = readRepo("app/api/appliances/audits/[id]/route.ts");

  it("ACTIVE language is distinct from CLOSED physical-count language", () => {
    expect(panel).toContain("Physical audit active");
    expect(panel).toContain("Close physical count");
    expect(panel).toContain("Physical count closed");
    expect(panel).toContain("awaiting reconciliation");
    expect(panel).toContain("formatApplianceReconciliationPhase");
    expect(panel).toContain("Closing is not reconciliation complete");
    expect(form).toContain("Review / Finish count");
    expect(formatApplianceReconciliationPhase("awaiting_reconciliation")).toBe(
      "Awaiting reconciliation"
    );
  });

  it("CLOSED does not imply reconciliation complete", () => {
    expect(panel).toContain("Closing is not reconciliation complete");
    expect(panel).toContain("formatApplianceReconciliationPhase");
    expect(readRepo("lib/appliances/physical-audit.ts")).toContain(
      "Reconciliation entered"
    );
    expect(readRepo("lib/appliances/physical-audit.ts")).not.toMatch(
      /reconciliation complete/i
    );
  });

  it("recent history uses configured small set; full history reachable", () => {
    expect(APPLIANCE_RECENT_CLOSED_AUDIT_LIMIT).toBe(5);
    expect(panel).toContain("APPLIANCE_RECENT_CLOSED_AUDIT_LIMIT");
    expect(panel).toContain('data-testid="recent-physical-audits"');
    expect(panel).toContain('data-testid="view-all-audit-history"');
    expect(panel).toContain('data-testid="full-audit-history"');
    expect(panel).not.toContain("deleteApplianceAudit");
    expect(panel).not.toContain(".delete(");
  });

  it("newly closed audit is easy to reach for reconciliation", () => {
    expect(panel).toContain('data-testid="awaiting-reconciliation-banner"');
    expect(panel).toContain("Reconcile with Lowe");
    expect(panel).toContain("setHighlightClosedId(closed.id)");
    expect(panel).toContain('data-testid="start-physical-audit"');
  });

  it("export does not mutate lifecycle state", () => {
    expect(panel).toContain("lifecycle unchanged");
    expect(panel).toContain("shareOrDownloadTextFile");
    expect(panel).not.toMatch(/handleExport[\s\S]{0,400}status:\s*[\"']CLOSED/);
  });

  it("reconciliation edits are labeled as current record only", () => {
    expect(panel).toContain("current reconciliation record");
    expect(panel).toContain("observed physical counts stay frozen");
  });

  it("detail API exposes derived reconciliation progress", () => {
    expect(route).toContain("composeApplianceReconciliationProgress");
    expect(route).toContain("reconciliation: progress");
  });

  it("Start Physical Audit remains on home after close path", () => {
    expect(panel).toContain("setActive(null)");
    expect(panel).toContain("onActiveSessionChange(null)");
    expect(panel).toContain("Start Physical Audit");
    expect(section).toContain("AppliancePhysicalAuditPanel");
  });

  it("UX-NAV canonical Appliances path remains intact", () => {
    expect(settings).toContain("APPLIANCES_OPERATIONAL_HOME_HREF");
    expect(settings).toContain('data-testid="more-appliances-home"');
  });
});
