/**
 * DEPTSYNC-SECTION-UX-002 — named zone compatibility contracts.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  formatAisleDisplayLabel,
  isNumericAisleCode,
  isValidAisle,
  normalizeAisle,
} from "./aisle";
import { locationDedupeAisleKey } from "./locations";
import { formatBayTag } from "./types";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("SECTION-UX-002 aisle / zone identity", () => {
  it("accepts numeric and alphanumeric zone codes", () => {
    expect(isValidAisle("41")).toBe(true);
    expect(isValidAisle("show-l")).toBe(true);
    expect(normalizeAisle("show-l")).toBe("SHOW-L");
    expect(normalizeAisle("carpet-wall")).toBe("CARPET-WALL");
    expect(normalizeAisle("CLOTHING")).toBe("CLOTHING");
    expect(isValidAisle("")).toBe(false);
    expect(isNumericAisleCode("41")).toBe(true);
    expect(isNumericAisleCode("SHOW-L")).toBe(false);
  });

  it("formats display labels without inventing fake numeric aisles", () => {
    expect(formatAisleDisplayLabel("5")).toBe("Aisle 5");
    expect(formatAisleDisplayLabel("SHOW-R")).toBe("SHOW-R");
    expect(formatAisleDisplayLabel("CLOTHING")).toBe("CLOTHING");
    expect(formatBayTag({ aisle: "CARPET-WALL", bay: 3 })).toBe(
      "CARPET-WALL-B03"
    );
    expect(formatBayTag({ aisle: "42", bay: 7 })).toBe("A42-B07");
  });

  it("dedupe key preserves named zones (only collapses numeric padding)", () => {
    expect(locationDedupeAisleKey("012")).toBe("12");
    expect(locationDedupeAisleKey("SHOW-L")).toBe("SHOW-L");
    expect(locationDedupeAisleKey("CARPET-WALL")).toBe("CARPET-WALL");
  });
});

describe("SECTION-UX-002 source contracts", () => {
  it("Bulk Generator invites named zones and does not default aisle to 1", () => {
    const bulk = readRepo("components/admin/BulkLocationGenerator.tsx");
    expect(bulk).toMatch(/SHOW-L|CARPET-WALL|named zone/i);
    expect(bulk).toMatch(/useState\(""\)/);
    expect(bulk).toMatch(/type="text"/);
    expect(bulk).toMatch(/inputMode="text"/);
    expect(bulk).not.toMatch(/parseInt\(.*aisle/);
  });

  it("Map and Manage use shared aisle/zone display labels", () => {
    const mapNav = readRepo("lib/store-ops/map-aisle-navigation.ts");
    const manage = readRepo("components/admin/AisleBayManager.tsx");
    expect(mapNav).toMatch(/formatAisleDisplayLabel/);
    expect(manage).toMatch(/formatAisleDisplayLabel/);
    expect(manage).not.toMatch(/Back Wall/);
  });

  it("does not wire joint stewardship or section-aware auto-stage", () => {
    const panel = readRepo("components/admin/OperationalSectionsPanel.tsx");
    expect(panel).toMatch(/Joint stewardship[\s\S]*not available yet/i);
    expect(panel).not.toMatch(/SECTION_AWARE_ROTATION_AUTO_STAGE\s*=\s*true/);
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).not.toMatch(/section-aware-rotation/);
  });

  it("SECTION-UX-001 discoverable bays remain explicit inclusion", () => {
    const panel = readRepo("components/admin/OperationalSectionsPanel.tsx");
    expect(panel).toMatch(/sections-discoverable-bays/);
    expect(panel).toMatch(/Not added[\s\S]*automatically/);
    expect(panel).toMatch(/countDiscoverableBaysForSection/);
  });
});
