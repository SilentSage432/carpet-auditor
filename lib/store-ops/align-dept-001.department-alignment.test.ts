/**
 * DEPTSYNC-ALIGN-DEPT-001 — department alignment contract regressions.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aisleDepartmentOwnershipIsPersisted,
  FLOOR_COMMAND_DEPARTMENT_ARCHITECTURE,
  HOME_DECOR_CAPABILITY_MATRIX,
  isMergedFlooringHomeDecorCode,
  MERGED_FLOORING_HOME_DECOR_CODE,
  MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME,
  PROPOSED_HOME_DECOR_CODE,
  resolveMergedRosterJobTitle,
  resolveOperationalDepartmentLabel,
  sectionsAreDepartmentScoped,
} from "./department-alignment";
import { STRICT_SECTION_OWNERSHIP_AUTO_STAGE } from "./section-ownership-enforcement";
import { STORE_OPS_DEPARTMENT_CODES } from "./department-codes";
import { NAMED_SPECIALTY_ZONE_CODES } from "./aisle";
import { DEPARTMENT_META } from "@/lib/types";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("ALIGN-DEPT-001 architecture contract", () => {
  it("locks merged Flooring / Home Decor as current architecture", () => {
    expect(FLOOR_COMMAND_DEPARTMENT_ARCHITECTURE).toBe(
      "merged_flooring_home_decor"
    );
    expect(MERGED_FLOORING_HOME_DECOR_CODE).toBe("flooring");
    expect(MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME).toBe(
      "Flooring / Home Decor"
    );
    expect(DEPARTMENT_META.flooring.label).toBe(
      MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME
    );
    expect(isMergedFlooringHomeDecorCode("flooring")).toBe(true);
    expect(isMergedFlooringHomeDecorCode("D23")).toBe(true);
    expect(isMergedFlooringHomeDecorCode("appliances")).toBe(false);
  });

  it("does not register or activate proposed home_decor code", () => {
    expect(PROPOSED_HOME_DECOR_CODE).toBe("home_decor");
    expect(
      (STORE_OPS_DEPARTMENT_CODES as readonly string[]).includes("home_decor")
    ).toBe(false);
    const stores = readRepo("lib/store-ops/stores.ts");
    expect(stores).toMatch(/code:\s*"flooring"/);
    expect(stores).not.toMatch(/code:\s*"home_decor"/);
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).not.toMatch(/home_decor.*is_active:\s*true/);
  });

  it("classifies Home Decor capabilities without inventing topology", () => {
    expect(HOME_DECOR_CAPABILITY_MATRIX.store_map).toBe("ALREADY_SUPPORTED");
    expect(HOME_DECOR_CAPABILITY_MATRIX.operational_sections).toBe(
      "ALREADY_SUPPORTED"
    );
    expect(HOME_DECOR_CAPABILITY_MATRIX.weekly_rotation).toBe(
      "ALREADY_SUPPORTED"
    );
    expect(HOME_DECOR_CAPABILITY_MATRIX.walkthrough_observations).toBe(
      "ALREADY_SUPPORTED"
    );
    expect(
      HOME_DECOR_CAPABILITY_MATRIX.aisle_bay_flooring_vs_home_decor_map
    ).toBe("OPERATOR_DECISION_REQUIRED");
    expect(
      HOME_DECOR_CAPABILITY_MATRIX.separate_home_decor_department_row
    ).toBe("OPERATOR_DECISION_REQUIRED");
    expect(aisleDepartmentOwnershipIsPersisted()).toBe(false);
    expect(sectionsAreDepartmentScoped()).toBe(true);
  });

  it("preserves specialty non-rotation codes and Sunday auto-stage OFF", () => {
    expect(NAMED_SPECIALTY_ZONE_CODES).toEqual([
      "CARPET-WALL",
      "SHOW-L",
      "SHOW-R",
      "CLOTHING",
    ]);
    expect(STRICT_SECTION_OWNERSHIP_AUTO_STAGE).toBe(false);
  });
});

describe("ALIGN-DEPT-001 label resolution", () => {
  it("prefers persisted department name", () => {
    expect(
      resolveOperationalDepartmentLabel({
        departmentName: "Flooring / Home Decor",
        departmentCode: "flooring",
      })
    ).toBe("Flooring / Home Decor");
  });

  it("uses full merged label when hub scope is flooring", () => {
    expect(
      resolveOperationalDepartmentLabel({ hubScope: "flooring" })
    ).toBe(MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME);
    expect(
      resolveOperationalDepartmentLabel({ departmentCode: "D23" })
    ).toBe(MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME);
  });

  it("uses other department meta labels unchanged", () => {
    expect(
      resolveOperationalDepartmentLabel({ hubScope: "appliances" })
    ).toBe(DEPARTMENT_META.appliances.label);
  });

  it("resolves Constitution staffing titles under the merged department", () => {
    expect(
      resolveMergedRosterJobTitle({
        role: "Supervisor",
        floorTitle: null,
        departmentCodeOrScope: "flooring",
      })
    ).toBe("Flooring / Home Decor Supervisor");
    expect(
      resolveMergedRosterJobTitle({
        role: "Associate",
        floorTitle: "CSA",
        departmentCodeOrScope: "flooring",
      })
    ).toBe("Flooring / Home Decor CSA");
    expect(
      resolveMergedRosterJobTitle({
        role: "Associate",
        floorTitle: "Specialist",
        departmentCodeOrScope: "flooring",
      })
    ).toBe("Flooring Specialist");
    expect(
      resolveMergedRosterJobTitle({
        role: "Associate",
        floorTitle: "CSA",
        departmentCodeOrScope: "appliances",
      })
    ).toBeNull();
  });
});

describe("ALIGN-DEPT-001 source wiring", () => {
  it("Floor Command surfaces compose the alignment helper", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const nav = readRepo("lib/nav-hub.ts");
    const types = readRepo("lib/types.ts");
    const cycle = readRepo("components/sections/CycleAuditSection.tsx");
    const sheet = readRepo("components/admin/WalkTheFloorSheet.tsx");
    expect(floor).toMatch(/resolveOperationalDepartmentLabel/);
    expect(nav).toMatch(/resolveOperationalDepartmentLabel/);
    expect(sheet).toMatch(/resolveOperationalDepartmentLabel/);
    expect(types).toMatch(/Flooring \/ Home Decor CSA/);
    expect(types).toMatch(/DEPARTMENT_META\.flooring\.label\} Supervisor/);
    expect(types).toMatch(/return "Flooring Specialist"/);
    expect(cycle).toMatch(/resolveOperationalDepartmentLabel/);
  });

  it("does not redistribute operational section membership helpers", () => {
    const alignment = readRepo("lib/store-ops/department-alignment.ts");
    expect(alignment).not.toMatch(/redistribut|createSection|member_added/i);
    expect(alignment).not.toMatch(/aisles:\s*\[\s*5/);
  });
});
