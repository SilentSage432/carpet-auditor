/**
 * UX-005C — Floor operational simplicity (presentation / information architecture).
 *
 * Contract: when the Floor drawer opens, shift actions come first and reports
 * sit behind one nested "Reports & insights" disclosure. No engine, API,
 * schema, persistence, or appliance behaviour may move in this tranche.
 *
 * AMENDED by SNAP-RETIRE-001: the drawer opened on six actions when UX-005C
 * shipped. The sixth, Snap Bay Photo, was the sole entry into the persisting
 * Bay Audit Validate path, and SNAP-DECISION-001 retired that capability. The
 * drawer now opens on five. Ordering, the single nested disclosure, the
 * full-width stacking, and every other UX-005C guarantee are unchanged.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const floor = readRepo("components/hub/tabs/FloorTab.tsx");
const drawer = readRepo("components/store-ops/ShiftAnalyticsDrawer.tsx");
const healthCard = readRepo("components/StoreHealthCard.tsx");

/** Body of the drawer's primary action block. */
const actionsIdx = floor.indexOf('data-testid="floor-drawer-actions"');
const reportsIdx = floor.indexOf("<ShiftAnalyticsReportsGroup");
const actionsSlice = floor.slice(actionsIdx, reportsIdx);
const reportsSlice = floor.slice(
  reportsIdx,
  floor.indexOf("</ShiftAnalyticsReportsGroup>", reportsIdx)
);

/** Ordered markers for the five primary shift actions (six before SNAP-RETIRE-001). */
const PRIMARY_ACTIONS: Array<{ label: string; marker: string }> = [
  { label: "Walk & Talk Floor Pad", marker: "<TacticalVoiceFloorPad" },
  { label: "Flag Downstock", marker: "setDownstockOpen(true)" },
  { label: "Showroom Quick Touch", marker: "<ShowroomQuickTouchCard" },
  { label: "Predictive Copilot", marker: "<PredictiveCopilotBanner" },
  { label: "Weekly Audit Rollup", marker: "Weekly audit rollup" },
];

/** Ordered markers for the reports behind the nested disclosure. */
const REPORTS: Array<{ label: string; marker: string }> = [
  { label: "Audit Velocity", marker: "<StoreHealthChart" },
  { label: "Store Health", marker: "<StoreHealthCard" },
  { label: "Shift Briefing", marker: "<ShiftBriefingCard" },
  { label: "Exception Feed", marker: "<ExceptionFeed" },
];

describe("UX-005C primary action hierarchy", () => {
  it("locates the drawer action block ahead of the reports group", () => {
    expect(actionsIdx, "floor-drawer-actions marker missing").toBeGreaterThan(-1);
    expect(reportsIdx, "ShiftAnalyticsReportsGroup missing").toBeGreaterThan(-1);
    expect(actionsIdx).toBeLessThan(reportsIdx);
  });

  it("orders the five shift actions Walk & Talk → Weekly Audit Rollup", () => {
    const positions = PRIMARY_ACTIONS.map((action) => {
      const idx = actionsSlice.indexOf(action.marker);
      expect(idx, `${action.label}: missing from drawer actions`).toBeGreaterThan(
        -1
      );
      return { ...action, idx };
    });

    for (let i = 1; i < positions.length; i += 1) {
      expect(
        positions[i - 1].idx,
        `${positions[i - 1].label} must precede ${positions[i].label}`
      ).toBeLessThan(positions[i].idx);
    }
  });

  it("no longer hosts the retired Snap Bay action (SNAP-RETIRE-001)", () => {
    // UX-005C demoted it to last; SNAP-DECISION-001 then retired the capability.
    expect(actionsSlice).not.toContain("Snap Bay Photo");
    expect(floor).not.toContain("setBayScanOpen");
    expect(floor).not.toContain("<VisualBayScannerModal");
    expect(floor).not.toContain("onAuditValidated");
    expect(floor).not.toContain("auditContext");
    // The shared ephemeral scanner survives for its other mounts.
    expect(
      existsSync(path.join(root, "components/store-ops/VisualBayScannerModal.tsx"))
    ).toBe(true);
  });

  it("keeps actions stacked full-width rather than in a horizontal strip", () => {
    expect(actionsSlice).not.toContain("grid-cols-2");
    expect(actionsSlice).not.toContain("overflow-x-auto");
    // Touch targets stay comfortable on a phone.
    expect(actionsSlice).toMatch(/min-h-1[12] w-full/);
  });
});

describe("UX-005C Reports & insights disclosure", () => {
  it("exists in field language and is collapsed on every mount", () => {
    expect(drawer).toContain("export function ShiftAnalyticsReportsGroup");
    expect(drawer).toContain("Reports &amp; insights");
    expect(drawer).toMatch(
      /ShiftAnalyticsReportsGroup[\s\S]{0,400}useState\(false\)/
    );
    expect(drawer).toMatch(
      /ShiftAnalyticsReportsGroup[\s\S]{0,600}aria-expanded=\{open\}/
    );
  });

  it("does not persist its open state", () => {
    expect(drawer).not.toContain("localStorage");
    expect(drawer).not.toContain("sessionStorage");
    expect(drawer).not.toContain("indexedDB");
  });

  it("exposes exactly the four reports in order when expanded", () => {
    const positions = REPORTS.map((report) => {
      const idx = reportsSlice.indexOf(report.marker);
      expect(idx, `${report.label}: missing from reports group`).toBeGreaterThan(
        -1
      );
      return { ...report, idx };
    });

    for (let i = 1; i < positions.length; i += 1) {
      expect(
        positions[i - 1].idx,
        `${positions[i - 1].label} must precede ${positions[i].label}`
      ).toBeLessThan(positions[i].idx);
    }
  });

  it("keeps Exception Feed present and authoritative in this drawer", () => {
    expect(reportsSlice).toContain("<ExceptionFeed");
    expect(reportsSlice).toContain("specialist={specialist}");
    expect(floor).toContain(
      'import { ExceptionFeed } from "@/components/admin/ExceptionFeed"'
    );
  });

  it("adds only one nested disclosure level inside the drawer", () => {
    const expandables = drawer.match(/aria-expanded/g) ?? [];
    expect(expandables.length).toBe(2);
    // The outer drawer still owns the global open mechanism unchanged.
    expect(drawer).toContain("EXECUTIVE_FLOOR_PAD_OPEN_EVENT");
    expect(drawer).toContain("FLOOR_PAD_HASHES");
    // No new global accordion framework was introduced.
    expect(existsSync(path.join(root, "components/ui/Accordion.tsx"))).toBe(false);
  });
});

describe("UX-005C duplicate presentation removal", () => {
  it("no longer renders BayFreshnessGrid from the Floor drawer", () => {
    expect(floor).not.toContain("<BayFreshnessGrid");
    expect(floor).not.toContain("BayFreshnessGrid");
    expect(drawer).not.toContain("BayFreshnessGrid");
  });

  it("keeps the BayFreshnessGrid component and freshness math in the repository", () => {
    expect(
      existsSync(path.join(root, "components/dashboard/BayFreshnessGrid.tsx"))
    ).toBe(true);
    expect(readRepo("components/dashboard/BayFreshnessGrid.tsx")).toContain(
      "composeBayFreshness"
    );
  });

  it("preserves Floor's own freshness/attention context outside the drawer", () => {
    expect(floor).toContain('data-testid="floor-readiness-line"');
    expect(floor).toContain("composeFloorFreshnessLine");
    expect(floor).toContain("composeBayFreshness");
    expect(floor).toContain("<FloorAttentionSummary");
  });

  it("suppresses Store Health logged barriers inside this drawer only", () => {
    expect(reportsSlice).toContain("showLoggedBarriers={false}");
    expect(healthCard).toContain("showLoggedBarriers?: boolean");
    expect(healthCard).toContain("showLoggedBarriers = true");
    expect(healthCard).toContain(
      "{showLoggedBarriers && barriers.length > 0 ? ("
    );
  });

  it("leaves Store Health defaults and calculations untouched elsewhere", () => {
    // Every other call site keeps the default (barriers visible).
    const otherCallSites = [
      "components/sections/DepartmentAuditSection.tsx",
      "components/sections/CycleAuditSection.tsx",
    ].filter((file) => existsSync(path.join(root, file)));
    for (const file of otherCallSites) {
      expect(readRepo(file)).not.toContain("showLoggedBarriers");
    }
    // Derivation still comes from the canonical snapshot, not the card.
    expect(healthCard).toContain("fetchStoreHealth(specialist)");
    expect(healthCard).toContain("const barriers = data.barriers;");
  });
});

describe("UX-005C preserved wiring", () => {
  it("keeps every surviving action callback and host modal intact", () => {
    for (const wiring of [
      "onApplied={silentRefresh}",
      "onTouched={() => setHealthKey((k) => k + 1)}",
      "onFlagged={silentRefresh}",
      "onReviewed={silentRefresh}",
      "<SupervisorAuditSummaryModal",
      "<FlagDownstockSheet",
    ]) {
      expect(floor, `${wiring} must remain wired`).toContain(wiring);
    }
  });

  it("keeps the associate-simplified guards on the same surfaces", () => {
    for (const marker of [
      "<TacticalVoiceFloorPad",
      "<ShowroomQuickTouchCard",
      "<PredictiveCopilotBanner",
      "<StoreHealthChart",
      "<StoreHealthCard",
      "<ExceptionFeed",
    ]) {
      const idx = floor.indexOf(marker);
      expect(floor.slice(Math.max(0, idx - 400), idx)).toContain("simplified");
    }
    // Rollup remains supervisor-gated.
    expect(floor).toContain("supervisor && !simplified");
  });

  it("does not change bottom navigation or Map/Roster/More IA", () => {
    const nav = readRepo("lib/nav-hub.ts");
    expect(nav).toContain('shortLabel: "Floor"');
    expect(nav).toContain('shortLabel: "Map"');
    expect(nav).toContain('shortLabel: "Roster"');
    expect(nav).toContain('shortLabel: "More"');
    const bottom = readRepo("components/hub/BottomNav.tsx");
    expect(bottom).not.toContain("Reports");
    expect(bottom).not.toContain("ShiftAnalytics");
    // Reports live inside the Floor drawer — never as their own destination.
    expect(existsSync(path.join(root, "app/reports"))).toBe(false);
    expect(floor).toContain("buildMapCurrentAttentionHref");
  });
});

describe("UX-005C scope boundaries", () => {
  it("does not touch appliance code from the changed presentation files", () => {
    for (const source of [drawer, healthCard]) {
      expect(source).not.toMatch(/appliance/i);
    }
    // FloorTab's pre-existing SIMS ledger is unchanged and stays out of the drawer.
    expect(floor).toContain("fetchApplianceCatalog");
    expect(floor).toContain("fetchApplianceScans");
    expect(actionsSlice).not.toMatch(/appliance/i);
    expect(reportsSlice).not.toMatch(/appliance/i);
  });

  it("does not implement WALK-001 shift walk task read-back", () => {
    for (const source of [floor, drawer]) {
      expect(source).not.toContain("fetchShiftWalkTasks");
      expect(source).not.toContain("openShiftWalkTasks");
      expect(source).not.toContain("resolveShiftWalkTask");
      expect(source).not.toContain("shift_walk_tasks");
    }
    // Walk & Talk keeps its existing write-only dispatch path.
    expect(readRepo("components/dashboard/TacticalVoiceFloorPad.tsx")).toContain(
      "dispatchShiftWalkTasks"
    );
  });

  it("keeps Walk & Talk and Executive Floor Pad as distinct features", () => {
    const pad = readRepo("components/dashboard/TacticalVoiceFloorPad.tsx");
    expect(pad).toContain("EXECUTIVE_FLOOR_PAD_OPEN_EVENT");
    expect(floor).toContain("<ExecutiveFloorPadIntentBridge");
    expect(floor).toContain("<TacticalVoiceFloorPad");
  });

  it("introduces no API, schema, or Gemini call sites in this tranche", () => {
    for (const source of [drawer, healthCard]) {
      expect(source).not.toContain("/api/");
      expect(source).not.toContain("gemini");
      expect(source).not.toContain("supabase");
    }
  });
});
