/**
 * RD-3 — Operational Sections pure helpers + invariant logic.
 */

import { describe, expect, it } from "vitest";
import {
  findActiveBayMembershipConflicts,
  formatUnsectionedLabel,
  indexBaySectionLookups,
  normalizeSectionBayRef,
  normalizeSectionName,
  sectionBayKey,
  validateSectionCreateInput,
  type OperationalSectionView,
} from "./operational-sections";

describe("operational-sections helpers", () => {
  it("normalizes names and bay refs", () => {
    expect(normalizeSectionName("  Soft Surface  ")).toBe("Soft Surface");
    expect(normalizeSectionBayRef({
      department_id: "d1",
      aisle: "bw",
      bay: 3,
    })).toEqual({ department_id: "d1", aisle: "BW", bay: 3 });
    expect(sectionBayKey({ department_id: "d1", aisle: "bw", bay: 3 })).toBe(
      "d1|BW|3"
    );
  });

  it("validates create input and cross-department members", () => {
    expect(
      validateSectionCreateInput({
        name: "",
        department_id: "d1",
      }).ok
    ).toBe(false);
    expect(
      validateSectionCreateInput({
        name: "A",
        department_id: "d1",
        members: [{ department_id: "d2", aisle: "12", bay: 1 }],
      })
    ).toMatchObject({ ok: false });
    expect(
      validateSectionCreateInput({
        name: "A",
        department_id: "d1",
        members: [
          { department_id: "d1", aisle: "12", bay: 1 },
          { department_id: "d1", aisle: "14", bay: 5 },
        ],
      })
    ).toEqual({ ok: true });
  });

  it("detects one-active-section-per-bay conflicts", () => {
    const conflicts = findActiveBayMembershipConflicts([
      {
        section_id: "s1",
        section_is_active: true,
        department_id: "d1",
        aisle: "12",
        bay: 1,
      },
      {
        section_id: "s2",
        section_is_active: true,
        department_id: "d1",
        aisle: "12",
        bay: 1,
      },
      {
        section_id: "s3",
        section_is_active: false,
        department_id: "d1",
        aisle: "12",
        bay: 1,
      },
    ]);
    expect(conflicts).toEqual(["d1|12|1"]);
  });

  it("allows cross-aisle membership without conflict", () => {
    expect(
      findActiveBayMembershipConflicts([
        {
          section_id: "s1",
          section_is_active: true,
          department_id: "d1",
          aisle: "12",
          bay: 1,
        },
        {
          section_id: "s1",
          section_is_active: true,
          department_id: "d1",
          aisle: "14",
          bay: 3,
        },
      ])
    ).toEqual([]);
  });

  it("indexes active bay → section lookups; unsectioned stays absent", () => {
    const sections: OperationalSectionView[] = [
      {
        id: "s1",
        store_id: "store",
        department_id: "d1",
        name: "Soft Surface",
        description: null,
        primary_owner_specialist_id: "p1",
        primary_owner_name: "Alex",
        is_active: true,
        retired_at: null,
        created_at: "",
        updated_at: "",
        member_count: 1,
        members: [
          {
            id: "m1",
            section_id: "s1",
            store_id: "store",
            department_id: "d1",
            aisle: "12",
            bay: 1,
            created_at: "",
          },
        ],
      },
      {
        id: "s2",
        store_id: "store",
        department_id: "d1",
        name: "Retired Area",
        description: null,
        primary_owner_specialist_id: null,
        primary_owner_name: null,
        is_active: false,
        retired_at: "2026-10-01",
        created_at: "",
        updated_at: "",
        member_count: 0,
        members: [
          {
            id: "m2",
            section_id: "s2",
            store_id: "store",
            department_id: "d1",
            aisle: "99",
            bay: 1,
            created_at: "",
          },
        ],
      },
    ];
    const index = indexBaySectionLookups(sections);
    expect(index.get("d1|12|1")?.section_name).toBe("Soft Surface");
    expect(index.get("d1|12|1")?.primary_owner_name).toBe("Alex");
    expect(index.has("d1|99|1")).toBe(false);
    expect(formatUnsectionedLabel()).toBe("Unsectioned");
  });
});
