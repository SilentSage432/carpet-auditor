/**
 * APP-QA-001 — Appliance surface reliability (export + Gemini anomaly removal).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applianceAuditExportCsv,
  buildApplianceAuditMailtoLink,
  canShareFiles,
  downloadTextFile,
  isShareAbortError,
  shareOrDownloadApplianceCsv,
  shareOrDownloadTextFile,
} from "@/lib/appliances/audit-export";
import { deriveApplianceVariance } from "@/lib/appliances/physical-audit";
import type { ApplianceScan } from "@/lib/types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function sampleScan(overrides: Partial<ApplianceScan> = {}): ApplianceScan {
  return {
    id: "scan-1",
    store_number: "1234",
    item_number: "1111111",
    serial_number: "SN1",
    location: "A1",
    location_type: "showroom",
    condition_tag: "NEW_BOXED",
    category: "Laundry",
    sub_category: "Washers",
    scanned_by: "DS",
    scanned_at: "2026-09-07T12:00:00.000Z",
    audit_session_id: null,
    ...overrides,
  };
}

describe("APP-QA-001 appliance home contracts", () => {
  const section = readRepo("components/sections/ApplianceAuditSection.tsx");
  const actionBar = readRepo("components/appliances/ApplianceAuditActionBar.tsx");
  const panel = readRepo("components/appliances/AppliancePhysicalAuditPanel.tsx");
  const settings = readRepo("components/sections/SettingsSection.tsx");
  const exportLib = readRepo("lib/appliances/audit-export.ts");

  it("primary physical audit CTA and secondary ad-hoc remain", () => {
    expect(section).toContain("Start Physical Audit");
    expect(section).toContain("Continue Physical Audit");
    expect(section).toContain("Ad-hoc scan (no audit)");
    expect(section).toContain("Manage appliance mappings");
    expect(section).toContain("AppliancePhysicalAuditPanel");
  });

  it("mapping management + reconciliation remain reachable", () => {
    expect(section).toContain("ApplianceCatalogManageSheet");
    expect(panel).toContain("Close physical audit");
    expect(panel).toContain("declared_lowes_oh");
    expect(panel).toContain("deriveApplianceVariance");
  });

  it("export / email / copy remain on action bar with failure feedback", () => {
    expect(actionBar).toContain("Share / Export CSV");
    expect(actionBar).toContain("shareOrDownloadApplianceCsv");
    expect(actionBar).toContain("Send Email");
    expect(actionBar).toContain("buildApplianceAuditMailtoLink");
    expect(actionBar).toContain("handleCopyCsv");
    expect(actionBar).toContain("Could not export CSV");
    expect(actionBar).toContain("Share cancelled");
    expect(section).toContain("downloadTextFile");
    expect(section).toContain("Inventory CSV downloaded");
  });

  it("scan log filters and expand/collapse remain", () => {
    expect(section).toContain("APPLIANCE_SCAN_LOG_FILTERS");
    expect(section).toContain("Expand");
    expect(section).toContain("Collapse");
    expect(section).toContain("matchesApplianceScanLogFilter");
  });

  it("appliance anomaly UI and Gemini path are absent from the home", () => {
    expect(section).not.toContain("ApplianceAnomalyWidget");
    expect(section).not.toContain("Scan Anomaly Detection");
    expect(section).not.toContain("/api/appliances/ai-anomaly");
    expect(exportLib).not.toContain("gemini");
  });

  it("UX-NAV Appliances path still navigates to operational home", () => {
    expect(settings).toContain("APPLIANCES_OPERATIONAL_HOME_HREF");
    expect(settings).toContain('data-testid="more-appliances-home"');
    expect(settings).not.toContain("requestApplianceScanner()");
  });
});

describe("APP-QA-001 share / export behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds observed-unit CSV content (not Lowe's OH fabrication)", () => {
    const csv = applianceAuditExportCsv([
      sampleScan(),
      sampleScan({ id: "scan-2", serial_number: "SN2" }),
    ]);
    expect(csv).toContain("Item Number");
    expect(csv).toContain("1111111");
    expect(csv).toContain("Quantity");
    expect(csv).toContain("2");
    expect(csv).not.toMatch(/Declared Lowes OH/i);
    expect(csv).not.toMatch(/\bshrink\b/i);
  });

  it("mailto export still builds a draft link", () => {
    const href = buildApplianceAuditMailtoLink([sampleScan()], {
      storeNumber: "1234",
    });
    expect(href.startsWith("mailto:")).toBe(true);
    expect(href).toContain("subject=");
    expect(href).toContain("body=");
  });

  it("download attaches the anchor to the document body", () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const append = vi.spyOn(document.body, "appendChild");
    const remove = vi.spyOn(document.body, "removeChild");
    const click = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", { value: click });
      }
      return el;
    });
    downloadTextFile("a,b\n1,2\n", "test.csv");
    expect(append).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("uses native file share when supported", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });
    const result = await shareOrDownloadTextFile("csv", {
      filename: "a.csv",
      title: "t",
    });
    expect(result).toBe("shared");
    expect(share).toHaveBeenCalled();
  });

  it("falls back to download when file share is unsupported", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      share: vi.fn(),
      canShare: vi.fn().mockReturnValue(false),
    });
    const append = vi.spyOn(document.body, "appendChild");
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", { value: vi.fn() });
      }
      return el;
    });
    const result = await shareOrDownloadApplianceCsv([sampleScan()]);
    expect(result).toBe("downloaded");
    expect(append).toHaveBeenCalled();
  });

  it("treats AbortError as cancelled, not silent success", async () => {
    expect(isShareAbortError(new DOMException("x", "AbortError"))).toBe(true);
    const share = vi.fn().mockRejectedValue(new DOMException("dismiss", "AbortError"));
    vi.stubGlobal("navigator", {
      share,
      canShare: vi.fn().mockReturnValue(true),
    });
    const result = await shareOrDownloadTextFile("csv", { filename: "a.csv" });
    expect(result).toBe("cancelled");
  });

  it("surfaces empty export as an error rather than swallowing", async () => {
    await expect(shareOrDownloadApplianceCsv([])).rejects.toThrow(
      /No appliance scans/
    );
  });

  it("canShareFiles stays false without navigator.share", () => {
    vi.stubGlobal("navigator", {});
    expect(canShareFiles(new File(["x"], "a.csv", { type: "text/csv" }))).toBe(
      false
    );
  });

  it("reconciliation variance remains deterministic", () => {
    expect(deriveApplianceVariance(5, 3)).toBe(2);
    expect(deriveApplianceVariance(2, 5)).toBe(-3);
    expect(deriveApplianceVariance(4, null)).toBeNull();
  });
});
