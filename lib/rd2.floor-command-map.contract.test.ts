/**
 * DEPTSYNC-RD-2 — Floor Command Map experience contracts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("RD-2 Floor Command Map", () => {
  it("MapTab is aisle-first geography without department pin chrome", () => {
    const map = readSrc("components/hub/tabs/MapTab.tsx");
    expect(map).toMatch(/Bay locator" : "Map"/);
    expect(map).toMatch(/Aisle → bay/);
    expect(map).toMatch(/hub-floor-command/);
    expect(map).toMatch(/fetchStoreLocationsDetailed\(member\)/);
    expect(map).toMatch(/fetchThisWeekRotations\(member\)/);
    expect(map).toMatch(/RD-1 Floor Command: Map is aisle/);
  });

  it("StoreLocationGrid uses aisle index → bay list → walk sheet", () => {
    const grid = readSrc("components/admin/StoreLocationGrid.tsx");
    expect(grid).toMatch(/map-aisle-navigator/);
    expect(grid).toMatch(/map-aisle-index/);
    expect(grid).toMatch(/map-aisle-detail/);
    expect(grid).toMatch(/map-aisle-back/);
    expect(grid).toMatch(/map-bay-list/);
    expect(grid).toMatch(/map-show-retired/);
    expect(grid).toMatch(/map-aisle-search/);
    expect(grid).toMatch(/map-empty-state/);
    expect(grid).toMatch(/composeMapAisleIndex/);
    expect(grid).toMatch(/canMutate=\{false\}/);
    expect(grid).toMatch(/WalkTheFloorSheet/);
    expect(grid).toMatch(/bay-surface-presence/);
    expect(grid).not.toMatch(/toggleDept/);
    expect(grid).not.toMatch(/openDepts/);
  });

  it("bay detail reserves Operational Section slot without storage", () => {
    const sheet = readSrc("components/admin/WalkTheFloorSheet.tsx");
    expect(sheet).toMatch(/walk-sheet-section-slot/);
    expect(sheet).toMatch(/Operational section/);
    expect(sheet).toMatch(/not stored in this release/);
  });

  it("Bulk Clean-Up prefers retire over destructive delete", () => {
    const bulk = readSrc("components/admin/BulkLocationGenerator.tsx");
    expect(bulk).toMatch(/CleanupAction = "retire" \| "delete"/);
    expect(bulk).toMatch(/useState<CleanupAction>\("retire"\)/);
    expect(bulk).toMatch(/bulk-cleanup-action/);
    expect(bulk).toMatch(/is_active: false/);
  });

  it("preserves route and auth boundaries (no engine rewrite)", () => {
    const map = readSrc("components/hub/tabs/MapTab.tsx");
    expect(map).toMatch(/StoreLocationGrid/);
    expect(map).not.toMatch(/selectPhysicalBayCoverage/);
    expect(map).not.toMatch(/sunday-dispatch/);
    const nav = readSrc("lib/nav-hub.ts");
    expect(nav).toMatch(/\/admin\/store-map/);
  });
});
