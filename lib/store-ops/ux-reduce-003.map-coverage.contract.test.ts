/**
 * UX-REDUCE-003 — Map department coverage UI contracts (source + presentation).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countPhysicalBays,
  formatPhysicalBayCount,
  mapCoverageToneLabel,
} from "./map-coverage-presentation";
import { mapReadinessLabel } from "./map-readiness";
import type { StoreLocation } from "./types";

const root = join(__dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function loc(
  partial: Partial<StoreLocation> &
    Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay" | "type">
): StoreLocation {
  return {
    store_id: "s1",
    status: "PENDING",
    is_active: true,
    cycle_number: 1,
    last_completed_at: null,
    location_type: "STANDARD",
    ...partial,
  } as StoreLocation;
}

describe("UX-REDUCE-003 Map department coverage contracts", () => {
  it("MapTab is department coverage first; velocity is advanced disclosure", () => {
    const map = readSrc("components/hub/tabs/MapTab.tsx");
    expect(map).toMatch(/Department coverage/);
    expect(map).toMatch(/map-advanced-service-cadence/);
    expect(map).toMatch(/Service cadence/);
    expect(map).not.toMatch(/Velocity Heatmap/);
    expect(map).not.toMatch(/Standard Map/);
    expect(map).toMatch(/map-attention-investigation/);
    expect(map).toMatch(/emphasizeAttentionMarkers/);
  });

  it("StoreLocationGrid speaks physical bays, not tags", () => {
    const grid = readSrc("components/admin/StoreLocationGrid.tsx");
    expect(grid).toMatch(/physicalBayCount/);
    expect(grid).toMatch(/formatPhysicalBayCount/);
    expect(grid).toMatch(/Department coverage/);
    expect(grid).not.toMatch(/tagCount/);
    expect(grid).not.toMatch(/· \{dept\.tagCount\}/);
    expect(grid).not.toMatch(/\$\{dept\.tagCount\} tag/);
    expect(grid).toMatch(/canMutate=\{false\}/);
    expect(grid).toMatch(/bay-surface-presence/);
    expect(grid).toMatch(/Needs attention/);
    expect(grid).toMatch(/Remaining/);
  });

  it("WalkTheFloorSheet pin-to-week stays gated on canMutate", () => {
    const sheet = readSrc("components/admin/WalkTheFloorSheet.tsx");
    expect(sheet).toMatch(/canMutate && pinTargets\.length > 0/);
    const grid = readSrc("components/admin/StoreLocationGrid.tsx");
    expect(grid).toMatch(/WalkTheFloorSheet[\s\S]*canMutate=\{false\}/);
  });

  it("readiness labels match DS coverage language", () => {
    expect(mapReadinessLabel("verified")).toBe("Covered");
    expect(mapReadinessLabel("scheduled")).toBe("This week");
    expect(mapReadinessLabel("attention")).toBe("Needs attention");
    expect(mapReadinessLabel("idle")).toBe("Remaining");
    expect(mapCoverageToneLabel("idle")).toBe("Remaining");
  });

  it("physical bay cardinality remains sibling-aware", () => {
    const rows = [
      loc({
        id: "a",
        department_id: "d",
        aisle: "41",
        bay: 1,
        type: "SELLING",
      }),
      loc({
        id: "b",
        department_id: "d",
        aisle: "41",
        bay: 1,
        type: "TOPSTOCK",
      }),
      loc({
        id: "c",
        department_id: "d",
        aisle: "41",
        bay: 2,
        type: "SELLING",
      }),
    ];
    expect(countPhysicalBays(rows)).toBe(2);
    expect(formatPhysicalBayCount(2)).toBe("2 physical bays");
  });
});
