/**
 * DEPTSYNC-CLEANUP-002 — guided cleanup composition / safety tests.
 */

import { describe, expect, it } from "vitest";
import type { Department, StoreLocation } from "./types";
import {
  aisleCleanupKey,
  aisleSelectionFingerprint,
  associateSelectionFingerprint,
  composeCleanupAisleInventory,
  composeCleanupAssociateInventory,
  isProtectedCleanupRole,
  parseCleanupAisleKeys,
  parseCleanupSpecialistIds,
  summarizeCleanupOutcome,
} from "./workspace-cleanup";

function loc(
  partial: Partial<StoreLocation> &
    Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay" | "type">
): StoreLocation {
  return {
    store_id: "store-1",
    status: "PENDING",
    is_active: true,
    cycle_number: 1,
    ...partial,
  } as StoreLocation;
}

const departments: Department[] = [
  {
    id: "d-floor",
    store_id: "store-1",
    code: "flooring",
    name: "Flooring / Home Decor",
    weekly_bay_target: 10,
    is_active: true,
  } as Department,
  {
    id: "d-paint",
    store_id: "store-1",
    code: "paint",
    name: "Paint",
    weekly_bay_target: 10,
    is_active: true,
  } as Department,
];

describe("workspace-cleanup selection parsing", () => {
  it("rejects empty aisle selection", () => {
    expect(parseCleanupAisleKeys([]).error).toMatch(/at least one aisle/i);
    expect(parseCleanupAisleKeys(undefined).error).toBeTruthy();
  });

  it("requires department_id with aisle (aisle number alone is invalid)", () => {
    expect(
      parseCleanupAisleKeys([{ aisle: "12" }]).error
    ).toMatch(/department_id/i);
  });

  it("dedupes aisle keys and normalizes aisle", () => {
    const parsed = parseCleanupAisleKeys([
      { department_id: "d-floor", aisle: " 12 " },
      { department_id: "d-floor", aisle: "12" },
    ]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.keys).toEqual([{ department_id: "d-floor", aisle: "12" }]);
  });

  it("rejects empty associate selection", () => {
    expect(parseCleanupSpecialistIds([]).error).toMatch(/at least one/i);
  });

  it("dedupes specialist ids", () => {
    const parsed = parseCleanupSpecialistIds(["a", "a", "b"]);
    expect(parsed.ids).toEqual(["a", "b"]);
  });
});

describe("workspace-cleanup MasterAdmin protection", () => {
  it("flags MasterAdmin as protected", () => {
    expect(isProtectedCleanupRole("MasterAdmin")).toBe(true);
    expect(isProtectedCleanupRole("Associate")).toBe(false);
    expect(isProtectedCleanupRole("Supervisor")).toBe(false);
  });

  it("marks MasterAdmin inventory rows protected and not rotation eligible", () => {
    const rows = composeCleanupAssociateInventory([
      {
        id: "m1",
        name: "Operator",
        role: "MasterAdmin",
        assigned_department: "flooring",
        is_active: true,
        status: "active",
      },
      {
        id: "a1",
        name: "Alex",
        role: "Associate",
        assigned_department: "flooring",
        is_active: true,
        status: "active",
      },
    ]);
    const master = rows.find((r) => r.id === "m1");
    const associate = rows.find((r) => r.id === "a1");
    expect(master?.protected).toBe(true);
    expect(master?.rotation_eligible).toBe(false);
    expect(associate?.protected).toBe(false);
    expect(associate?.rotation_eligible).toBe(true);
  });
});

describe("workspace-cleanup aisle inventory", () => {
  it("groups by department association and does not auto-select", () => {
    const inventory = composeCleanupAisleInventory({
      departments,
      locations: [
        loc({
          id: "l1",
          department_id: "d-floor",
          aisle: "12",
          bay: 1,
          type: "SELLING",
        }),
        loc({
          id: "l2",
          department_id: "d-floor",
          aisle: "12",
          bay: 1,
          type: "TOPSTOCK",
        }),
        loc({
          id: "l3",
          department_id: "d-paint",
          aisle: "12",
          bay: 3,
          type: "SELLING",
        }),
        loc({
          id: "l4",
          department_id: "d-paint",
          aisle: "12",
          bay: 3,
          type: "TOPSTOCK",
          is_active: false,
        }),
      ],
    });

    const floor12 = inventory.find(
      (r) => r.key === aisleCleanupKey("d-floor", "12")
    );
    const paint12 = inventory.find(
      (r) => r.key === aisleCleanupKey("d-paint", "12")
    );
    expect(floor12).toBeTruthy();
    expect(paint12).toBeTruthy();
    expect(floor12?.department_name).toContain("Flooring");
    expect(paint12?.department_name).toBe("Paint");
    expect(floor12?.active_bay_count).toBe(1);
    expect(floor12?.active_surface_count).toBe(2);
    expect(paint12?.retirement_status).toBe("partially_retired");
    // Collision labels include department
    expect(floor12?.label).toMatch(/Paint|Flooring|12/);
  });

  it("counts active bays accurately for preview fingerprint inputs", () => {
    const fingerprint = aisleSelectionFingerprint([
      {
        department_id: "d-floor",
        aisle: "BW",
        active_location_ids: ["b", "a"],
      },
    ]);
    expect(fingerprint).toBe("d-floor:BW|a,b");
  });
});

describe("workspace-cleanup fingerprints and outcomes", () => {
  it("detects stale associate fingerprints", () => {
    const preview = associateSelectionFingerprint([
      { id: "a1", is_active: true, status: "active" },
    ]);
    const later = associateSelectionFingerprint([
      { id: "a1", is_active: false, status: "suspended" },
    ]);
    expect(preview).not.toEqual(later);
  });

  it("does not report partial success as complete success", () => {
    const outcome = summarizeCleanupOutcome([
      { id: "1", label: "A", status: "retired" },
      { id: "2", label: "B", status: "failed", detail: "boom" },
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.partial).toBe(true);
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(1);
  });

  it("treats already_retired / already_archived as successful idempotent retries", () => {
    const outcome = summarizeCleanupOutcome([
      { id: "1", label: "A", status: "already_retired" },
      { id: "2", label: "B", status: "already_archived" },
    ]);
    expect(outcome.ok).toBe(true);
    expect(outcome.partial).toBe(false);
    expect(outcome.succeeded).toBe(2);
  });

  it("marks stale preview review rows as needing review, not success", () => {
    const outcome = summarizeCleanupOutcome([
      {
        id: "1",
        label: "A",
        status: "review",
        detail: "Selection changed since preview",
      },
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.review).toBe(1);
    expect(outcome.succeeded).toBe(0);
  });
});

describe("workspace-cleanup hard-delete boundary", () => {
  it("source module never issues hard DELETE for specialists or locations", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(process.cwd(), "lib/store-ops/workspace-cleanup.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/\.delete\(\)/);
    expect(source).not.toMatch(/from\("store_specialists"\)[\s\S]*\.delete\(/);
    expect(source).not.toMatch(/from\("store_locations"\)[\s\S]*\.delete\(/);
    expect(source).toMatch(/is_active: false/);
    expect(source).toMatch(/status: "suspended"/);
  });

  it("API route requires super admin and confirm flags", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(process.cwd(), "app/api/workspace-cleanup/route.ts"),
      "utf8"
    );
    expect(source).toMatch(/requireSuperAdmin/);
    expect(source).toMatch(/confirm: true is required/);
    expect(source).toMatch(/actor\.storeNumber/);
    expect(source).not.toMatch(/\.delete\(\)/);
  });
});
