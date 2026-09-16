/**
 * LAB-WEEK-002 — Floor on-duty labor uses home department, not access alone.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Floor access ≠ labor display", () => {
  it("on-duty workforce filter no longer ORs canAccessDepartment into labor pills", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../components/hub/tabs/FloorTab.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/canAccessDepartment/);
    expect(source).toMatch(/specialistHomeDepartment\(person\) !== scope/);
  });
});
