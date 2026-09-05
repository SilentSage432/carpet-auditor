/**
 * FS-002B Floor operational context composition tests.
 */

import { describe, expect, it } from "vitest";
import {
  composeFloorOperationalContextView,
  formatActiveSeasonLabel,
  formatDepartmentRelevanceLabel,
  formatFiscalContextLabel,
  pickCurrentDepartmentRelevance,
  type FloorContextItem,
} from "./floor-operational-context";

const season = (
  title: string,
  relevance: FloorContextItem["department_relevance"] = null
): FloorContextItem => ({
  id: `s-${title}`,
  kind: "SEASON",
  title,
  start_date: "2026-08-01",
  end_date: "2026-09-30",
  source_type: "MASTER_ADMIN_DECLARED",
  department_relevance: relevance,
});

const event = (
  title: string,
  relevance: FloorContextItem["department_relevance"] = null
): FloorContextItem => ({
  id: `e-${title}`,
  kind: "EVENT",
  title,
  start_date: "2026-09-01",
  end_date: "2026-09-10",
  source_type: "MASTER_ADMIN_DECLARED",
  department_relevance: relevance,
});

const fiscalOk = {
  status: "ok" as const,
  fiscal_year: 2026,
  fiscal_week: 32,
  fiscal_period: 8,
  fiscal_quarter: 3,
  operational_date: "2026-09-05",
};

describe("FS-002B floor operational context composition", () => {
  it("A. fiscal only — no contexts → fiscal strip shown", () => {
    const view = composeFloorOperationalContextView({
      fiscal: fiscalOk,
      active_seasons: [],
      active_events: [],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.visible).toBe(true);
    expect(view.fiscal_label).toBe("FY26 · W32 · P8 · Q3");
    expect(view.lines).toEqual(["FY26 · W32 · P8 · Q3"]);
    expect(view.season_label).toBeNull();
    expect(view.relevance_label).toBeNull();
  });

  it("B. fiscal + season", () => {
    const view = composeFloorOperationalContextView({
      fiscal: fiscalOk,
      active_seasons: [season("Late Summer Transition")],
      active_events: [],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.lines).toEqual([
      "FY26 · W32 · P8 · Q3",
      "Late Summer Transition",
    ]);
  });

  it("C. fiscal + event", () => {
    const view = composeFloorOperationalContextView({
      fiscal: fiscalOk,
      active_seasons: [],
      active_events: [event("Inventory Prep")],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.lines).toEqual(["FY26 · W32 · P8 · Q3", "Inventory Prep"]);
  });

  it("D. season + event overlap keeps fiscal", () => {
    const view = composeFloorOperationalContextView({
      fiscal: fiscalOk,
      active_seasons: [season("Late Summer Transition")],
      active_events: [event("Inventory Prep")],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.lines[0]).toBe("FY26 · W32 · P8 · Q3");
    expect(view.lines[1]).toBe("Late Summer Transition · Inventory Prep");
  });

  it("E. department relevance HIGH", () => {
    const view = composeFloorOperationalContextView({
      fiscal: fiscalOk,
      active_seasons: [season("Late Summer Transition", "HIGH")],
      active_events: [],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.relevance_label).toBe("Flooring · HIGH");
    expect(view.lines).toContain("Flooring · HIGH");
  });

  it("F. department relevance UNSET — no fabricated label", () => {
    expect(
      formatDepartmentRelevanceLabel({
        department_label: "Flooring",
        relevance: null,
      })
    ).toBeNull();
    const view = composeFloorOperationalContextView({
      fiscal: fiscalOk,
      active_seasons: [season("Late Summer Transition", null)],
      active_events: [],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.relevance_label).toBeNull();
  });

  it("G. explicit NONE — omitted on Floor (noise)", () => {
    expect(
      formatDepartmentRelevanceLabel({
        department_label: "Flooring",
        relevance: "NONE",
      })
    ).toBeNull();
  });

  it("H. different department — does not show other dept relevance", () => {
    // Resolver already scopes department_relevance to requested department.
    // If seasons only carry flooring relevance as null for appliances:
    const view = composeFloorOperationalContextView({
      fiscal: fiscalOk,
      active_seasons: [season("Late Summer Transition", null)],
      active_events: [],
      department_code: "appliances",
      department_label: "Appliances",
    });
    expect(view.relevance_label).toBeNull();
    expect(view.lines.join(" ")).not.toMatch(/HIGH|MEDIUM|LOW/);
  });

  it("I. fiscal unavailable + active context still renders", () => {
    const view = composeFloorOperationalContextView({
      fiscal: {
        status: "calendar_unavailable",
        operational_date: "2027-02-05",
        reason: "No authoritative fiscal week covers this date",
      },
      active_seasons: [season("Post-FY Prep", "HIGH")],
      active_events: [],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.fiscal_label).toBeNull();
    expect(view.visible).toBe(true);
    expect(view.lines).toEqual(["Post-FY Prep", "Flooring · HIGH"]);
  });

  it("J. no fiscal + no context → not visible (no error card)", () => {
    const view = composeFloorOperationalContextView({
      fiscal: null,
      active_seasons: [],
      active_events: [],
      department_code: null,
      department_label: null,
    });
    expect(view.visible).toBe(false);
    expect(view.lines).toEqual([]);
  });

  it("K. composition stays pure — API failure handled by caller omitting strip", () => {
    // Caller passes null fiscal + empty contexts on failure → same as J.
    const view = composeFloorOperationalContextView({
      fiscal: null,
      active_seasons: [],
      active_events: [],
      department_code: "flooring",
      department_label: "Flooring",
    });
    expect(view.visible).toBe(false);
  });

  it("formats fiscal label and multi-season +N", () => {
    expect(formatFiscalContextLabel(fiscalOk)).toBe("FY26 · W32 · P8 · Q3");
    expect(
      formatActiveSeasonLabel([
        { title: "Late Summer" },
        { title: "Other" },
      ])
    ).toBe("Late Summer +1");
  });

  it("picks first declared relevance across seasons then events", () => {
    expect(
      pickCurrentDepartmentRelevance(
        [season("A", null), season("B", "MEDIUM")],
        [event("E", "HIGH")]
      )
    ).toBe("MEDIUM");
    expect(
      pickCurrentDepartmentRelevance(
        [season("A", null)],
        [event("E", "HIGH")]
      )
    ).toBe("HIGH");
  });
});

describe("FS-002B rotation independence", () => {
  it("floor-operational-context does not import rotation engines", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "floor-operational-context.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from ["'].*rotations/);
    expect(source).not.toMatch(/sunday-schedule/);
    expect(source).not.toMatch(/manual_priority/);
    expect(source).not.toMatch(/velocity_tier/);
    expect(source).not.toMatch(/from ["'].*week/);
    expect(source).not.toMatch(/rotation-metrics/);
  });

  it("rotations/week do not import floor-operational-context", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const file of ["rotations.ts", "week.ts", "sunday-schedule.ts", "rotation-metrics.ts"]) {
      const source = await fs.readFile(path.resolve(__dirname, file), "utf8");
      expect(source).not.toMatch(/floor-operational-context/);
    }
  });
});
