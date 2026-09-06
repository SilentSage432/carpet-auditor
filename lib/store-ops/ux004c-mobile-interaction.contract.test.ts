/**
 * UX-004C mobile interaction reliability — structural contracts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  requestApplianceScanner,
  requestExecutiveFloorPad,
  requestRemnantCalculator,
  APPLIANCE_SCANNER_OPEN_EVENT,
  REMNANT_CALCULATOR_OPEN_EVENT,
  EXECUTIVE_FLOOR_PAD_OPEN_EVENT,
  EXECUTIVE_FLOOR_PAD_HASH,
} from "@/lib/specialty-tools";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("UX-004C Floor bay filters", () => {
  it("uses a mobile 2×2 grid without horizontal-scroll-only discovery", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toContain('data-testid="floor-bay-filters"');
    expect(floor).toContain("grid grid-cols-2");
    expect(floor).not.toMatch(
      /data-testid="floor-bay-filters"[\s\S]{0,200}overflow-x-auto/
    );
    for (const id of ["all", "mine", "attention", "completed"]) {
      expect(floor).toContain(`id: "${id}"`);
    }
  });
});

describe("UX-004C bottom nav / sheet clearance", () => {
  it("active keep-alive panel stays beneath fixed bottom nav; sheets portal above", () => {
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(shell).toMatch(/active \? "z-10"/);
    expect(shell).not.toMatch(/active \? "z-40"/);
    const css = readRepo("app/globals.css");
    expect(css).toContain(".hub-bottom-nav");
    expect(css).toMatch(/z-30/);
    expect(css).toContain(".hub-modal-sheet");
    expect(css).toContain("safe-area-inset-bottom");
    const portal = readRepo("components/hub/HubPortal.tsx");
    expect(portal).toContain("createPortal");
    expect(portal).toContain("document.body");
  });

  it("Map bay detail and Bulk Generator sheets use HubPortal + hub-modal-sheet", () => {
    const walk = readRepo("components/admin/WalkTheFloorSheet.tsx");
    const aisle = readRepo("components/admin/AisleBayManager.tsx");
    expect(walk).toContain("HubPortal");
    expect(walk).toContain("hub-modal-sheet");
    expect(aisle).toContain("HubPortal");
    expect(aisle).toContain("hub-modal-sheet");
  });
});

describe("UX-004C More Floor Utilities destinations", () => {
  it("hosts specialty tools outside keep-alive inert panels", () => {
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(shell).toContain("SpecialtyToolsHost");
    const host = readRepo("components/hub/SpecialtyToolsHost.tsx");
    expect(host).toContain("APPLIANCE_SCANNER_OPEN_EVENT");
    expect(host).toContain("REMNANT_CALCULATOR_OPEN_EVENT");
    expect(host).toContain("ApplianceScannerModal");
    expect(host).toContain("RemnantCalculatorModal");
    expect(host).not.toContain("pointer-events-none");
  });

  it("More buttons invoke canonical specialty request helpers", () => {
    const settings = readRepo("components/sections/SettingsSection.tsx");
    expect(settings).toContain('data-testid="more-scan-count-appliances"');
    expect(settings).toContain('data-testid="more-remnant-calculator"');
    expect(settings).toContain('data-testid="more-executive-floor-pad"');
    expect(settings).toContain("requestApplianceScanner()");
    expect(settings).toContain("requestRemnantCalculator()");
    expect(settings).toContain("requestExecutiveFloorPad()");
    expect(settings).not.toMatch(
      /href="\/dashboard#floor-pad"/
    );
  });

  it("request helpers dispatch the expected window events", () => {
    const seen: string[] = [];
    const handler = (e: Event) => seen.push(e.type);
    window.addEventListener(APPLIANCE_SCANNER_OPEN_EVENT, handler);
    window.addEventListener(REMNANT_CALCULATOR_OPEN_EVENT, handler);
    window.addEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, handler);
    try {
      requestApplianceScanner();
      requestRemnantCalculator();
      // On /dashboard path in jsdom — hash + event
      window.history.pushState({}, "", `/dashboard#other`);
      requestExecutiveFloorPad();
      expect(seen).toContain(APPLIANCE_SCANNER_OPEN_EVENT);
      expect(seen).toContain(REMNANT_CALCULATOR_OPEN_EVENT);
      expect(seen).toContain(EXECUTIVE_FLOOR_PAD_OPEN_EVENT);
      expect(window.location.hash.replace(/^#/, "")).toBe(
        EXECUTIVE_FLOOR_PAD_HASH
      );
    } finally {
      window.removeEventListener(APPLIANCE_SCANNER_OPEN_EVENT, handler);
      window.removeEventListener(REMNANT_CALCULATOR_OPEN_EVENT, handler);
      window.removeEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, handler);
    }
  });

  it("RemnantSection no longer owns the global remnant-open event (host does)", () => {
    const remnant = readRepo("components/sections/RemnantSection.tsx");
    expect(remnant).not.toContain("REMNANT_CALCULATOR_OPEN_EVENT");
  });
});
