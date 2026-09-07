/**
 * UX-005A — Appliances operational home simplification (presentation / IA).
 * One canonical physical-audit spine; secondary tools demoted, not deleted.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function readRepo(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("UX-005A Appliances operational home", () => {
  const section = readRepo("components/sections/ApplianceAuditSection.tsx");
  const panel = readRepo(
    "components/appliances/AppliancePhysicalAuditPanel.tsx"
  );
  const actionBar = readRepo(
    "components/appliances/ApplianceAuditActionBar.tsx"
  );
  const list = readRepo(
    "components/appliances/ApplianceAuditConsiderationList.tsx"
  );
  const form = readRepo("components/sections/ApplianceScanForm.tsx");
  const quick = readRepo("components/barcode/QuickAddApplianceModal.tsx");

  it("exposes one primary Start Physical Audit CTA on the panel when idle", () => {
    expect(panel).toContain('data-testid="start-physical-audit"');
    expect(panel).toContain("Start Physical Audit");
    expect(panel).toContain("startAppliancePhysicalAudit");
    const startCount = (panel.match(/data-testid="start-physical-audit"/g) ?? [])
      .length;
    expect(startCount).toBe(1);
  });

  it("does not duplicate competing Start / Continue CTAs on the section", () => {
    expect(section).not.toContain("handleStartPhysicalAudit");
    expect(section).not.toMatch(
      /btn-primary-glow[\s\S]{0,120}Start Physical Audit/
    );
    expect(section).not.toContain("Continue Physical Audit");
    expect(section).toContain("AppliancePhysicalAuditPanel");
  });

  it("active audit exposes Continue scanning and Review count on the panel", () => {
    expect(panel).toContain('data-testid="continue-physical-audit"');
    expect(panel).toContain("Continue scanning");
    expect(panel).toContain('data-testid="review-physical-count"');
    expect(panel).toContain("Review count");
    expect(panel).toContain('data-testid="close-physical-count"');
    expect(panel).toContain("onContinueScanning");
    expect(section).toContain("onContinueScanning=");
    expect(section).toContain("openScannerWithActiveAudit");
  });

  it("just-closed state surfaces Reconcile with Lowe's prominently", () => {
    expect(panel).toContain('data-testid="awaiting-reconciliation-banner"');
    expect(panel).toContain("Reconcile with Lowe");
    expect(panel).toContain("setHighlightClosedId(closed.id)");
    expect(panel).toContain('openRecon: true');
  });

  it("ad-hoc scan remains accessible but secondary under More appliance tools", () => {
    expect(section).toContain('data-testid="more-appliance-tools"');
    expect(section).toContain("More appliance tools");
    expect(section).toContain("Ad-hoc scan (no audit)");
    expect(section).toContain('data-testid="adhoc-appliance-scan"');
    expect(section).toContain('scannerAuditMode === "adhoc"');
    expect(section).toContain(
      'ignoreCachedAuditSession={scannerAuditMode === "adhoc"}'
    );
    const moreIdx = section.indexOf('data-testid="more-appliance-tools"');
    const adhocIdx = section.indexOf('data-testid="adhoc-appliance-scan"');
    expect(moreIdx).toBeGreaterThan(-1);
    expect(adhocIdx).toBeGreaterThan(moreIdx);
  });

  it("Manage mappings remains accessible but secondary", () => {
    expect(section).toContain("Manage appliance mappings");
    expect(section).toContain('data-testid="manage-appliance-mappings"');
    expect(section).toContain("ApplianceCatalogManageSheet");
    const moreIdx = section.indexOf('data-testid="more-appliance-tools"');
    const manageIdx = section.indexOf('data-testid="manage-appliance-mappings"');
    expect(manageIdx).toBeGreaterThan(moreIdx);
  });

  it("scanner unknown-item teach path is unchanged", () => {
    expect(form).toContain("QuickAddApplianceModal");
    expect(form).toContain("setQuickAddBarcode");
    expect(quick).toContain("Link to existing item");
    expect(quick).toContain("Create new item");
    expect(form).toContain("Review / Finish count");
  });

  it("action-bar capabilities remain reachable inside More appliance tools", () => {
    expect(section).toContain("ApplianceAuditActionBar");
    expect(actionBar).toContain("Share / Export CSV");
    expect(actionBar).toContain("Send Email");
    expect(actionBar).toContain("Copy CSV");
    expect(actionBar).toContain("Clear scan ledger");
    expect(actionBar).toContain("Lock Showroom Baseline");
    const moreBlock = section.slice(
      section.indexOf('data-testid="more-appliance-tools"')
    );
    expect(moreBlock).toContain("<ApplianceAuditActionBar");
  });

  it("scan log and inventory CSV remain reachable behind disclosure", () => {
    expect(section).toContain('data-testid="view-appliance-scans"');
    expect(section).toContain("View scan log");
    expect(section).toContain('data-testid="appliance-scan-log"');
    expect(section).toContain("Download CSV Inventory");
    expect(section).toContain("downloadTextFile");
    expect(section).toContain("Inventory CSV downloaded");
  });

  it("consideration list stays advisory and hidden when empty", () => {
    expect(panel).toContain("ApplianceAuditConsiderationList");
    expect(list).toContain("Consider checking again");
    expect(list).toContain("advisory only");
    expect(list).toContain("eligibleCount === 0 || items.length === 0");
    expect(list).toContain("return null");
  });

  it("unsynced warning and close safeguards remain intact", () => {
    expect(panel).toContain('data-testid="unsynced-audit-warning"');
    expect(panel).toContain("unsynced observation");
    expect(panel).toContain("sync before closing");
    expect(panel).toContain("closeAppliancePhysicalAudit");
    expect(panel).toContain("getPendingApplianceScanSyncForAudit");
  });

  it("avoids Phase/lifecycle teaching copy on the home panel", () => {
    expect(panel).not.toContain("Phase 1");
    expect(panel).not.toContain("Phase 2");
    expect(panel).not.toMatch(/state-machine/i);
  });

  it("panel owns the canonical start path; section opens scanner via onStarted", () => {
    expect(panel).toContain("onStarted?.(session)");
    expect(section).toContain("onStarted=");
    expect(section).toContain('setScannerAuditMode("audit")');
    expect(section).toContain("setScannerOpen(true)");
    expect(section).toContain("setReviewFinishToken");
  });
});
