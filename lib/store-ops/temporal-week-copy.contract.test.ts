/**
 * Temporal week chrome copy — presentation contracts only.
 * Does not assert clock calculations (sundayStagingWeekLabel / isoWeekLabel).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeFloorWeekProgressWithStagingWeek,
} from "./rotation-metrics";
import { formatMapCalendarWeekChrome } from "./week-copy";

const root = join(process.cwd());

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("temporal week copy contracts", () => {
  it("Floor progress helper names Staging week and omits ambiguous this-week empty copy", () => {
    const empty = composeFloorWeekProgressWithStagingWeek(
      {
        staged: 0,
        verifiedComplete: 0,
        pendingVerification: 0,
        open: 0,
      },
      "2026-W37"
    );
    expect(empty).toContain("Staging week");
    expect(empty).toContain("2026-W37");
    expect(empty).not.toMatch(/\bthis week\b/i);
    expect(empty).not.toMatch(/ · week 2026-W37/);
  });

  it("Map chrome helper names Calendar week (not staging/rotation)", () => {
    expect(formatMapCalendarWeekChrome("2026-W36", "master")).toBe(
      "Calendar week · 2026-W36"
    );
    expect(formatMapCalendarWeekChrome("2026-W36", "locator")).toBe(
      "Bay locator · Calendar week · 2026-W36"
    );
    expect(formatMapCalendarWeekChrome("2026-W36", "master")).not.toMatch(
      /Staging|Rotation|Fiscal/i
    );
  });

  it("Sunday staging vs calendar labels may differ without conflict", () => {
    const floor = composeFloorWeekProgressWithStagingWeek(
      {
        staged: 0,
        verifiedComplete: 0,
        pendingVerification: 0,
        open: 0,
      },
      "2026-W37"
    );
    const map = formatMapCalendarWeekChrome("2026-W36", "master");
    expect(floor).toContain("2026-W37");
    expect(map).toContain("2026-W36");
    expect(floor).not.toEqual(map);
  });

  it("FloorTab wires staging-week composer; MapTab wires calendar chrome", () => {
    const floor = readSrc("components/hub/tabs/FloorTab.tsx");
    const map = readSrc("components/hub/tabs/MapTab.tsx");
    expect(floor).toContain("composeFloorWeekProgressWithStagingWeek");
    expect(floor).not.toMatch(/` · week \$\{week\}`/);
    expect(map).toContain("formatMapCalendarWeekChrome");
    expect(map).not.toMatch(/`Week \$\{currentWeek\}`/);
  });

  it("temporal helpers are presentation-only (no clock imports)", () => {
    const weekCopy = readSrc("lib/store-ops/week-copy.ts");
    expect(weekCopy).not.toMatch(/sundayStagingWeekLabel|isoWeekLabel/);
    expect(weekCopy).not.toMatch(/from ["'].*sunday-schedule|from ["'].*\/week["']/);
  });
});
