/**
 * DEPTSYNC-SECTION-UX-001 — aisle-first section membership compose.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import type { Department, StoreLocation } from "./types";
import {
  assertSectionAislePreviewFresh,
  composeDepartmentAisleIndexForSections,
  composeSectionAisleMembershipPreview,
  composeSectionAisleSelectionRows,
  countDiscoverableBaysForSection,
  expandAisleToActiveBayRefs,
  indexClaimedBaysFromSections,
  toggleAisleKeySelection,
} from "./section-aisle-membership";
import { sectionBayKey } from "./operational-sections";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loc(
  overrides: Partial<StoreLocation> &
    Pick<StoreLocation, "id" | "department_id" | "aisle" | "bay">
): StoreLocation {
  return {
    store_id: "store-1",
    type: "SELLING",
    status: "PENDING",
    location_type: "STANDARD",
    is_active: true,
    cycle_number: 1,
    last_completed_at: null,
    ...overrides,
  } as StoreLocation;
}

const depts: Department[] = [
  {
    id: "dept-a",
    store_id: "store-1",
    code: "flooring",
    name: "Flooring / Home Decor",
    is_active: true,
  } as Department,
];

describe("SECTION-UX-001 aisle expansion", () => {
  it("single aisle expands to all active bays", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "41", bay: 2 }),
        loc({
          id: "3",
          department_id: "dept-a",
          aisle: "41",
          bay: 3,
          type: "TOPSTOCK",
        }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    expect(index).toHaveLength(1);
    const refs = expandAisleToActiveBayRefs(index[0]!);
    expect(refs.map((r) => r.bay).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("multiple aisles expand independently", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "42", bay: 1 }),
        loc({ id: "3", department_id: "dept-a", aisle: "42", bay: 2 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: index,
      selectedAisleKeys: index.map((a) => a.key),
      claimedByKey: new Map(),
    });
    expect(preview.total_bays_to_add).toBe(3);
    expect(preview.selected_aisle_labels.length).toBe(2);
  });

  it("empty aisle (zero active) is reported and adds nothing", () => {
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: [
        {
          key: "dept-a:99",
          aisle: "99",
          departmentId: "dept-a",
          departmentName: "Flooring / Home Decor",
          displayName: null,
          aisleCodeCollides: false,
          registryOnly: true,
          bays: [],
          physicalBayCount: 0,
          activeBayCount: 0,
          inactiveBayCount: 0,
        },
      ],
      selectedAisleKeys: ["dept-a:99"],
      claimedByKey: new Map(),
    });
    expect(preview.total_bays_to_add).toBe(0);
    expect(preview.zero_active_aisles.length).toBe(1);
  });

  it("retired bays are excluded from active expansion", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({
          id: "2",
          department_id: "dept-a",
          aisle: "41",
          bay: 2,
          is_active: false,
        }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const refs = expandAisleToActiveBayRefs(index[0]!);
    expect(refs.map((r) => r.bay)).toEqual([1]);
  });

  it("existing section conflicts are listed and excluded from add set", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "41", bay: 2 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const claimed = indexClaimedBaysFromSections({
      sections: [
        {
          id: "other",
          name: "Section A",
          is_active: true,
          members: [
            { department_id: "dept-a", aisle: "41", bay: 1 },
          ],
        },
      ],
    });
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: index,
      selectedAisleKeys: [index[0]!.key],
      claimedByKey: claimed,
    });
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0]!.bay).toBe(1);
    expect(preview.bays_to_add.map((b) => b.bay)).toEqual([2]);
    expect(preview.partial_aisles.length).toBeGreaterThan(0);
  });

  it("editing preserves existing membership (already members not re-added)", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "41", bay: 2 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const existing = new Set([
      sectionBayKey({ department_id: "dept-a", aisle: "41", bay: 1 }),
    ]);
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: index,
      selectedAisleKeys: [index[0]!.key],
      claimedByKey: new Map(),
      existingMemberKeys: existing,
    });
    expect(preview.bays_to_add.map((b) => b.bay)).toEqual([2]);
    expect(preview.total_bays_to_add).toBe(1);
  });

  it("partial aisle membership surfaces available vs conflict counts", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "41", bay: 2 }),
        loc({ id: "3", department_id: "dept-a", aisle: "41", bay: 3 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const claimed = new Map([
      [
        sectionBayKey({ department_id: "dept-a", aisle: "41", bay: 2 }),
        { section_id: "x", section_name: "Other" },
      ],
    ]);
    const rows = composeSectionAisleSelectionRows({
      aisleIndex: index,
      selectedAisleKeys: [index[0]!.key],
      claimedByKey: claimed,
      existingMemberKeys: [
        sectionBayKey({ department_id: "dept-a", aisle: "41", bay: 1 }),
      ],
    });
    expect(rows[0]!.active_bay_count).toBe(3);
    expect(rows[0]!.already_member_count).toBe(1);
    expect(rows[0]!.conflict_bay_count).toBe(1);
    expect(rows[0]!.available_bay_count).toBe(1);
  });

  it("duplicate bay keys are prevented in preview add set", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({
          id: "1b",
          department_id: "dept-a",
          aisle: "41",
          bay: 1,
          type: "TOPSTOCK",
        }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    // Pair collapses to one physical bay.
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: index,
      selectedAisleKeys: [index[0]!.key],
      claimedByKey: new Map(),
    });
    expect(preview.total_bays_to_add).toBe(1);
  });

  it("cross-store / cross-department isolation via department filter", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-b", aisle: "41", bay: 1 }),
      ],
      departments: [
        ...depts,
        {
          id: "dept-b",
          store_id: "store-1",
          code: "other",
          name: "Other",
          is_active: true,
        } as Department,
      ],
      departmentId: "dept-a",
    });
    expect(index.every((a) => a.departmentId === "dept-a")).toBe(true);
    expect(expandAisleToActiveBayRefs(index[0]!)).toHaveLength(1);
  });

  it("stale selection fingerprint is rejected", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: index,
      selectedAisleKeys: [index[0]!.key],
      claimedByKey: new Map(),
    });
    expect(assertSectionAislePreviewFresh("stale", preview).ok).toBe(false);
    expect(
      assertSectionAislePreviewFresh(preview.fingerprint, preview).ok
    ).toBe(true);
  });

  it("toggle aisle selection is deterministic", () => {
    expect(toggleAisleKeySelection(["b", "a"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleAisleKeySelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("claimed index excludes the section being edited", () => {
    const claimed = indexClaimedBaysFromSections({
      sections: [
        {
          id: "self",
          name: "Self",
          is_active: true,
          members: [{ department_id: "dept-a", aisle: "41", bay: 1 }],
        },
        {
          id: "other",
          name: "Other",
          is_active: true,
          members: [{ department_id: "dept-a", aisle: "41", bay: 2 }],
        },
      ],
      excludeSectionId: "self",
    });
    expect(claimed.has(sectionBayKey({ department_id: "dept-a", aisle: "41", bay: 1 }))).toBe(
      false
    );
    expect(claimed.has(sectionBayKey({ department_id: "dept-a", aisle: "41", bay: 2 }))).toBe(
      true
    );
  });
});

describe("SECTION-UX-001 / UX-002 named zones + discovery", () => {
  it("multi-zone section selection expands named zones", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "SHOW-L", bay: 1 }),
        loc({ id: "3", department_id: "dept-a", aisle: "SHOW-L", bay: 2 }),
        loc({ id: "4", department_id: "dept-a", aisle: "CARPET-WALL", bay: 1 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: index,
      selectedAisleKeys: index
        .filter((a) => a.aisle === "SHOW-L" || a.aisle === "CARPET-WALL")
        .map((a) => a.key),
      claimedByKey: new Map(),
    });
    expect(preview.total_bays_to_add).toBe(3);
    expect(preview.selected_aisle_labels).toContain("SHOW-L");
    expect(preview.selected_aisle_labels).toContain("CARPET-WALL");
  });

  it("discovers newly mapped unassigned bays in section aisles without auto-adding", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "41", bay: 2 }),
        loc({ id: "3", department_id: "dept-a", aisle: "SHOW-L", bay: 1 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    const discovered = countDiscoverableBaysForSection({
      aisleIndex: index,
      sectionMembers: [
        { department_id: "dept-a", aisle: "41", bay: 1 },
      ],
      claimedByKey: new Map(),
    });
    expect(discovered.discoverable_count).toBe(1);
    expect(discovered.aisle_labels.some((l) => l.includes("41"))).toBe(true);
  });

  it("does not treat historical aisle membership as automatic future inclusion", () => {
    const index = composeDepartmentAisleIndexForSections({
      locations: [
        loc({ id: "1", department_id: "dept-a", aisle: "41", bay: 1 }),
        loc({ id: "2", department_id: "dept-a", aisle: "41", bay: 9 }),
      ],
      departments: depts,
      departmentId: "dept-a",
    });
    // Preview with no selection adds nothing — discovery is opt-in via re-select.
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex: index,
      selectedAisleKeys: [],
      claimedByKey: new Map(),
      existingMemberKeys: [
        sectionBayKey({ department_id: "dept-a", aisle: "41", bay: 1 }),
      ],
    });
    expect(preview.total_bays_to_add).toBe(0);
  });
});

describe("SECTION-UX-001 panel contracts", () => {
  it("uses multi-aisle select with preview and no silent reassignment", () => {
    const panel = readRepo("components/admin/OperationalSectionsPanel.tsx");
    expect(panel).toMatch(/sections-aisle-multi-select/);
    expect(panel).toMatch(/sections-aisle-preview/);
    expect(panel).toMatch(/assertSectionAislePreviewFresh/);
    expect(panel).toMatch(/never moved silently|Conflicted bays/);
    expect(panel).toMatch(/sections-discoverable-bays/);
    expect(panel).toMatch(/min-h-14|min-h-12/);
    expect(panel).not.toMatch(/togglePendingBay/);
  });

  it("does not change rotation or capacity engines", () => {
    const mod = readRepo("lib/store-ops/section-aisle-membership.ts");
    expect(mod).not.toMatch(/selectPhysicalBayCoverage/);
    expect(mod).not.toMatch(/sunday-dispatch/);
    expect(mod).not.toMatch(/shared-week-capacity/);
    expect(mod).not.toMatch(/upsert_sunday_bay_assignments/);
  });
});
